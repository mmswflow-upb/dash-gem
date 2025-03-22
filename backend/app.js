const express = require("express");
const multer = require("multer");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("node:fs/promises");
require("dotenv").config();
const { Magic, MAGIC_MIME_TYPE } = require("mmmagic");

const app = express();
const port = process.env.PORT || 3000;

// Middleware to parse JSON and URL-encoded data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

    // Use mmmagic to get the MIME type
    const magic = new Magic(MAGIC_MIME_TYPE);
    magic.detect(imageBuffer, (err, mimeType) => {
      if (err) {
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

      // Generic instructions (formerly the system message)
      const genericInstructions = `
        You are a highly skilled car mechanic who interprets the icons on a car's dashboard.
        Your task is to analyze the dashboard lights, identify potential problems with the car,
        and explain what each illuminated icon means. Provide a detailed diagnosis and recommendations.
      `;

      // Extra prompt provided by the user through the request body
      const extraPrompt =
        req.body.text || "Describe the icons and their implications.";

      // Combine the generic instructions with the extra prompt
      const combinedPrompt = `${genericInstructions}\n${extraPrompt}`;

      // Prepare the payload with inline image data and the combined text prompt
      const parts = [
        {
          inlineData: {
            mimeType: mimeType,
            data: imageBuffer.toString("base64"),
          },
        },
        { text: combinedPrompt },
      ];

      // Send a single user message containing both image and text prompt
      model
        .generateContent({ contents: [{ role: "user", parts }] })
        .then((result) => {
          const responseText = result.response.text();
          res.status(200).json({ response: responseText });
        })
        .catch((geminiError) => {
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
    console.error("Unexpected Error:", error);
    res
      .status(500)
      .json({ error: "An unexpected error occurred: " + error.message });
  }
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
