// ================================
// ✅ Configuration Variables
// ================================
const MODEL_URL = "https://cingcing12.github.io/System_Dashboard/models/";
let modelsLoaded = false;
let streamRef = null;
let currentFacing = "user";
const THRESHOLD = 0.5; // keep your threshold (lower = stricter)
let storedDescriptors = []; // { email, descriptor: Float32Array }
let cachedUsers = null;     // cache users to avoid duplicate fetches
let fetchingUsers = false;

// ================================
// ✅ Universal Block Check (robust)
// ================================
// Accepts different truthy representations: "true", " yes ", "1", 1, true
function isBlocked(user) {
  if (!user) return false;
  const v = user.IsBlocked ?? user.isBlocked ?? user.blocked ?? "";
  if (typeof v === "boolean") return v === true;
  return String(v).trim().toLowerCase() === "true"
      || String(v).trim().toLowerCase() === "yes"
      || String(v).trim() === "1";
}

// ================================
// ✅ Cached users fetch helper
// ================================
async function fetchUsers(force = false) {
  if (cachedUsers && !force) return cachedUsers;
  if (fetchingUsers) {
    // simple wait loop if another fetch is in progress
    while (fetchingUsers) {
      await new Promise(r => setTimeout(r, 50));
    }
    return cachedUsers;
  }

  try {
    fetchingUsers = true;
    const res = await fetch(sheetUrl(SHEET_USERS));
    const json = await res.json();
    // your sheet appears to have header row at index 0, actual users from index 1
    const users = Array.isArray(json) ? json.slice(1) : [];
    cachedUsers = users;
    return users;
  } catch (err) {
    console.error("❌ fetchUsers error:", err);
    throw err;
  } finally {
    fetchingUsers = false;
  }
}

// ================================
// ✅ Redirect already logged-in users
// ================================
(function redirectIfLoggedIn() {
  const storedUser = localStorage.getItem("user");
  if (storedUser) {
    try {
      const userObj = JSON.parse(storedUser);
      if (!isBlocked(userObj)) {
        window.location.href = "dashboard.html"; // Already logged in
      } else {
        localStorage.removeItem("user"); // Blocked user cannot stay logged in
        alert("You are blocked by owner!");
      }
    } catch (e) {
      console.warn("Invalid stored user, clearing.", e);
      localStorage.removeItem("user");
    }
  }
})();

// ================================
// ✅ Email + Password Login
// ================================
const loginBtn = document.getElementById("loginBtn");
if (loginBtn) loginBtn.addEventListener("click", loginUser);

async function loginUser() {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value.trim();
  if (!email || !password) return alert("Enter email and password!");

  try {
    const users = await fetchUsers();
    const user = users.find(u => String(u.Email).trim().toLowerCase() === email.toLowerCase());

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

  // update local object and persist
  try {
    user.LastLogin = now;
    localStorage.setItem("user", JSON.stringify(user));
  } catch (e) {
    console.warn("Failed to save to localStorage:", e);
  }

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

// Loading overlay element
const faceLoading = document.createElement("div");
faceLoading.className = "absolute inset-0 bg-black/50 flex justify-center items-center z-50 text-white text-lg font-bold";
faceLoading.textContent = "Loading face login...";
faceLoading.style.display = "none";
if (faceModal) faceModal.appendChild(faceLoading);

// ================================
// ✅ Load Face Models
// ================================
async function loadModels() {
  if (modelsLoaded) return;
  if (faceMsg) faceMsg.textContent = "Loading face recognition models...";
  try {
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]);
    modelsLoaded = true;
  } catch (err) {
    console.error("❌ Failed to load models:", err);
    if (faceMsg) faceMsg.textContent = "Error loading face models.";
    throw err;
  }
}

// ================================
// ✅ Preload Stored Faces (skip blocked) & convert descriptors to Array
// ================================
async function preloadStoredFaces() {
  storedDescriptors = [];
  try {
    const users = await fetchUsers();
    if (!users || !users.length) return;

    for (const u of users) {
      if (isBlocked(u)) continue;           // completely skip blocked users
      if (!u.FaceImageFile) continue;

      try {
        const img = new Image();
        img.crossOrigin = "anonymous"; // allow cross-origin image usage
        img.src = `https://cingcing12.github.io/System_Dashboard/faces/${u.FaceImageFile}`;
        await img.decode();

        const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.2 });
        const desc = await getDescriptorFromImage(img, options);

        if (!desc) continue;

        // copy descriptor into a plain Float32Array for safety
        const descriptorCopy = new Float32Array(desc.length);
        descriptorCopy.set(desc);

        storedDescriptors.push({
          email: u.Email,
          descriptor: descriptorCopy
        });
      } catch (imgErr) {
        console.warn(`Failed to load/describe face for ${u.Email}:`, imgErr);
        continue;
      }
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
// ✅ Euclidean Distance (works with TypedArrays)
// ================================
function euclideanDistance(d1, d2) {
  // d1 and d2 are Float32Array or Array-like
  let sum = 0;
  for (let i = 0; i < d1.length; i++) {
    const diff = d1[i] - d2[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

// ================================
// ✅ Start Face Login
// ================================
if (faceLoginBtn) {
  faceLoginBtn.addEventListener("click", async () => {
    if (!faceModal) return;
    faceModal.style.display = "flex";
    faceLoading.style.display = "flex";
    if (faceMsg) faceMsg.textContent = "Initializing camera...";

    try {
      await loadModels();
      await preloadStoredFaces();
      await startCamera();
      if (faceMsg) faceMsg.textContent = "Align your face with the camera.";
    } catch (err) {
      if (faceMsg) faceMsg.textContent = "❌ Error initializing face login.";
      console.error(err);
    } finally {
      faceLoading.style.display = "none";
    }
  });
}

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
    if (video) {
      video.srcObject = streamRef;
      try { await video.play(); } catch (e) { /* some browsers autoplay restrictions */ }
    }
  } catch (err) {
    console.error("❌ Camera error:", err);
    if (faceMsg) faceMsg.textContent = "Cannot access camera.";
    throw err;
  }
}

// ================================
// ✅ Switch Camera
// ================================
if (switchCamBtn) {
  switchCamBtn.addEventListener("click", async () => {
    currentFacing = currentFacing === "user" ? "environment" : "user";
    await startCamera();
  });
}

// ================================
// ✅ Cancel Face Login
// ================================
if (cancelFaceBtn) {
  cancelFaceBtn.addEventListener("click", () => {
    stopCamera();
    if (faceModal) faceModal.style.display = "none";
  });
}

// ================================
// ✅ Stop Camera
// ================================
function stopCamera() {
  if (streamRef) {
    streamRef.getTracks().forEach(t => t.stop());
    streamRef = null;
  }
  if (video) {
    try { video.pause(); } catch (e) {}
    video.srcObject = null;
  }
}

// ================================
// ✅ Capture & Match Face (with protections)
// ================================
if (captureBtn) {
  captureBtn.addEventListener("click", async () => {
    // disable button while processing
    captureBtn.disabled = true;
    if (faceMsg) faceMsg.textContent = "Capturing face...";

    try {
      if (!video || video.readyState < 2) {
        if (faceMsg) faceMsg.textContent = "Camera not ready.";
        return;
      }

      const descriptors = [];
      snapshot.width = video.videoWidth || 480;
      snapshot.height = video.videoHeight || 360;
      const ctx = snapshot.getContext("2d");

      // capture several frames to average out noise
      for (let i = 0; i < 2; i++) {
        ctx.drawImage(video, 0, 0, snapshot.width, snapshot.height);
        const desc = await getDescriptorFromImage(snapshot, new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.2 }));
        if (desc) descriptors.push(new Float32Array(desc)); // copy
        await new Promise(r => setTimeout(r, 200));
      }

      if (!descriptors.length) {
        if (faceMsg) faceMsg.textContent = "❌ No face detected. Try again.";
        return;
      }

      if (!storedDescriptors.length) {
        if (faceMsg) faceMsg.textContent = "❌ No enrolled faces available.";
        return;
      }

      if (faceMsg) faceMsg.textContent = "Matching face...";

      // find best match among storedDescriptors (storedDescriptors only contains non-blocked users)
      let bestMatch = null;
      let bestDistance = Infinity;

      for (const s of storedDescriptors) {
        // compute average distance from the captured descriptors to this stored descriptor
        let total = 0;
        for (const d of descriptors) {
          total += euclideanDistance(d, s.descriptor);
        }
        const avgDist = total / descriptors.length;
        if (avgDist < bestDistance) {
          bestDistance = avgDist;
          bestMatch = s;
        }
      }

      if (!bestMatch || bestDistance > THRESHOLD) {
        if (faceMsg) faceMsg.textContent = "❌ No matching face.";
        return;
      }

      // Double-check the matched user's status from the server (use cached users to avoid extra network if possible)
      try {
        const users = await fetchUsers(); // uses cache
        const user = users.find(u => String(u.Email).trim().toLowerCase() === String(bestMatch.email).trim().toLowerCase());

        if (!user) {
          if (faceMsg) faceMsg.textContent = "❌ User not found!";
          stopCamera();
          return;
        }

        if (isBlocked(user)) {
          // This should not normally happen because we excluded blocked users when preloading,
          // but double-checking here for safety.
          if (faceMsg) faceMsg.textContent = "❌ This face belongs to a BLOCKED user!";
          stopCamera();
          return;
        }

        // Allowed: login now
        stopCamera();
        if (faceModal) faceModal.style.display = "none";
        await updateLastLoginAndRedirect(user);

      } catch (err) {
        console.error("Error fetching users during match:", err);
        if (faceMsg) faceMsg.textContent = "Error connecting to server.";
      }

    } catch (err) {
      console.error("Capture/Match error:", err);
      if (faceMsg) faceMsg.textContent = "Error during face capture.";
    } finally {
      captureBtn.disabled = false;
    }
  });
}
