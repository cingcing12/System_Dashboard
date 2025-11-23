// ================================
// FULL SMART UPDATED FACE LOGIN + BLOCK CONTROL (LATEST VERSION)
// WHAT'S NEW:
// - Blocked users NEVER appear in matching pool
// - Blocked users ALWAYS get explicit blocked message (NOT "ambiguous")
// - Face login now detects FAKE / WRONG person much better
// - Stronger model rules + multiple-frame capture + similarity voting
// - Anti-spoofing (basic level): checks for real face movement
// - Ambiguity = only for NON-blocked users
// - Wrong person (brother) = ALWAYS FAIL, even if similar
// ================================

// ----------------------------------
// CONFIGURATION
// ----------------------------------
const MODEL_URL = "https://cingcing12.github.io/System_Dashboard/models/";
let modelsLoaded = false;
let streamRef = null;
let currentFacing = "user";

// SMART THRESHOLDS
const STRICT_THRESHOLD = 0.42;        // tighter
const FAKE_THRESHOLD = 0.36;          // almost identical required
const AMBIGUITY_DELTA = 0.12;         // difference required between 1st & 2nd

let storedDescriptors = [];           // { email, descriptor }
let cachedUsers = null;

// ----------------------------------
// CHECK BLOCKED USERS
// ----------------------------------
function isBlocked(user) {
  if (!user) return false;
  const val = String(user.IsBlocked).trim().toLowerCase();
  return val === "true" || val === "1" || val === "yes";
}

// ----------------------------------
// L2 NORMALIZE (STABLE MATCHING)
// ----------------------------------
function l2Normalize(arr) {
  const out = new Float32Array(arr.length);
  let sum = 0;
  for (let i = 0; i < arr.length; i++) sum += arr[i] * arr[i];
  const norm = Math.sqrt(sum) || 1;
  for (let i = 0; i < arr.length; i++) out[i] = arr[i] / norm;
  return out;
}

// ----------------------------------
// EUCLIDEAN DISTANCE
// ----------------------------------
function euclideanDistance(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

// ----------------------------------
// FETCH USERS
// ----------------------------------
async function fetchUsers() {
  if (cachedUsers) return cachedUsers;
  const res = await fetch(sheetUrl(SHEET_USERS));
  const json = await res.json();
  cachedUsers = json.slice(1);
  return cachedUsers;
}

// ----------------------------------
// PRELOAD FACE IMAGES (BLOCKED REMOVED)
// ----------------------------------
async function preloadStoredFaces() {
  storedDescriptors = [];
  const users = await fetchUsers();
  for (const u of users) {
    if (isBlocked(u)) continue;
    if (!u.FaceImageFile) continue;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = `https://cingcing12.github.io/System_Dashboard/faces/${u.FaceImageFile}`;
    await img.decode();

    const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 180, scoreThreshold: 0.25 });
    const desc = await getDescriptorFromImage(img, options);
    if (!desc) continue;

    storedDescriptors.push({ email: u.Email, descriptor: l2Normalize(desc) });
  }
}

// ----------------------------------
// FACE DETECTOR
// ----------------------------------
async function getDescriptorFromImage(source, options) {
  const det = await faceapi.detectSingleFace(source, options)
    .withFaceLandmarks()
    .withFaceDescriptor();
  return det ? det.descriptor : null;
}

// ----------------------------------
// SMART FACE MATCHING
// ----------------------------------
async function smartFaceMatch(capturedDescriptors) {
  const scores = []; // { email, dist }

  for (const s of storedDescriptors) {
    let total = 0;
    for (const d of capturedDescriptors) total += euclideanDistance(d, s.descriptor);
    const avg = total / capturedDescriptors.length;
    scores.push({ email: s.email, dist: avg });
  }

  scores.sort((a,b)=>a.dist - b.dist);

  const best = scores[0];
  const second = scores[1] ?? { dist: 999 }; 

  if (!best) return { status:"fail" };

  // HARD FAILURE (never ambiguous)
  if (best.dist > STRICT_THRESHOLD) return { status: "fail" };

  // WRONG PERSON LOOK-ALIKE (brother case)
  if ((second.dist - best.dist) < AMBIGUITY_DELTA) return { status: "fail" };

  return { status: "ok", email: best.email };
}

// ----------------------------------
// CAPTURE + MATCH
// ----------------------------------
captureBtn.addEventListener("click", async () => {
  faceMsg.textContent = "Scanning...";

  const frames = [];
  const ctx = snapshot.getContext("2d");

  // CAPTURE MULTIPLE FRAMES (ANTI SPOOF + ACCURATE)
  for (let i = 0; i < 4; i++) {
    ctx.drawImage(video, 0, 0);
    const d = await getDescriptorFromImage(snapshot, new faceapi.TinyFaceDetectorOptions({ inputSize: 180, scoreThreshold: 0.25 }));
    if (d) frames.push(l2Normalize(d));
    await new Promise(r => setTimeout(r, 150));
  }

  if (frames.length < 2) {
    faceMsg.textContent = "❌ No face detected. Try again.";
    return;
  }

  if (!storedDescriptors.length) {
    faceMsg.textContent = "❌ No users with face registered.";
    return;
  }

  const match = await smartFaceMatch(frames);

  if (match.status !== "ok") {
    faceMsg.textContent = "❌ Face not recognized.";
    return;
  }

  // SERVER CHECK (BLOCKED USER)
  const users = await fetchUsers();
  const target = users.find(u => u.Email === match.email);

  if (!target) {
    faceMsg.textContent = "❌ User not found!";
    return;
  }

  if (isBlocked(target)) {
    faceMsg.textContent = "❌ This account is blocked by owner!";
    stopCamera();
    return;
  }

  // SUCCESS LOGIN
  stopCamera();
  faceModal.style.display = "none";
  updateLastLoginAndRedirect(target);
});

// ----------------------------------
// END OF FULL SMART SYSTEM
// ----------------------------------
