const express = require("express");
const multer = require("multer");
const fetch = require("node-fetch");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const simpleGit = require("simple-git");

const app = express();
const PORT = 3000;

// ---------------------------
// SheetDB Config
// ---------------------------
const SHEETDB_BASE_URL = "https://sheetdb.io/api/v1/1v70fvkbzklbs";
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
// Multer Config (store locally)
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
  }
});
const upload = multer({ storage });

// ---------------------------
// Auto Git Push Function
// ---------------------------
const git = simpleGit();

async function pushToGit(commitMessage) {
  try {
    await git.add("./faces");
    await git.commit(commitMessage);
    await git.push("origin", "main");

    console.log("✅ Auto git push done!");
  } catch (err) {
    console.error("❌ Git push failed:", err);
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
  const savedPath = path.join(__dirname, "faces", fileName);

  try {
    // -----------------------------
    // Save to SheetDB
    // -----------------------------
    const userData = {
      Email: email,
      PasswordHash: password,
      Role: role || "Staff",
      IsBlocked: "FALSE",
      LastLogin: "",
      FaceImageFile: fileName
    };

    const sheetRes = await fetch(sheetUrl(SHEET_USERS), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: [userData] })
    });

    const sheetJson = await sheetRes.json();
    if (!sheetRes.ok) {
      console.error("❌ SheetDB error:", sheetJson);
      return res.status(500).json({ error: "Failed to save user to SheetDB", details: sheetJson });
    }

    // -----------------------------
    // Auto Git Commit + Push
    // -----------------------------
    await pushToGit(`Add face image for ${email}`);

    res.json({
      success: true,
      message: "User saved and face image pushed to GitHub via git"
    });

  } catch (err) {
    console.error("❌ Error:", err);
    res.status(500).json({ error: "Failed to save user", details: err.message });
  }
});

// ---------------------------
// Fetch All Users
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
// Fetch Face Image by Email
// ---------------------------
app.get("/api/face/:email", async (req, res) => {
  try {
    const email = req.params.email;
    const safeEmail = email.replace(/[@.]/g, "_");
    const githubPath = `${GITHUB_FOLDER}/${safeEmail}.jpg`;

    const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${githubPath}`;

    const response = await fetch(url, {
      headers: { Authorization: `token ${GITHUB_TOKEN}` }
    });

    if (!response.ok) {
      return res.status(404).json({ error: "Face image not found" });
    }

    const json = await response.json();
    const imgBuffer = Buffer.from(json.content, "base64");

    res.setHeader("Content-Type", "image/jpeg");
    res.send(imgBuffer);

  } catch (err) {
    console.error("Error fetching face:", err);
    res.status(500).json({ error: "Failed to load face image" });
  }
});

// ---------------------------
// Start Server
// ---------------------------
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
