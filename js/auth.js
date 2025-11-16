// ================================
// ✅ Configuration Variables
// ================================
const MODEL_URL = "https://cingcing12.github.io/System_Dashboard/models/"; 
let modelsLoaded = false;
let streamRef = null;
let currentFacing = "user"; 
const THRESHOLD = 0.5; 
let storedDescriptors = []; 

// ================================
// ✅ Universal Block Check
// ================================
function isBlocked(user) {
  return String(user.IsBlocked).trim().toLowerCase() === "true";
}

// ================================
// ✅ Email + Password Login
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
    if (isBlocked(user)) return alert("❌ You are blocked by owner!");
    if (user.PasswordHash !== password) return alert("Wrong password!");

    await updateLastLoginAndRedirect(user);

  } catch (err) {
    console.error(err);
    alert("Error connecting to server.");
  }
}

// ================================
// ✅ Update Last Login
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

// ================================
// ✅ Face Login Elements
// ================================
const faceLoginBtn = document.getElementById("faceLoginBtn");
const faceModal = document.getElementById("faceModal");
const video = document.getElementById("video");
const snapshot = document.getElementById("snapshot");
const captureBtn = document.getElementById("captureBtn");
const cancelFaceBtn = document.getElementById("cancelFaceBtn");
const switchCamBtn = document.getElementById("switchCamBtn");
const faceMsg = document.getElementById("faceMsg");

// ================================
// ✅ Load Face Models
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
  } catch (err) {
    console.error("❌ Failed to load models:", err);
    faceMsg.textContent = "Error loading face models.";
  }
}

// ================================
// ✅ Preload Stored Faces (skip blocked)
// ================================
async function preloadStoredFaces() {
  try {
    const res = await fetch(sheetUrl(SHEET_USERS));
    const json = await res.json();
    const users = json.slice(1);

    storedDescriptors = [];

    for (const u of users) {
      if (!u.FaceImageFile || isBlocked(u)) continue;

      const img = new Image();
      img.src = `https://cingcing12.github.io/System_Dashboard/faces/${u.FaceImageFile}`;
      await img.decode();

      const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.2 });
      const desc = await getDescriptorFromImage(img, options);

      if (desc) storedDescriptors.push({ email: u.Email, descriptor: desc });
    }

  } catch (err) {
    console.error("❌ Failed to preload stored faces:", err);
  }
}

// ================================
// ✅ Extract Descriptor
// ================================
async function getDescriptorFromImage(source, options) {
  try {
    const detection = await faceapi
      .detectSingleFace(source, options)
      .withFaceLandmarks()
      .withFaceDescriptor();
    return detection ? detection.descriptor : null;
  } catch (err) {
    console.error("❌ Face detect error:", err);
    return null;
  }
}

// ================================
// ✅ Euclidean Distance
// ================================
function euclideanDistance(d1, d2) {
  return Math.sqrt(d1.reduce((sum, v, i) => sum + (v - d2[i]) ** 2, 0));
}

// ================================
// ✅ Start Face Login
// ================================
faceLoginBtn.addEventListener("click", async () => {
  faceMsg.textContent = "Initializing camera...";
  await loadModels();
  await preloadStoredFaces();
  faceModal.style.display = "flex";
  await startCamera();
});

// ================================
// ✅ Start Camera
// ================================
async function startCamera() {
  stopCamera();
  try {
    streamRef = await navigator.mediaDevices.getUserMedia({
      video: { width: 480, height: 360, facingMode: currentFacing },
      audio: false,
    });
    video.srcObject = streamRef;
    faceMsg.textContent = "Align your face with the camera.";
  } catch (err) {
    console.error("❌ Camera error:", err);
    faceMsg.textContent = "Cannot access camera.";
  }
}

// ================================
// ✅ Switch Camera
// ================================
switchCamBtn.addEventListener("click", async () => {
  currentFacing = currentFacing === "user" ? "environment" : "user";
  faceMsg.textContent = "Switching camera...";
  await startCamera();
});

// ================================
// ✅ Cancel Face Login
// ================================
cancelFaceBtn.addEventListener("click", () => {
  stopCamera();
  faceModal.style.display = "none";
});

// ================================
// ✅ Stop Camera
// ================================
function stopCamera() {
  if (streamRef) {
    streamRef.getTracks().forEach(t => t.stop());
    streamRef = null;
  }
  video.srcObject = null;
}

// ================================
// ✅ Capture & Match Face
// ================================
captureBtn.addEventListener("click", async () => {
  faceMsg.textContent = "Capturing face...";

  const descriptors = [];

  snapshot.width = video.videoWidth;
  snapshot.height = video.videoHeight;
  const ctx = snapshot.getContext("2d");

  for (let i = 0; i < 2; i++) {
    ctx.drawImage(video, 0, 0);
    const desc = await getDescriptorFromImage(snapshot, new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.2 }));
    if (desc) descriptors.push(desc);
    await new Promise(r => setTimeout(r, 200));
  }

  if (!descriptors.length) {
    faceMsg.textContent = "❌ No face detected. Try again.";
    return;
  }

  faceMsg.textContent = "Matching face...";
  let bestMatch = null;
  let bestDistance = Infinity;

  for (const s of storedDescriptors) {
    const avgDist = descriptors.reduce((sum, d) => sum + euclideanDistance(d, s.descriptor), 0) / descriptors.length;
    if (avgDist < bestDistance) {
      bestDistance = avgDist;
      bestMatch = s;
    }
  }

  if (!bestMatch || bestDistance > THRESHOLD) {
    faceMsg.textContent = "❌ No matching face.";
    return;
  }

  faceMsg.textContent = "Face match found! Checking user...";

  // Reload user to verify block status
  const res = await fetch(sheetUrl(SHEET_USERS));
  const json = await res.json();
  const user = json.slice(1).find(u => u.Email === bestMatch.email);

  if (!user) return faceMsg.textContent = "❌ User not found!";
  if (isBlocked(user)) return faceMsg.textContent = "❌ You are blocked by owner!";

  stopCamera();
  faceModal.style.display = "none";
  await updateLastLoginAndRedirect(user);
});
