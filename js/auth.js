// ================================
// ✅ Configuration Variables
// ================================
const MODEL_URL = "https://cingcing12.github.io/System_Dashboard/models/"; // path to face-api.js models
let modelsLoaded = false;
let streamRef = null;
let currentFacing = "user"; // "user" = front, "environment" = back
const THRESHOLD = 0.5; // similarity threshold
let storedDescriptors = []; // cache stored face descriptors


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
    const users = json.slice(1); // skip headers
    const user = users.find(u => u.Email === email);

    if (!user) return alert("User not found!");
    if (user.IsBlocked === "TRUE") return alert("❌ You are blocked by owner!");
    if (user.PasswordHash !== password) return alert("Wrong password!");

    await updateLastLoginAndRedirect(user);
  } catch (err) {
    console.error(err);
    alert("Error connecting to server.");
  }
}

// ================================
// ✅ Shared Function: Update Last Login
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
// ✅ Face Login Feature
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
// ✅ Load Face Recognition Models
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
// ✅ Preload Stored Faces (Cached)
async function preloadStoredFaces() {
  try {
    const res = await fetch(sheetUrl(SHEET_USERS));
    const json = await res.json();
    const users = json.slice(1);
    storedDescriptors = [];

    for (const u of users) {
      if (!u.FaceImageFile || u.IsBlocked === "TRUE") continue;
      const img = new Image();
      img.src = `https://cingcing12.github.io/System_Dashboard/faces/${u.FaceImageFile}`;
      await img.decode();
      const desc = await getDescriptorFromImage(img, new faceapi.TinyFaceDetectorOptions({inputSize:160, scoreThreshold:0.2}));
      if (desc) storedDescriptors.push({email: u.Email, descriptor: desc});
    }
    console.log("✅ Stored faces preloaded:", storedDescriptors.length);
  } catch (err) {
    console.error("❌ Failed to preload stored faces:", err);
  }
}

// ================================
// ✅ Get Face Descriptor
// ================================
async function getDescriptorFromImage(imgOrCanvas, options = new faceapi.TinyFaceDetectorOptions({inputSize:512})) {
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
    faceMsg.textContent = `Using ${currentFacing === "user" ? "front" : "back"} camera. Align your face and blink or move slightly.`;
  } catch (err) {
    console.error("❌ Camera access error:", err);
    faceMsg.textContent = "Cannot access camera: " + (err.message || err);
  }
}

// ================================
// ✅ Switch Camera
switchCamBtn.addEventListener("click", async () => {
  currentFacing = currentFacing === "user" ? "environment" : "user";
  faceMsg.textContent = `Switching to ${currentFacing === "user" ? "front" : "back"} camera...`;
  await startCamera();
});

// ================================
// ✅ Cancel Face Login
cancelFaceBtn.addEventListener("click", () => {
  stopCamera();
  faceModal.style.display = "none";
});

// ================================
// ✅ Stop Camera
function stopCamera() {
  if (streamRef) {
    streamRef.getTracks().forEach(t => t.stop());
    streamRef = null;
  }
  video.srcObject = null;
}

// ================================
// ✅ Capture & Match (Fast & Smart)
captureBtn.addEventListener("click", async () => {
  faceMsg.textContent = "Capturing your face...";
  const liveDescriptors = [];

  snapshot.width = video.videoWidth;
  snapshot.height = video.videoHeight;
  const ctx = snapshot.getContext("2d");

  for (let i = 0; i < 2; i++) { // only 2 frames for speed
    ctx.drawImage(video, 0, 0, snapshot.width, snapshot.height);
    const desc = await getDescriptorFromImage(snapshot, new faceapi.TinyFaceDetectorOptions({inputSize:160, scoreThreshold:0.2}));
    if (desc) liveDescriptors.push(desc);
    await new Promise(r => setTimeout(r, 200));
  }

  if (!liveDescriptors.length) {
    faceMsg.textContent = "❌ No face detected. Try again.";
    return;
  }

  faceMsg.textContent = "Matching with stored faces...";
  let bestMatch = null;
  let bestDistance = Infinity;

  for (const s of storedDescriptors) {
    const avgDist = liveDescriptors.reduce((sum, d) => sum + euclideanDistance(d, s.descriptor), 0) / liveDescriptors.length;
    if (avgDist < bestDistance) {
      bestDistance = avgDist;
      bestMatch = s;
    }
  }

  console.log("🎯 Best match distance:", bestDistance);

  if (bestMatch && bestDistance <= THRESHOLD) {
    faceMsg.textContent = `✅ Face matched: ${bestMatch.email}. Logging in...`;

    // Fetch user again to check block status
    const res = await fetch(sheetUrl(SHEET_USERS));
    const json = await res.json();
    const user = json.slice(1).find(u => u.Email === bestMatch.email);

    if (!user) return faceMsg.textContent = "❌ User not found.";
    if (user.IsBlocked === "TRUE") return alert("❌ You are blocked by owner!");

    stopCamera();
    faceModal.style.display = "none";
    await updateLastLoginAndRedirect(user);
  } else {
    faceMsg.textContent = "❌ No matching face found. Try again.";
  }
});
