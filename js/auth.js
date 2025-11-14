// ================================
// ✅ Configuration Variables
// ================================
const MODEL_URL = "./models"; // path to face-api.js models
let modelsLoaded = false;
let streamRef = null;
let currentFacing = "user"; // "user" = front, "environment" = back
const CAPTURE_COUNT = 3; // number of frames to capture for matching
const THRESHOLD = 0.5; // stricter threshold

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
    if (user.IsBlocked === "TRUE") return alert("Account blocked!");
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
// ✅ Get Face Descriptor
// ================================
async function getDescriptorFromImage(imgOrCanvas) {
  try {
    const detection = await faceapi
      .detectSingleFace(
        imgOrCanvas,
        new faceapi.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.3 })
      )
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

// ✅ Switch Camera
switchCamBtn.addEventListener("click", async () => {
  currentFacing = currentFacing === "user" ? "environment" : "user";
  faceMsg.textContent = `Switching to ${currentFacing === "user" ? "front" : "back"} camera...`;
  await startCamera();
});

// ✅ Cancel Face Login
cancelFaceBtn.addEventListener("click", () => {
  stopCamera();
  faceModal.style.display = "none";
});

// ✅ Stop Camera
function stopCamera() {
  if (streamRef) {
    streamRef.getTracks().forEach(t => t.stop());
    streamRef = null;
  }
  video.srcObject = null;
}

// ================================
// ✅ Capture & Match Optimized
// ================================
captureBtn.addEventListener("click", async () => {
  faceMsg.textContent = "Capturing your face...";
  const CAPTURE_COUNT_MOBILE = 5; // more frames for mobile
  const liveDescriptors = [];

  // Ensure canvas matches video
  snapshot.width = video.videoWidth;
  snapshot.height = video.videoHeight;

  const ctx = snapshot.getContext("2d");

  for (let i = 0; i < CAPTURE_COUNT_MOBILE; i++) {
    // Draw video frame on canvas with slight brightness/contrast boost
    ctx.filter = "brightness(1.2) contrast(1.2)";
    ctx.drawImage(video, 0, 0, snapshot.width, snapshot.height);

    const options = new faceapi.TinyFaceDetectorOptions({
      inputSize: 224,      // mobile-friendly
      scoreThreshold: 0.2  // easier detection
    });

    const desc = await getDescriptorFromImage(snapshot, options);
    if (!desc) {
      faceMsg.textContent =
        "No face detected. Make sure lighting is good and move slightly.";
      await new Promise(r => setTimeout(r, 200)); // wait a bit before retry
      continue; // try next frame
    }

    liveDescriptors.push(desc);
    await new Promise(r => setTimeout(r, 300)); // wait 0.3s between frames
  }

  if (!liveDescriptors.length) {
    faceMsg.textContent = "❌ Failed to capture any face. Try again.";
    return;
  }

  faceMsg.textContent = "Matching with stored faces...";

  try {
    const res = await fetch(sheetUrl(SHEET_USERS));
    const json = await res.json();
    const users = json.slice(1);

    let bestMatch = null;
    let bestDistance = Infinity;

    for (const u of users) {
      if (!u.FaceImageFile) continue;

      const img = new Image();
      img.src = `/faces/${u.FaceImageFile}`;
      await img.decode();

      const options = new faceapi.TinyFaceDetectorOptions({
        inputSize: 224,
        scoreThreshold: 0.2
      });

      const desc = await faceapi
        .detectSingleFace(img, options)
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (!desc) continue;

      const avgDistance =
        liveDescriptors.reduce((sum, d) => sum + euclideanDistance(d, desc.descriptor), 0) /
        liveDescriptors.length;

      if (avgDistance < bestDistance) {
        bestDistance = avgDistance;
        bestMatch = u;
      }
    }

    console.log("🎯 Best match distance:", bestDistance);



    if (bestMatch && bestDistance <= THRESHOLD) {
      faceMsg.textContent = `✅ Face matched: ${bestMatch.Email}. Logging in...`;
      stopCamera();
      faceModal.style.display = "none";
      await updateLastLoginAndRedirect(bestMatch);
    } else {
      faceMsg.textContent =
        "❌ No matching face found. Make sure your face matches the stored image and you move slightly.";
    }
  } catch (err) {
    console.error("❌ Face login error:", err);
    faceMsg.textContent = "Error during face login.";
  }
});

// ================================
// ✅ Updated getDescriptorFromImage to accept options
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