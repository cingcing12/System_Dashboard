const express = require("express");
const multer = require("multer");
const fetch = require("node-fetch");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const simpleGit = require("simple-git");

const app = express();
const PORT = process.env.PORT || 3000;
require("dotenv").config();

// ---------------------------
// GitHub Config
// ---------------------------
const GITHUB_TOKEN = process.env.GITHUB_TOKEN; // Personal Access Token
const GITHUB_REPO = process.env.GITHUB_REPO;   // e.g. username/repo
const GITHUB_BRANCH = "main";

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
// Git Setup & Push Function
// ---------------------------
const git = simpleGit();

async function setupGitIdentity() {
  try {
    await git.addConfig("user.name", "cingcing12", false);
    await git.addConfig("user.email", "cing16339@gmail.com", false);
    console.log("✅ Git identity set for commits");
  } catch (err) {
    console.error("❌ Failed to set Git identity:", err);
  }
}

async function pushToGit(commitMessage) {
  try {
    await setupGitIdentity();

    // Stage faces folder
    await git.add("./faces/**", { "-f": null });

    const status = await git.status();
    if (status.modified.length === 0 && status.not_added.length === 0) {
      console.log("ℹ️ No new files to commit");
      return;
    }

    await git.commit(commitMessage);

    // Push via HTTPS token
    await git.push(
      `https://${GITHUB_TOKEN}@github.com/${GITHUB_REPO}.git`,
      GITHUB_BRANCH
    );
    console.log("✅ Auto Git push done!");
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
      return res
        .status(500)
        .json({ error: "Failed to save user to SheetDB", details: sheetJson });
    }

    // -----------------------------
    // Auto Git Commit + Push
    // -----------------------------
    await pushToGit(`Add face image for ${email}`);

    // GitHub URL of the image
    const githubUrl = `https://raw.githubusercontent.com/${GITHUB_REPO}/${GITHUB_BRANCH}/faces/${fileName}`;

    res.json({
      success: true,
      message: "User saved and face image pushed to GitHub",
      githubUrl,
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
// Fetch Face Image by Email (optional if you want)
// ---------------------------
app.get("/api/face/:email", async (req, res) => {
  try {
    const email = req.params.email;
    const safeEmail = email.replace(/[@.]/g, "_");
    const filePath = path.join(__dirname, "faces", `${safeEmail}.jpg`);

    console.log("📌 Loading face from:", filePath);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "Face image not found" });
    }

    res.setHeader("Content-Type", "image/jpeg");
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    console.error("❌ Error fetching face:", err);
    res.status(500).json({ error: "Failed to load face image" });
  }
});

// ---------------------------
// Start Server
// ---------------------------
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
