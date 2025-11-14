/*
Optimized Face Login (Full File)
- Ultra-fast real-time scanning (auto-scan, no capture button required)
- Smart matching with fallback model URL
- Preloads stored face descriptors after models are loaded
- Keeps email/password login behavior
- Camera switching, cancel, and robust error handling

Usage:
- Replace your existing JS file with this file (or import it)
- Make sure models/ and faces/ are available on your hosting (CORS may apply)
- If GitHub Pages models fail, the file will try raw.githubusercontent as a fallback
*/

// ================================
// ✅ Configuration Variables
// ================================
let MODEL_URL = "https://cingcing12.github.io/System_Dashboard/models/"; // primary
const MODEL_URL_FALLBACK = "https://raw.githubusercontent.com/cingcing12/System_Dashboard/main/models/";
let modelsLoaded = false;
let streamRef = null;
let currentFacing = "user"; // "user" = front, "environment" = back
const THRESHOLD = 0.55; // similarity threshold (tunable 0.5-0.6)
let storedDescriptors = []; // { email, descriptor: Float32Array }
let scanning = false; // real-time scan state

// Detector options (balance speed & accuracy)
const detectorOptions = () => new faceapi.TinyFaceDetectorOptions({ inputSize: 192, scoreThreshold: 0.45 });

// ================================
// ✅ Email + Password Login (unchanged behavior)
// ================================
document.getElementById("loginBtn")?.addEventListener("click", loginUser);

async function loginUser() {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value.trim();
  if (!email || !password) return alert("Enter email and password!");

  try {
    const res = await fetch(sheetUrl(SHEET_USERS));
    const json = await res.json();
    const users = Array.isArray(json) ? json.slice(1) : [];
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
// ✅ DOM Elements for Face Login
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
// ✅ Load Face Recognition Models (with fallback)
// ================================
async function loadModels() {
  if (modelsLoaded) return;
  faceMsg && (faceMsg.textContent = "Loading face recognition models...");

  try {
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]);
    modelsLoaded = true;
    console.log("✅ Face models loaded successfully from primary URL.");
    return;
  } catch (err) {
    console.warn("Primary MODEL_URL failed, trying fallback...", err);
  }

  // fallback attempt
  try {
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL_FALLBACK),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL_FALLBACK),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL_FALLBACK),
    ]);
    modelsLoaded = true;
    MODEL_URL = MODEL_URL_FALLBACK;
    console.log("✅ Face models loaded successfully from fallback URL.");
  } catch (err) {
    console.error("❌ Failed to load face models from both URLs:", err);
    faceMsg && (faceMsg.textContent = "Error loading face models. Check model paths and CORS.");
    throw err; // let caller handle
  }
}

// ================================
// ✅ Preload Stored Faces (cached descriptors)
// - Must be called AFTER models are loaded
// ================================
async function preloadStoredFaces() {
  try {
    const res = await fetch(sheetUrl(SHEET_USERS));
    const json = await res.json();
    const users = Array.isArray(json) ? json.slice(1) : [];
    storedDescriptors = [];

    for (const u of users) {
      try {
        if (!u.FaceImageFile || u.IsBlocked === "TRUE") continue;
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = `${MODEL_URL.replace(/models\/?$/, '')}faces/${u.FaceImageFile}`; // build path relative to models host

        await img.decode();
        const desc = await getDescriptorFromImage(img, detectorOptions());
        if (desc) {
          storedDescriptors.push({ email: u.Email, descriptor: desc });
        } else {
          console.warn("No descriptor for:", u.Email, u.FaceImageFile);
        }
      } catch (err) {
        console.warn("Failed loading face image for user:", u.Email, err);
      }
    }

    console.log(`✅ Stored faces preloaded: ${storedDescriptors.length}`);
    return storedDescriptors.length;
  } catch (err) {
    console.error("❌ Failed to preload stored faces:", err);
    return 0;
  }
}

// ================================
// ✅ Get Face Descriptor
// ================================
async function getDescriptorFromImage(imgOrCanvas, options = detectorOptions()) {
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
  // both are Float32Array
  let sum = 0;
  for (let i = 0; i < d1.length; i++) {
    const diff = d1[i] - d2[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

// ================================
// ✅ Camera Controls
// ================================
async function startCamera() {
  stopCamera();
  try {
    streamRef = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: currentFacing },
      audio: false,
    });
    video.srcObject = streamRef;
    await video.play();
    faceMsg && (faceMsg.textContent = `Using ${currentFacing === "user" ? "front" : "back"} camera. Please face the camera.`);
  } catch (err) {
    console.error("❌ Camera access error:", err);
    faceMsg && (faceMsg.textContent = "Cannot access camera: " + (err.message || err));
    throw err;
  }
}

function stopCamera() {
  if (streamRef) {
    streamRef.getTracks().forEach(t => t.stop());
    streamRef = null;
  }
  try { video.pause(); } catch (e) {}
  video.srcObject = null;
}

// ================================
// ✅ Real-time Fast Scan Loop
// - Uses requestAnimationFrame for smoothness
// - Matches single live descriptor to stored descriptors
// ================================
let rafId = null;

async function startFastScan() {
  if (scanning) return;
  scanning = true;
  faceMsg && (faceMsg.textContent = "Scanning... please face the camera.");

  const ctx = snapshot.getContext("2d");

  const loop = async () => {
    if (!scanning) return;

    // draw current video frame to canvas
    snapshot.width = video.videoWidth;
    snapshot.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, snapshot.width, snapshot.height);

    try {
      const detection = await faceapi
        .detectSingleFace(snapshot, detectorOptions())
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (detection && detection.descriptor) {
        const liveDesc = detection.descriptor;

        // find best match
        let bestMatch = null;
        let bestDistance = Infinity;

        for (const s of storedDescriptors) {
          const dist = euclideanDistance(liveDesc, s.descriptor);
          if (dist < bestDistance) {
            bestDistance = dist;
            bestMatch = s;
          }
        }

        console.log("Live match distance:", bestDistance);

        if (bestMatch && bestDistance <= THRESHOLD) {
          scanning = false;
          faceMsg && (faceMsg.textContent = `✅ Face matched (${bestMatch.email}). Logging in...`);
          await completeFaceLogin(bestMatch.email);
          return; // stop loop
        }
      }
    } catch (err) {
      console.warn("Detection error in loop:", err);
    }

    rafId = requestAnimationFrame(loop);
  };

  rafId = requestAnimationFrame(loop);
}

function stopFastScan() {
  scanning = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
}

// ================================
// ✅ Complete face login flow after match
// ================================
async function completeFaceLogin(email) {
  try {
    const res = await fetch(sheetUrl(SHEET_USERS));
    const json = await res.json();
    const user = Array.isArray(json) ? json.slice(1).find(u => u.Email === email) : null;

    if (!user) {
      faceMsg && (faceMsg.textContent = "❌ User not found.");
      return;
    }
    if (user.IsBlocked === "TRUE") return alert("❌ You are blocked by owner!");

    stopCamera();
    stopFastScan();
    faceModal.style.display = "none";
    await updateLastLoginAndRedirect(user);
  } catch (err) {
    console.error("Error completing face login:", err);
    faceMsg && (faceMsg.textContent = "Error completing login.");
  }
}

// ================================
// ✅ Event Wiring: open modal, load models, preload faces, start camera & scan
// ================================
faceLoginBtn?.addEventListener("click", async () => {
  faceMsg && (faceMsg.textContent = "Initializing face login...");
  try {
    await loadModels();
    await preloadStoredFaces();
    faceModal.style.display = "flex";
    await startCamera();
    startFastScan();
  } catch (err) {
    console.error("Face login initialization failed:", err);
    alert("Failed to start face login. Check console for details.");
  }
});

// cancel button
cancelFaceBtn?.addEventListener("click", () => {
  stopFastScan();
  stopCamera();
  faceModal.style.display = "none";
});

// switch camera
switchCamBtn?.addEventListener("click", async () => {
  currentFacing = currentFacing === "user" ? "environment" : "user";
  faceMsg && (faceMsg.textContent = `Switching to ${currentFacing === "user" ? "front" : "back"} camera...`);
  try {
    await startCamera();
  } catch (err) {
    console.error("Switch camera failed:", err);
  }
});

// optional: keep captureBtn for manual snapshot fallback
captureBtn?.addEventListener("click", async () => {
  // manual one-shot capture (fallback)
  snapshot.width = video.videoWidth;
  snapshot.height = video.videoHeight;
  const ctx = snapshot.getContext("2d");
  ctx.drawImage(video, 0, 0, snapshot.width, snapshot.height);
  const desc = await getDescriptorFromImage(snapshot, detectorOptions());
  if (!desc) return faceMsg && (faceMsg.textContent = "No face detected.");

  let bestMatch = null;
  let bestDistance = Infinity;
  for (const s of storedDescriptors) {
    const dist = euclideanDistance(desc, s.descriptor);
    if (dist < bestDistance) {
      bestDistance = dist;
      bestMatch = s;
    }
  }
  console.log("Manual capture distance:", bestDistance);
  if (bestMatch && bestDistance <= THRESHOLD) {
    await completeFaceLogin(bestMatch.email);
  } else {
    faceMsg && (faceMsg.textContent = "No matching face found. Try again.");
  }
});

// ================================
// ✅ Cleanup on page unload
// ================================
window.addEventListener('beforeunload', () => {
  stopFastScan();
  stopCamera();
});

// ================================
// ✅ Debug helper: show loaded descriptor count
// ================================
window.faceLoginDebug = () => ({ modelsLoaded, storedCount: storedDescriptors.length, currentFacing, scanning });

/*
Notes / Troubleshooting:
1. Make sure model files are reachable at MODEL_URL or fallback URL. Check console for 404/CORS errors.
2. Ensure faces are accessible (CORS) at the same host; we try to load faces from the same base as MODEL_URL.
3. THRESHOLD can be tuned: lower = stricter (fewer false accepts), higher = more tolerant.
4. If stored faces are low quality, re-register using a clear frontal image.
*/
