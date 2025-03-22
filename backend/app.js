const express = require("express");
const multer = require("multer");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("node:fs/promises"); // Still used for promises
require("dotenv").config();
const { Magic, MAGIC_MIME_TYPE } = require("mmmagic"); // Import mmmagic

const app = express();
const port = process.env.PORT || 3000;

// --- Multer setup ---
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type."));
    }
  },
});

// --- Gemini API setup ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro-002" });

// --- Route handler ---
app.post("/analyzeDashboardPic", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No image file provided." });
    }

    const imageBuffer = req.file.buffer;

    // --- Use mmmagic to get the MIME type ---
    const magic = new Magic(MAGIC_MIME_TYPE);
    magic.detect(imageBuffer, (err, mimeType) => {
      if (err) {
        // Handle mmmagic errors (e.g., corrupted file)
        console.error("Error detecting MIME type with mmmagic:", err);
        return res
          .status(500)
          .json({ error: "Could not determine file type." });
      }

      if (!mimeType || !mimeType.startsWith("image/")) {
        return res
          .status(400)
          .json({ error: "Invalid file type. Only images are allowed." });
      }

      // If we get here, the MIME type is valid

      const textPrompt = req.body.text || "Describe the icons...";

      const parts = [
        {
          inlineData: {
            mimeType: mimeType,
            data: imageBuffer.toString("base64"),
          },
        },
        { text: textPrompt },
      ];

      model
        .generateContent({ contents: [{ role: "user", parts }] })
        .then((result) => {
          const responseText = result.response.text();
          res.status(200).json({ response: responseText });
        })
        .catch((geminiError) => {
          // Catch Gemini API errors separately
          console.error("Error from Gemini API:", geminiError);
          if (
            geminiError.name === "TypeError" &&
            geminiError.message.includes(
              "Cannot read properties of undefined (reading 'text')"
            )
          ) {
            res
              .status(500)
              .json({ error: "Gemini API did not return a text response." });
          } else {
            res
              .status(500)
              .json({ error: "Gemini API error: " + geminiError.message });
          }
        });
    });
  } catch (error) {
    // General error handling (should not happen with mmmagic in this flow, but good practice)
    console.error("Unexpected Error:", error);
    res
      .status(500)
      .json({ error: "An unexpected error occurred: " + error.message });
  }
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
