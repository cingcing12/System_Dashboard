// ---------------------------
// server.js
// ---------------------------
const express = require("express");
const multer = require("multer");
const fetch = require("node-fetch");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;
require("dotenv").config();

// ---------------------------
// GitHub Config
// ---------------------------
const GITHUB_TOKEN = process.env.GITHUB_TOKEN; // Personal Access Token
const GITHUB_REPO = process.env.GITHUB_REPO;   // e.g. username/repo
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";

// ---------------------------
// SheetDB Config
// ---------------------------
const SHEETDB_BASE_URL = "https://sheetdb.io/api/v1/2qesrzmr4nggw";
const SHEET_USERS = "Users";
function sheetUrl(sheetName) {
  return `${SHEETDB_BASE_URL}?sheet=${sheetName}`;
}

// ---------------------------
// Middleware
// ---------------------------
app.use(cors());
app.use(express.json());

// ---------------------------
// Multer Config (memory storage)
// ---------------------------
const storage = multer.memoryStorage();
const upload = multer({ storage });

// ---------------------------
// GitHub Upload Function (from buffer)
// ---------------------------
async function uploadImageToGitHubBuffer(buffer, repoPath, commitMessage) {
  const content = buffer.toString("base64");
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${repoPath}`;

  try {
    // Check if file exists on GitHub
    let sha;
    const checkRes = await fetch(`${url}?ref=${GITHUB_BRANCH}`, {
      headers: { Authorization: `token ${GITHUB_TOKEN}` },
    });
    if (checkRes.ok) {
      const data = await checkRes.json();
      sha = data.sha;
    }

    // Upload or replace file
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: commitMessage,
        content,
        sha, // if exists, replaces
        branch: GITHUB_BRANCH,
      }),
    });

    const data = await res.json();
    if (res.ok) console.log("✅ Uploaded to GitHub:", repoPath);
    else console.error("❌ GitHub upload error:", data);

  } catch (err) {
    console.error("❌ GitHub upload exception:", err);
  }
}

// ---------------------------
// Register User Endpoint
// ---------------------------
app.post("/api/register", upload.single("faceImage"), async (req, res) => {
  const { email, password, role } = req.body;
  if (!email || !password || !req.file)
    return res.status(400).json({ error: "Missing required fields" });

  const safeEmail = email.replace(/[@.]/g, "_");
  const fileName = `${safeEmail}.jpg`;
  const githubPath = `faces/${fileName}`;

  try {
    const userData = {
      Email: email,
      PasswordHash: password,
      Role: role || "Staff",
      IsBlocked: "FALSE",
      LastLogin: "",
      FaceImageFile: fileName,
    };

    const sheetRes = await fetch(sheetUrl(SHEET_USERS), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: [userData] }),
    });

    const sheetJson = await sheetRes.json();
    if (!sheetRes.ok) {
      console.error("❌ SheetDB error:", sheetJson);
      return res.status(500).json({
        error: "Failed to save user to SheetDB",
        details: sheetJson,
      });
    }

    // Upload face image to GitHub directly from buffer
    await uploadImageToGitHubBuffer(req.file.buffer, githubPath, `Add face image for ${email}`);

    res.json({
      success: true,
      message: "User saved and face image uploaded to GitHub",
      githubUrl: `https://raw.githubusercontent.com/${GITHUB_REPO}/${GITHUB_BRANCH}/${githubPath}`,
    });
  } catch (err) {
    console.error("❌ Error:", err);
    res.status(500).json({ error: "Failed to save user", details: err.message });
  }
});

// ---------------------------
// Update Face Image Endpoint (memory, replace old on GitHub)
// ---------------------------
app.post("/api/update-face", upload.single("faceImage"), async (req, res) => {
  const { email } = req.body;
  if (!email || !req.file) return res.status(400).json({ error: "Missing email or file" });

  const safeEmail = email.replace(/[@.]/g, "_");
  const fileName = `${safeEmail}.jpg`;
  const githubPath = `faces/${fileName}`;

  try {
    // Upload new file to GitHub directly from buffer (replaces old one)
    await uploadImageToGitHubBuffer(req.file.buffer, githubPath, `Update face image for ${email}`);

    res.json({
      success: true,
      message: "Face image updated on GitHub",
      githubUrl: `https://raw.githubusercontent.com/${GITHUB_REPO}/${GITHUB_BRANCH}/${githubPath}`,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update face image", details: err.message });
  }
});

// ---------------------------
// Fetch All Users Endpoint
// ---------------------------
app.get("/api/users", async (req, res) => {
  try {
    const response = await fetch(sheetUrl(SHEET_USERS));
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// ---------------------------
// Start Server
// ---------------------------
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
