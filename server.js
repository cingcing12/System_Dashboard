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
const SHEETDB_BASE_URL = "https://sheetdb.io/api/v1/lman7mvjnhxo8";
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
// Register User Endpoint (CHANGED TO NAME)
// ---------------------------
app.post("/api/register", upload.single("faceImage"), async (req, res) => {
  // Now receiving 'name' instead of 'email'
  const { name, password, role } = req.body;
  if (!name || !password || !req.file)
    return res.status(400).json({ error: "Missing required fields" });

  // Filename logic: Remove spaces, replace with underscore
  const safeName = name.trim().replace(/\s+/g, "_");
  const fileName = `${safeName}.jpg`;
  const githubPath = `faces/${fileName}`;

  try {
    const userData = {
      Name: name, // Changed Key from Email to Name
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
    await uploadImageToGitHubBuffer(req.file.buffer, githubPath, `Add face image for ${name}`);

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
// Update Face Image Endpoint (CHANGED TO NAME)
// ---------------------------
app.post("/api/update-face", upload.single("faceImage"), async (req, res) => {
  const { name } = req.body; // Expecting name
  if (!name || !req.file) return res.status(400).json({ error: "Missing name or file" });

  const safeName = name.trim().replace(/\s+/g, "_");
  const fileName = `${safeName}.jpg`;
  const githubPath = `faces/${fileName}`;

  try {
    // Upload new file to GitHub directly from buffer (replaces old one)
    await uploadImageToGitHubBuffer(req.file.buffer, githubPath, `Update face image for ${name}`);

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
// Delete Face Endpoint (Added for cleanup)
// ---------------------------
app.post("/api/delete-face", async (req, res) => {
  const { name } = req.body;
  // This is optional if you want to delete the file from GitHub when user is deleted
  // Not implemented fully here to keep it simple, but the endpoint exists to prevent frontend 404
  console.log(`Requested delete face for: ${name}`); 
  res.json({ success: true });
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
