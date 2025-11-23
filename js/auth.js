// ================================
// Full updated login + face-login script (fixed false-positive / final verification)
// ================================

// -------------------------------
// Configuration
// -------------------------------
const MODEL_URL = "https://cingcing12.github.io/System_Dashboard/models/";
let modelsLoaded = false;
let streamRef = null;
let currentFacing = "user";

// stricter settings to reduce false positives
const THRESHOLD = 0.38; // primary acceptance threshold (lower = stricter)
const AMBIGUITY_DELTA = 0.12; // require second-best to be sufficiently worse
const FINAL_VERIFICATION_THRESHOLD = 0.40; // final check against matched user's stored image
const CAPTURE_SAMPLES = 4; // number of frames to capture and average
let storedDescriptors = []; // { email, descriptor: Float32Array }
let cachedUsers = null;
let fetchingUsers = false;

// -------------------------------
// Utility: robust blocked checker
// -------------------------------
function isBlocked(user) {
  if (!user) return false;
  const v = user.IsBlocked ?? user.isBlocked ?? user.blocked ?? "";
  if (typeof v === "boolean") return v === true;
  const s = String(v).trim().toLowerCase();
  return s === "true" || s === "yes" || s === "1";
}

// -------------------------------
// Utility: L2 normalize a Float32Array
// -------------------------------
function l2Normalize(arr) {
  const out = new Float32Array(arr.length);
  let sum = 0;
  for (let i = 0; i < arr.length; i++) sum += arr[i] * arr[i];
  const norm = Math.sqrt(sum) || 1;
  for (let i = 0; i < arr.length; i++) out[i] = arr[i] / norm;
  return out;
}

// -------------------------------
// Euclidean distance (assumes same length)
// -------------------------------
function euclideanDistance(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s);
}

// -------------------------------
// Fetch users (cached) helper
// -------------------------------
async function fetchUsers(force = false) {
  if (cachedUsers && !force) return cachedUsers;
  if (fetchingUsers) {
    while (fetchingUsers) await new Promise(r => setTimeout(r, 50));
    return cachedUsers;
  }
  try {
    fetchingUsers = true;
    const res = await fetch(sheetUrl(SHEET_USERS));
    const json = await res.json();
    const users = Array.isArray(json) ? json.slice(1) : [];
    cachedUsers = users;
    return users;
  } catch (err) {
    console.error('fetchUsers error', err);
    throw err;
  } finally {
    fetchingUsers = false;
  }
}

// -------------------------------
// Redirect if already logged in
// -------------------------------
(function redirectIfLoggedIn() {
  const storedUser = localStorage.getItem('user');
  if (!storedUser) return;
  try {
    const u = JSON.parse(storedUser);
    if (!isBlocked(u)) {
      window.location.href = 'dashboard.html';
    } else {
      localStorage.removeItem('user');
      alert('You are blocked by owner!');
    }
  } catch (e) {
    localStorage.removeItem('user');
  }
})();

// -------------------------------
// Email/password login
// -------------------------------
const loginBtn = document.getElementById('loginBtn');
if (loginBtn) loginBtn.addEventListener('click', loginUser);

async function loginUser() {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value.trim();
  if (!email || !password) return alert('Enter email and password!');
  try {
    const users = await fetchUsers();
    const user = users.find(u => String(u.Email).trim().toLowerCase() === email.toLowerCase());
    if (!user) return alert('User not found!');
    if (isBlocked(user)) return alert('❌ You are blocked by owner!');
    if (user.PasswordHash !== password) return alert('Wrong password!');
    await updateLastLoginAndRedirect(user);
  } catch (err) {
    console.error(err);
    alert('Error connecting to server.');
  }
}

// -------------------------------
// Update last login & redirect
// -------------------------------
async function updateLastLoginAndRedirect(user) {
  const now = new Date().toISOString();
  const email = user.Email;
  const patchUrl = `${SHEETDB_BASE_URL}/Email/${encodeURIComponent(email)}`;
  try {
    await fetch(patchUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [{ LastLogin: now }] })
    });
  } catch (err) {
    console.warn('Failed to update last login', err);
  }
  try { user.LastLogin = now; localStorage.setItem('user', JSON.stringify(user)); } catch(e){/*ignore*/}
  window.location.href = 'dashboard.html';
}

// -------------------------------
// Face login UI elements
// -------------------------------
const faceLoginBtn = document.getElementById('faceLoginBtn');
const faceModal = document.getElementById('faceModal');
const video = document.getElementById('video');
const snapshot = document.getElementById('snapshot');
const captureBtn = document.getElementById('captureBtn');
const cancelFaceBtn = document.getElementById('cancelFaceBtn');
const switchCamBtn = document.getElementById('switchCamBtn');
const faceMsg = document.getElementById('faceMsg');

// loading overlay
const faceLoading = document.createElement('div');
faceLoading.className = 'absolute inset-0 bg-black/50 flex justify-center items-center z-50 text-white text-lg font-bold';
faceLoading.textContent = 'Loading face login...';
faceLoading.style.display = 'none';
if (faceModal) faceModal.appendChild(faceLoading);

// -------------------------------
// Load face-api models
// -------------------------------
async function loadModels() {
  if (modelsLoaded) return;
  if (faceMsg) faceMsg.textContent = 'Loading face recognition models...';
  try {
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
    ]);
    modelsLoaded = true;
  } catch (err) {
    console.error('Failed to load models', err);
    if (faceMsg) faceMsg.textContent = 'Error loading face models.';
    throw err;
  }
}

// -------------------------------
// Preload descriptors for non-blocked users ONLY
// - force fresh users list to ensure blocked flag is current
// -------------------------------
// -------------------------------
// Preload descriptors for ALL users (including blocked)
// -------------------------------
async function preloadStoredFaces() {
  storedDescriptors = [];
  try {
    const users = await fetchUsers(true); // always get newest data
    if (!users || !users.length) return;

    for (const u of users) {
      try {
        if (!u.FaceImageFile) continue; // but don't skip blocked

        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = `https://cingcing12.github.io/System_Dashboard/faces/${u.FaceImageFile}`;
        await img.decode();

        const options = new faceapi.TinyFaceDetectorOptions({
          inputSize: 160,
          scoreThreshold: 0.2
        });

        const desc = await getDescriptorFromImage(img, options);
        if (!desc) continue;

        const normalized = l2Normalize(desc);
        storedDescriptors.push({
          email: u.Email,
          descriptor: normalized,
          blocked: isBlocked(u) // keep blocked tag
        });

      } catch (imgErr) {
        console.warn('Failed to load face for', u.Email, imgErr);
      }
    }

    console.log('Preloaded descriptors:', storedDescriptors.length);

  } catch (err) {
    console.error('Failed to preload stored faces', err);
  }
}


// -------------------------------
// Get descriptor helper
// -------------------------------
async function getDescriptorFromImage(source, options) {
  try {
    const detection = await faceapi.detectSingleFace(source, options).withFaceLandmarks().withFaceDescriptor();
    return detection ? detection.descriptor : null;
  } catch (err) {
    console.error('Face detect error', err);
    return null;
  }
}

// -------------------------------
// Start / stop camera
// -------------------------------
async function startCamera() {
  stopCamera();
  try {
    streamRef = await navigator.mediaDevices.getUserMedia({ video: { width: 480, height: 360, facingMode: currentFacing }, audio: false });
    if (video) { video.srcObject = streamRef; try { await video.play(); } catch(e){} }
  } catch (err) {
    console.error('Camera error', err);
    if (faceMsg) faceMsg.textContent = 'Cannot access camera.';
    throw err;
  }
}

function stopCamera() {
  if (streamRef) { streamRef.getTracks().forEach(t => t.stop()); streamRef = null; }
  if (video) { try { video.pause(); } catch (e){} video.srcObject = null; }
}

// -------------------------------
// Helper: compute average distance between captured descriptors and single descriptor
// -------------------------------
function averageDistanceToDescriptor(capturedDescriptors, targetDescriptor) {
  let total = 0;
  for (const d of capturedDescriptors) total += euclideanDistance(d, targetDescriptor);
  return total / capturedDescriptors.length;
}

// -------------------------------
// Final verification: compute descriptor from candidate user's stored image and compare
// Returns true if passes final check
// -------------------------------
async function finalVerifyAgainstUserImage(capturedDescriptors, user) {
  if (!user || !user.FaceImageFile) return false;
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = `https://cingcing12.github.io/System_Dashboard/faces/${user.FaceImageFile}`;
    await img.decode();
    const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.2 });
    const desc = await getDescriptorFromImage(img, options);
    if (!desc) return false;
    const normalized = l2Normalize(desc);
    const avgDist = averageDistanceToDescriptor(capturedDescriptors, normalized);
    console.log('Final verification avgDist for', user.Email, avgDist);
    return avgDist <= FINAL_VERIFICATION_THRESHOLD;
  } catch (err) {
    console.warn('Final verification error for', user?.Email, err);
    return false;
  }
}

// -------------------------------
// Face Login button init
// -------------------------------
if (faceLoginBtn) {
  faceLoginBtn.addEventListener('click', async () => {
    if (!faceModal) return;
    faceModal.style.display = 'flex';
    faceLoading.style.display = 'flex';
    if (faceMsg) faceMsg.textContent = 'Initializing camera...';
    try {
      await loadModels();
      await preloadStoredFaces(); // forces fresh users list internally
      await startCamera();
      if (faceMsg) faceMsg.textContent = 'Align your face with the camera.';
    } catch (err) {
      if (faceMsg) faceMsg.textContent = '❌ Error initializing face login.';
      console.error(err);
    } finally {
      faceLoading.style.display = 'none';
    }
  });
}

// -------------------------------
// Switch / cancel handlers
// -------------------------------
if (switchCamBtn) switchCamBtn.addEventListener('click', async () => { currentFacing = currentFacing === 'user' ? 'environment' : 'user'; await startCamera(); });
if (cancelFaceBtn) cancelFaceBtn.addEventListener('click', () => { stopCamera(); if (faceModal) faceModal.style.display = 'none'; });

// -------------------------------
// Capture + match logic (with final verification)
// -------------------------------
if (captureBtn) {
  captureBtn.addEventListener('click', async () => {
    captureBtn.disabled = true;
    if (faceMsg) faceMsg.textContent = 'Capturing face...';
    try {
      if (!video || video.readyState < 2) { if (faceMsg) faceMsg.textContent = 'Camera not ready.'; return; }
      const descriptors = [];
      snapshot.width = video.videoWidth || 480;
      snapshot.height = video.videoHeight || 360;
      const ctx = snapshot.getContext('2d');

      // capture more samples for stability
      for (let i = 0; i < CAPTURE_SAMPLES; i++) {
        ctx.drawImage(video, 0, 0, snapshot.width, snapshot.height);
        const desc = await getDescriptorFromImage(snapshot, new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.2 }));
        if (desc) descriptors.push(l2Normalize(desc));
        await new Promise(r => setTimeout(r, 180));
      }

      if (!descriptors.length) { if (faceMsg) faceMsg.textContent = '❌ No face detected. Try again.'; return; }
      if (!storedDescriptors.length) { if (faceMsg) faceMsg.textContent = '❌ No enrolled faces available.'; return; }
      if (faceMsg) faceMsg.textContent = 'Matching face...';

      // compute average distance to each stored descriptor
      const scores = []; // { email, avgDist }
      for (const s of storedDescriptors) {
        let tot = 0;
        for (const d of descriptors) tot += euclideanDistance(d, s.descriptor);
        const avg = tot / descriptors.length;
        scores.push({ email: s.email, avgDist: avg });
      }

      // sort ascending
      scores.sort((a,b)=>a.avgDist - b.avgDist);
      const best = scores[0];
      const second = scores[1] ?? { avgDist: Infinity };

      if (!best || best.avgDist > THRESHOLD) {
        if (faceMsg) faceMsg.textContent = '❌ No matching face.';
        return;
      }

      // ambiguity check: ensure best is sufficiently better than second
      if ((second.avgDist - best.avgDist) < AMBIGUITY_DELTA) {
        if (faceMsg) faceMsg.textContent = '❌ Match ambiguous. Try again.';
        return;
      }

      // final server-side user check + final verification against that user's stored image
      try {
        // ensure latest users list to avoid mismatch of block status
        const users = await fetchUsers(true);
        const user = users.find(u => String(u.Email).trim().toLowerCase() === String(best.email).trim().toLowerCase());
        if (!user) { if (faceMsg) faceMsg.textContent = '❌ User not found!'; stopCamera(); return; }
        if (isBlocked(user)) { if (faceMsg) faceMsg.textContent = '❌ This account is blocked!'; stopCamera(); return; }

        // **final verification**: recompute descriptor from matched user's stored image
        const passesFinal = await finalVerifyAgainstUserImage(descriptors, user);
        if (!passesFinal) {
          console.warn('Final verification failed for', user.Email);
          if (faceMsg) faceMsg.textContent = '❌ Final verification failed. Try again.';
          return;
        }

        // success: log in
        stopCamera();
        if (faceModal) faceModal.style.display = 'none';
        await updateLastLoginAndRedirect(user);

      } catch (err) {
        console.error('Error after matching', err);
        if (faceMsg) faceMsg.textContent = 'Error connecting to server.';
      }

    } catch (err) {
      console.error('Capture/Match error', err);
      if (faceMsg) faceMsg.textContent = 'Error during face capture.';
    } finally {
      captureBtn.disabled = false;
    }
  });
}

// -------------------------------
// End of file
// -------------------------------
