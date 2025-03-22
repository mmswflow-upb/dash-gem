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
// We allow file uploads under the field name "image"
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    // Accept only image files
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
// This route can accept an image file, text in the body, or both.
app.post("/analyzeDashboardPic", upload.single("image"), async (req, res) => {
  // Retrieve the text from the body (if provided)
  const userText = req.body.text ? req.body.text.trim() : "";
  const genericInstructions = `
    You are a highly skilled car mechanic who interprets the icons on a car's dashboard.
    Your task is to analyze the dashboard lights, identify potential problems with the car,
    and explain what each illuminated icon means. Provide a detailed diagnosis and recommendations.
    Check out the image too if there is one provided
  `;
  // If text is provided, append it to the generic instructions; otherwise, use generic instructions alone.
  const combinedPrompt = userText
    ? `${genericInstructions}\n${userText}`
    : genericInstructions;

  // Build an array of parts that will eventually be sent to the Gemini API.
  // It will include an inlineData part if an image is provided and a text part.
  const parts = [];

  // Helper function to call Gemini API and send the response
  const callGeminiAPI = async () => {
    // Always add the text part (which may be just the generic instructions)
    parts.push({ text: combinedPrompt });
    try {
      const result = await model.generateContent({
        contents: [{ role: "user", parts }],
      });
      const responseText = result.response.text();
      res.status(200).json({ response: responseText });
    } catch (geminiError) {
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
    }
  };

  // If an image was uploaded, process it
  if (req.file) {
    const imageBuffer = req.file.buffer;
    const magic = new Magic(MAGIC_MIME_TYPE);
    // mmmagic uses a callback, so wrap it here
    magic.detect(imageBuffer, async (err, mimeType) => {
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
      // Add the inlineData part for the image
      parts.push({
        inlineData: {
          mimeType: mimeType,
          data: imageBuffer.toString("base64"),
        },
      });
      // Now call Gemini API with both image (if any) and text
      await callGeminiAPI();
    });
  } else {
    // No image provided; use text-only prompt
    if (!userText) {
      return res.status(400).json({ error: "No text or image provided." });
    }
    await callGeminiAPI();
  }
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
