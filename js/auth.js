// ================================
// Smart login + face-login
// Blocked users cannot login
// Robust ambiguity detection
// ================================

// -------------------------------
// Config
// -------------------------------
const MODEL_URL = "https://cingcing12.github.io/System_Dashboard/models/";
let modelsLoaded = false;
let streamRef = null;
let currentFacing = "user";
const THRESHOLD = 0.38; // stricter
const AMBIGUITY_DELTA = 0.12; // minimal difference to avoid ambiguous match
const CAPTURE_SAMPLES = 4;

let storedDescriptors = []; // { email, descriptor }
let cachedUsers = null;
let fetchingUsers = false;

// -------------------------------
// Utility: check if user is blocked
// -------------------------------
function isBlocked(user) {
  if (!user) return false;
  const val = user.IsBlocked ?? user.isBlocked ?? user.blocked ?? false;
  if (typeof val === "boolean") return val === true;
  return ["true", "yes", "1"].includes(String(val).trim().toLowerCase());
}

// -------------------------------
// L2 normalize descriptor
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
// Euclidean distance
// -------------------------------
function euclideanDistance(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

// -------------------------------
// Fetch users (cached)
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
  } finally {
    fetchingUsers = false;
  }
}

// -------------------------------
// Email login
// -------------------------------
const loginBtn = document.getElementById('loginBtn');
if (loginBtn) loginBtn.addEventListener('click', async () => {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value.trim();
  if (!email || !password) return alert('Enter email and password!');
  try {
    const users = await fetchUsers();
    const user = users.find(u => u.Email.trim().toLowerCase() === email.toLowerCase());
    if (!user) return alert('User not found!');
    if (isBlocked(user)) return alert('❌ You are blocked by owner!');
    if (user.PasswordHash !== password) return alert('Wrong password!');
    await updateLastLoginAndRedirect(user);
  } catch (err) {
    console.error(err);
    alert('Error connecting to server.');
  }
});

// -------------------------------
// Update last login & redirect
// -------------------------------
async function updateLastLoginAndRedirect(user) {
  const now = new Date().toISOString();
  const patchUrl = `${SHEETDB_BASE_URL}/Email/${encodeURIComponent(user.Email)}`;
  try {
    await fetch(patchUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: [{ LastLogin: now }] })
    });
  } catch (err) {
    console.warn('Failed to update last login', err);
  }
  try { user.LastLogin = now; localStorage.setItem('user', JSON.stringify(user)); } catch(e){}
  window.location.href = 'dashboard.html';
}

// -------------------------------
// Face login elements
// -------------------------------
const faceLoginBtn = document.getElementById('faceLoginBtn');
const faceModal = document.getElementById('faceModal');
const video = document.getElementById('video');
const snapshot = document.getElementById('snapshot');
const captureBtn = document.getElementById('captureBtn');
const cancelFaceBtn = document.getElementById('cancelFaceBtn');
const switchCamBtn = document.getElementById('switchCamBtn');
const faceMsg = document.getElementById('faceMsg');

const faceLoading = document.createElement('div');
faceLoading.className = 'absolute inset-0 bg-black/50 flex justify-center items-center z-50 text-white text-lg font-bold';
faceLoading.textContent = 'Loading face login...';
faceLoading.style.display = 'none';
if (faceModal) faceModal.appendChild(faceLoading);

// -------------------------------
// Load models
// -------------------------------
async function loadModels() {
  if (modelsLoaded) return;
  if (faceMsg) faceMsg.textContent = 'Loading face recognition models...';
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
    faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
    faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
  ]);
  modelsLoaded = true;
}

// -------------------------------
// Preload stored faces (non-blocked only)
// -------------------------------
async function preloadStoredFaces() {
  storedDescriptors = [];
  const users = await fetchUsers();
  for (const u of users) {
    if (isBlocked(u)) continue; // skip blocked
    if (!u.FaceImageFile) continue;
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = `https://cingcing12.github.io/System_Dashboard/faces/${u.FaceImageFile}`;
      await img.decode();
      const desc = await getDescriptorFromImage(img, new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.2 }));
      if (!desc) continue;
      storedDescriptors.push({ email: u.Email, descriptor: l2Normalize(desc) });
    } catch (err) { console.warn('Face load error', u.Email, err); }
  }
}

// -------------------------------
// Descriptor helper
// -------------------------------
async function getDescriptorFromImage(source, options) {
  const detection = await faceapi.detectSingleFace(source, options).withFaceLandmarks().withFaceDescriptor();
  return detection ? detection.descriptor : null;
}

// -------------------------------
// Camera
// -------------------------------
async function startCamera() {
  stopCamera();
  streamRef = await navigator.mediaDevices.getUserMedia({ video: { width: 480, height: 360, facingMode: currentFacing }, audio: false });
  video.srcObject = streamRef;
  await video.play();
}
function stopCamera() {
  if (streamRef) streamRef.getTracks().forEach(t => t.stop());
  streamRef = null;
  video.srcObject = null;
}

// -------------------------------
// Face login button
// -------------------------------
if (faceLoginBtn) faceLoginBtn.addEventListener('click', async () => {
  faceModal.style.display = 'flex';
  faceLoading.style.display = 'flex';
  try {
    await loadModels();
    await preloadStoredFaces();
    await startCamera();
    faceMsg.textContent = 'Align your face with the camera.';
  } catch (err) {
    faceMsg.textContent = '❌ Error initializing face login.';
    console.error(err);
  } finally { faceLoading.style.display = 'none'; }
});

// -------------------------------
// Capture + match
// -------------------------------
if (captureBtn) captureBtn.addEventListener('click', async () => {
  captureBtn.disabled = true;
  try {
    if (!video || video.readyState < 2) { faceMsg.textContent = 'Camera not ready.'; return; }
    const descriptors = [];
    snapshot.width = video.videoWidth || 480;
    snapshot.height = video.videoHeight || 360;
    const ctx = snapshot.getContext('2d');

    // capture multiple frames
    for (let i = 0; i < CAPTURE_SAMPLES; i++) {
      ctx.drawImage(video, 0, 0, snapshot.width, snapshot.height);
      const desc = await getDescriptorFromImage(snapshot, new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.2 }));
      if (desc) descriptors.push(l2Normalize(desc));
      await new Promise(r => setTimeout(r, 150));
    }

    if (!descriptors.length) { faceMsg.textContent = '❌ No face detected.'; return; }
    if (!storedDescriptors.length) { faceMsg.textContent = '❌ No enrolled faces.'; return; }

    // match against all stored faces
    const scores = storedDescriptors.map(s => {
      const avgDist = descriptors.reduce((sum, d) => sum + euclideanDistance(d, s.descriptor), 0) / descriptors.length;
      return { email: s.email, avgDist };
    });
    scores.sort((a, b) => a.avgDist - b.avgDist);

    const best = scores[0], second = scores[1] ?? { avgDist: Infinity };
    if (!best || best.avgDist > THRESHOLD) { faceMsg.textContent = '❌ No matching face.'; return; }
    if ((second.avgDist - best.avgDist) < AMBIGUITY_DELTA) { faceMsg.textContent = '❌ Match ambiguous. Try again.'; return; }

    // final check: blocked?
    const users = await fetchUsers(true);
    const user = users.find(u => u.Email.trim().toLowerCase() === best.email.trim().toLowerCase());
    if (!user) { faceMsg.textContent = '❌ User not found!'; return; }
    if (isBlocked(user)) { faceMsg.textContent = '❌ This account is blocked!'; return; }

    // login
    stopCamera();
    faceModal.style.display = 'none';
    await updateLastLoginAndRedirect(user);

  } catch (err) {
    console.error(err);
    faceMsg.textContent = '❌ Error during face capture.';
  } finally { captureBtn.disabled = false; }
});
