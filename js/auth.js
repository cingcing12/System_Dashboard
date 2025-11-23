// ================================
// Full updated login + face-login script
// Improvements:
// - Robust blocked-user checks
// - Cache users to avoid duplicate fetches
// - Normalize descriptors (L2) for stable matching
// - Stricter threshold and ambiguity check (reject close ties)
// - Blocked users are never added to matching pool
// - Double-check user status from server before logging in
// - Defensive UI and button disabling to avoid races
// ================================

// -------------------------------
// Configuration
// -------------------------------
const MODEL_URL = "https://cingcing12.github.io/System_Dashboard/models/";
let modelsLoaded = false;
let streamRef = null;
let currentFacing = "user";
const THRESHOLD = 0.45; // stricter (lower -> stricter)
const AMBIGUITY_DELTA = 0.08; // require second-best to be sufficiently worse
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
// Works with normalized vectors too
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
// -------------------------------
async function preloadStoredFaces() {
  storedDescriptors = [];
  try {
    const users = await fetchUsers();
    if (!users || !users.length) return;
    for (const u of users) {
      try {
        if (isBlocked(u)) continue; // never add blocked users
        if (!u.FaceImageFile) continue;
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = `https://cingcing12.github.io/System_Dashboard/faces/${u.FaceImageFile}`;
        await img.decode();
        const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.2 });
        const desc = await getDescriptorFromImage(img, options);
        if (!desc) continue;
        const normalized = l2Normalize(desc);
        storedDescriptors.push({ email: u.Email, descriptor: normalized });
      } catch (imgErr) {
        console.warn('Failed to load face for', u.Email, imgErr);
        continue;
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
      await preloadStoredFaces();
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
// Capture + match logic
// - Normalizes captured descriptor(s)
// - Finds best and second best match
// - Requires bestDistance < THRESHOLD and (secondBest - bestBest) >= AMBIGUITY_DELTA
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
      for (let i = 0; i < 2; i++) {
        ctx.drawImage(video, 0, 0, snapshot.width, snapshot.height);
        const desc = await getDescriptorFromImage(snapshot, new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.2 }));
        if (desc) descriptors.push(l2Normalize(desc));
        await new Promise(r => setTimeout(r, 200));
      }
      if (!descriptors.length) { if (faceMsg) faceMsg.textContent = '❌ No face detected. Try again.'; return; }
      if (!storedDescriptors.length) { if (faceMsg) faceMsg.textContent = '❌ No enrolled faces available.'; return; }
      if (faceMsg) faceMsg.textContent = 'Matching face...';

      // evaluate distances: compute average distance between captured descriptors and each stored descriptor
      const scores = []; // { email, avgDist }
      for (const s of storedDescriptors) {
        let tot = 0;
        for (const d of descriptors) tot += euclideanDistance(d, s.descriptor);
        const avg = tot / descriptors.length;
        scores.push({ email: s.email, avgDist: avg });
      }
      // sort ascending (smaller distance = better)
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

      // final server-side user check
      try {
        const users = await fetchUsers();
        const user = users.find(u => String(u.Email).trim().toLowerCase() === String(best.email).trim().toLowerCase());
        if (!user) { if (faceMsg) faceMsg.textContent = '❌ User not found!'; stopCamera(); return; }
        if (isBlocked(user)) { if (faceMsg) faceMsg.textContent = '❌ This account is blocked!'; stopCamera(); return; }
        // success
        stopCamera(); if (faceModal) faceModal.style.display = 'none'; await updateLastLoginAndRedirect(user);
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
