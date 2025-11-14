// ================================
// ⚡ Configuration Variables
// ================================
const MODEL_URL = "https://raw.githubusercontent.com/cingcing12/System_Dashboard/main/models"; // GitHub raw URL for models
let modelsLoaded = false;
let streamRef = null;
let currentFacing = "user"; // "user" = front, "environment" = back
const CAPTURE_COUNT = 3; // number of frames to capture for matching
const THRESHOLD = 0.5; // stricter threshold

// ----------------------------
// DOM Elements
// ----------------------------
const faceLoginBtn = document.getElementById("faceLoginBtn");
const faceModal = document.getElementById("faceModal");
const video = document.getElementById("video");
const snapshot = document.getElementById("snapshot");
const captureBtn = document.getElementById("captureBtn");
const cancelFaceBtn = document.getElementById("cancelFaceBtn");
const switchCamBtn = document.getElementById("switchCamBtn");
const faceMsg = document.getElementById("faceMsg");

// ================================
// ⚡ Load Face Recognition Models
// ================================
async function loadModels() {
  if (modelsLoaded) return;
  faceMsg.textContent = "Loading face recognition models...";
  try {
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]);
    modelsLoaded = true;
    console.log("✅ Face models loaded successfully.");
  } catch (err) {
    console.error("❌ Failed to load models:", err);
    faceMsg.textContent = "Error loading face models.";
  }
}

// ================================
// ⚡ Camera Functions
// ================================
async function startCamera() {
  stopCamera();
  try {
    streamRef = await navigator.mediaDevices.getUserMedia({
      video: { width: 480, height: 360, facingMode: currentFacing },
      audio: false,
    });
    video.srcObject = streamRef;
    faceMsg.textContent = `Using ${currentFacing === "user" ? "front" : "back"} camera. Align your face.`;
  } catch (err) {
    console.error("❌ Camera access error:", err);
    faceMsg.textContent = "Cannot access camera: " + (err.message || err);
  }
}

function stopCamera() {
  if (streamRef) {
    streamRef.getTracks().forEach(t => t.stop());
    streamRef = null;
  }
  video.srcObject = null;
}

switchCamBtn.addEventListener("click", async () => {
  currentFacing = currentFacing === "user" ? "environment" : "user";
  faceMsg.textContent = `Switching to ${currentFacing === "user" ? "front" : "back"} camera...`;
  await startCamera();
});

cancelFaceBtn.addEventListener("click", () => {
  stopCamera();
  faceModal.style.display = "none";
});

// ================================
// ⚡ Face Descriptor & Matching
// ================================
async function getDescriptorFromImage(imgOrCanvas, options = new faceapi.TinyFaceDetectorOptions({ inputSize: 512 })) {
  try {
    const detection = await faceapi
      .detectSingleFace(imgOrCanvas, options)
      .withFaceLandmarks()
      .withFaceDescriptor();
    return detection ? detection.descriptor : null;
  } catch (err) {
    console.error("❌ Error detecting face:", err);
    return null;
  }
}

function euclideanDistance(d1, d2) {
  return Math.sqrt(d1.reduce((sum, v, i) => sum + (v - d2[i]) ** 2, 0));
}

// ================================
// ⚡ Capture & Match Face
// ================================
captureBtn.addEventListener("click", async () => {
  faceMsg.textContent = "Capturing your face...";
  await loadModels();

  const liveDescriptors = [];

  snapshot.width = video.videoWidth;
  snapshot.height = video.videoHeight;
  const ctx = snapshot.getContext("2d");

  for (let i = 0; i < CAPTURE_COUNT; i++) {
    ctx.filter = "brightness(1.2) contrast(1.2)";
    ctx.drawImage(video, 0, 0, snapshot.width, snapshot.height);

    const desc = await getDescriptorFromImage(snapshot);
    if (desc) liveDescriptors.push(desc);

    await new Promise(r => setTimeout(r, 300));
  }

  if (!liveDescriptors.length) {
    faceMsg.textContent = "❌ Failed to capture any face. Try again.";
    return;
  }

  faceMsg.textContent = "Matching with stored faces...";

  try {
    const res = await fetch(sheetUrl(SHEET_USERS));
    const json = await res.json();
    const users = json.slice(1); // skip header row

    let bestMatch = null;
    let bestDistance = Infinity;

    for (const u of users) {
      if (!u.FaceImageFile) continue;

      try {
        const faceRes = await fetch(`/api/face/${encodeURIComponent(u.Email)}`);
        if (!faceRes.ok) continue;

        const blob = await faceRes.blob();
        const img = await createImageBitmap(blob);

        const desc = await getDescriptorFromImage(img);
        if (!desc) continue;

        const avgDistance =
          liveDescriptors.reduce((sum, d) => sum + euclideanDistance(d, desc), 0) /
          liveDescriptors.length;

        if (avgDistance < bestDistance) {
          bestDistance = avgDistance;
          bestMatch = u;
        }
      } catch (err) {
        console.warn("⚠️ Error loading face for", u.Email, err);
      }
    }

    console.log("🎯 Best match distance:", bestDistance);

    if (bestMatch && bestDistance <= THRESHOLD) {
      faceMsg.textContent = `✅ Face matched: ${bestMatch.Email}. Logging in...`;
      stopCamera();
      faceModal.style.display = "none";
      await updateLastLoginAndRedirect(bestMatch);
    } else {
      faceMsg.textContent = "❌ No matching face found. Try again.";
    }
  } catch (err) {
    console.error("❌ Face login error:", err);
    faceMsg.textContent = "Error during face login.";
  }
});

// ================================
// ⚡ Email + Password Login
// ================================
document.getElementById("loginBtn").addEventListener("click", loginUser);

async function loginUser() {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value.trim();
  if (!email || !password) return alert("Enter email and password!");

  try {
    const res = await fetch(sheetUrl(SHEET_USERS));
    const json = await res.json();
    const users = json.slice(1);
    const user = users.find(u => u.Email === email);

    if (!user) return alert("User not found!");
    if (user.IsBlocked === "TRUE") return alert("Account blocked!");
    if (user.PasswordHash !== password) return alert("Wrong password!");

    await updateLastLoginAndRedirect(user);
  } catch (err) {
    console.error(err);
    alert("Error connecting to server.");
  }
}

// ================================
// ⚡ Update Last Login & Redirect
// ================================
async function updateLastLoginAndRedirect(user) {
  const now = new Date().toISOString();
  const email = user.Email;
  const patchUrl = `${SHEETDB_BASE_URL}/Email/${encodeURIComponent(email)}`;

  try {
    await fetch(patchUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: [{ LastLogin: now }] }),
    });
  } catch (err) {
    console.warn("⚠️ Failed to update last login:", err);
  }

  user.LastLogin = now;
  localStorage.setItem("user", JSON.stringify(user));
  window.location.href = "dashboard.html";
}
