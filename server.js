// ---------------------------
// server.js
// ---------------------------
const express = require("express");
const multer = require("multer");
const fetch = require("node-fetch");
const path = require("path");
const fs = require("fs");
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
const SHEETDB_BASE_URL = "https://sheetdb.io/api/v1/8lnqzm4z7kw46";
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
// Multer Config (store locally first)
// ---------------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, "faces");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const emailSafe = req.body.email.replace(/[@.]/g, "_");
    cb(null, `${emailSafe}.jpg`);
  },
});
const upload = multer({ storage });

// ---------------------------
// GitHub Upload Function
// ---------------------------
async function uploadImageToGitHub(filePath, repoPath, commitMessage) {
  if (!fs.existsSync(filePath)) {
    console.log("File not found:", filePath);
    return;
  }

  const content = fs.readFileSync(filePath, { encoding: "base64" });
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${repoPath}`;

  // Get existing file SHA if exists
  let sha;
  const checkRes = await fetch(`${url}?ref=${GITHUB_BRANCH}`, {
    headers: { Authorization: `token ${GITHUB_TOKEN}` }
  });
  if (checkRes.ok) {
    const data = await checkRes.json();
    sha = data.sha;
  }

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: commitMessage,
      content,
      sha, // undefined if new file
      branch: GITHUB_BRANCH,
    }),
  });

  const data = await res.json();
  if (res.ok) console.log("✅ Uploaded to GitHub:", repoPath);
  else console.error("❌ GitHub upload error:", data);
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
  const localFile = path.join(__dirname, "faces", fileName);
  const githubPath = `faces/${fileName}`;

  try {
    // -----------------------------
    // Save user to SheetDB
    // -----------------------------
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

    // -----------------------------
    // Upload face image to GitHub
    // -----------------------------
    await uploadImageToGitHub(localFile, githubPath, `Add face image for ${email}`);

    const githubUrl = `https://raw.githubusercontent.com/${GITHUB_REPO}/${GITHUB_BRANCH}/${githubPath}`;

    res.json({
      success: true,
      message: "User saved and face image uploaded to GitHub",
      githubUrl,
    });
  } catch (err) {
    console.error("❌ Error:", err);
    res.status(500).json({ error: "Failed to save user", details: err.message });
  }
});

// ---------------------------
// Update Face Image Endpoint
// ---------------------------
app.post("/api/update-face", upload.single("faceImage"), async (req, res) => {
  const { email } = req.body;
  if (!email || !req.file) return res.status(400).json({ error: "Missing email or file" });

  const safeEmail = email.replace(/[@.]/g, "_");
  const fileName = `${safeEmail}.jpg`;
  const localFile = path.join(__dirname, "faces", fileName);
  const githubPath = `faces/${fileName}`;

  try {
    // Save locally
    fs.writeFileSync(localFile, fs.readFileSync(req.file.path));

    // Upload to GitHub
    await uploadImageToGitHub(localFile, githubPath, `Update face image for ${email}`);

    res.json({
      success: true,
      message: "Face image updated",
      githubUrl: `https://raw.githubusercontent.com/${GITHUB_REPO}/${GITHUB_BRANCH}/${githubPath}`
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
// Fetch Face Image Locally (Optional)
// ---------------------------
app.get("/api/face/:email", (req, res) => {
  const email = req.params.email;
  const filePath = path.join(__dirname, "faces", email.replace(/[@.]/g, "_") + ".jpg");
  
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).send("Face image not found");
  }
});

app.post('/api/delete-face', (req, res) => {
  const { email } = req.body;
  const filePath = path.join(__dirname, 'faces', email.replace(/[@.]/g,'_')+'.jpg');
  fs.unlink(filePath, err => {
    if(err && err.code !== 'ENOENT') return res.status(500).json({ error: err.message });
    res.json({ success:true });
  });
});

// ---------------------------
// Start Server
// ---------------------------
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
