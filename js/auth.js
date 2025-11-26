// ================================
// Full updated login + face-login script (Phone Camera Style)
// ================================

// -------------------------------
// Configuration
// -------------------------------
const MODEL_URL = "https://cingcing12.github.io/System_Dashboard/models/";
let modelsLoaded = false;
let streamRef = null;
let currentFacing = "user"; // 'user' (front) or 'environment' (back)

// Face matching settings
const THRESHOLD = 0.38; 
const AMBIGUITY_DELTA = 0.12; 
const FINAL_VERIFICATION_THRESHOLD = 0.40; 
const CAPTURE_SAMPLES = 4; 
let storedDescriptors = []; 
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
// Euclidean distance
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
    // Assumes sheetUrl and SHEET_USERS are in config.js
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
// Manual Login (UPDATED TO NAME)
// -------------------------------

const loginBtn = document.getElementById('loginBtn');
if (loginBtn) loginBtn.addEventListener('click', loginUser);

async function loginUser() {
  // 1. Get Elements safely
  const nameField = document.getElementById('name');
  const passField = document.getElementById('password');

  // Safety Check: If HTML is wrong, stop here so it doesn't crash
  if (!nameField) {
      console.error("CRITICAL ERROR: Input with id='name' not found in HTML.");
      alert("System Error: Input 'name' is missing. Please check login.html");
      return;
  }
  if (!passField) {
      console.error("CRITICAL ERROR: Input with id='password' not found in HTML.");
      return;
  }

  // 2. Get Values
  const nameInput = nameField.value.trim();
  const password = passField.value.trim();
  
  if (!nameInput || !password) return alert('Enter name and password!');
  
  try {
    const users = await fetchUsers();
    
    // 3. Search by Name
    const user = users.find(u => {
        const uName = u.Name || u['ឈ្មោះ'] || ''; 
        return String(uName).trim().toLowerCase() === nameInput.toLowerCase();
    });

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
// Update last login & redirect (UPDATED TO NAME)
// -------------------------------
async function updateLastLoginAndRedirect(user) {
  const now = new Date().toISOString();
  // Use Name to identify user for update
  const userName = user.Name || user['ឈ្មោះ'];
  
  // 3. Patch URL uses /Name/
  const patchUrl = `${SHEETDB_BASE_URL}/Name/${encodeURIComponent(userName)}`;
  
  try {
    await fetch(patchUrl, {
      method: 'PATCH', // SheetDB often prefers PATCH for updates
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
// UI Elements
// -------------------------------
const faceLoginBtn = document.getElementById('faceLoginBtn');
const faceModal = document.getElementById('faceModal');
const video = document.getElementById('video');
const snapshot = document.getElementById('snapshot');
const captureBtn = document.getElementById('captureBtn');
const cancelFaceBtn = document.getElementById('cancelFaceBtn');
const switchCamBtn = document.getElementById('switchCamBtn');
const faceMsg = document.getElementById('faceMsg');
const faceLoading = document.getElementById('faceLoading');

// -------------------------------
// Load Models
// -------------------------------
async function loadModels() {
  if (modelsLoaded) return;
  if (faceMsg) faceMsg.textContent = 'Loading AI Models...';
  try {
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
    ]);
    modelsLoaded = true;
  } catch (err) {
    console.error('Failed to load models', err);
    if (faceMsg) faceMsg.textContent = 'Model Error';
    throw err;
  }
}

// -------------------------------
// Preload Stored Faces (UPDATED TO NAME)
// -------------------------------
async function preloadStoredFaces() {
  storedDescriptors = [];
  try {
    const users = await fetchUsers(true);
    if (!users || !users.length) return;

    for (const u of users) {
      try {
        if (!u.FaceImageFile) continue;
        const img = new Image();
        img.crossOrigin = 'anonymous';
        // Note: Filename logic should already be handled by backend. We just read the file path.
        img.src = `https://cingcing12.github.io/System_Dashboard/faces/${u.FaceImageFile}`;
        await img.decode();

        const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.2 });
        const desc = await getDescriptorFromImage(img, options);
        if (!desc) continue;

        // 4. Store Name instead of Email
        storedDescriptors.push({
          name: u.Name || u['ឈ្មោះ'], 
          descriptor: l2Normalize(desc),
          blocked: isBlocked(u)
        });
      } catch (e) { /* ignore specific image error */ }
    }
    console.log('Faces loaded:', storedDescriptors.length);
  } catch (err) {
    console.error('Failed to preload faces', err);
  }
}

async function getDescriptorFromImage(source, options) {
  try {
    const detection = await faceapi.detectSingleFace(source, options).withFaceLandmarks().withFaceDescriptor();
    return detection ? detection.descriptor : null;
  } catch (err) { return null; }
}

// -------------------------------
// Camera Logic (Swiping + Mirroring)
// -------------------------------
async function startCamera() {
  stopCamera();
  
  // Update mirror CSS based on facing mode
  if (video) {
    if (currentFacing === 'user') {
      video.style.transform = 'scaleX(-1)'; // Mirror front camera
    } else {
      video.style.transform = 'scaleX(1)';  // Normal back camera
    }
  }

  try {
    streamRef = await navigator.mediaDevices.getUserMedia({ 
      video: { 
        facingMode: currentFacing,
        width: { ideal: 1280 },
        height: { ideal: 720 } 
      }, 
      audio: false 
    });
    
    if (video) { 
      video.srcObject = streamRef; 
      video.setAttribute('playsinline', true); // Required for iOS
      try { await video.play(); } catch(e){} 
    }
  } catch (err) {
    console.error('Camera error', err);
    if (faceMsg) {
        faceMsg.textContent = 'Camera Access Denied';
        faceMsg.classList.replace('bg-black/60', 'bg-red-500/80');
    }
    throw err;
  }
}

function stopCamera() {
  if (streamRef) { streamRef.getTracks().forEach(t => t.stop()); streamRef = null; }
  if (video) { try { video.pause(); } catch (e){} video.srcObject = null; }
}

// -------------------------------
// Verification Helpers
// -------------------------------
function averageDistanceToDescriptor(capturedDescriptors, targetDescriptor) {
  let total = 0;
  for (const d of capturedDescriptors) total += euclideanDistance(d, targetDescriptor);
  return total / capturedDescriptors.length;
}

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
    return avgDist <= FINAL_VERIFICATION_THRESHOLD;
  } catch (err) { return false; }
}

// -------------------------------
// Button Listeners
// -------------------------------

// 1. Open Modal & Initialize
if (faceLoginBtn) {
  faceLoginBtn.addEventListener('click', async () => {
    if (!faceModal) return;
    faceModal.classList.remove('hidden');
    faceModal.classList.add('flex');
    
    if(faceLoading) faceLoading.style.display = 'flex';
    if (faceMsg) faceMsg.textContent = 'Initializing...';
    
    try {
      await loadModels();
      await preloadStoredFaces();
      await startCamera();
      if (faceMsg) faceMsg.textContent = 'Align face & Tap button';
    } catch (err) {
      if (faceMsg) faceMsg.textContent = 'Initialization Failed';
    } finally {
        if(faceLoading) faceLoading.style.display = 'none';
    }
  });
}

// 2. Switch Camera (Swipe Camera)
if (switchCamBtn) {
  switchCamBtn.addEventListener('click', async () => {
    // Toggle mode
    currentFacing = currentFacing === 'user' ? 'environment' : 'user';
    
    // Update text
    if (faceMsg) faceMsg.textContent = 'Switching Camera...';
    
    // Restart camera with new mode
    await startCamera();
    
    if (faceMsg) faceMsg.textContent = 'Ready to Scan';
  });
}

// 3. Cancel / Close
if (cancelFaceBtn) {
  cancelFaceBtn.addEventListener('click', () => { 
    stopCamera(); 
    if (faceModal) {
        faceModal.classList.add('hidden');
        faceModal.classList.remove('flex');
    }
  });
}

// -------------------------------
// Scan Logic (Shutter Click) - UPDATED TO NAME
// -------------------------------
if (captureBtn) {
  captureBtn.addEventListener('click', async () => {
    if (captureBtn.disabled) return;
    captureBtn.disabled = true;
    
    // Visual Feedback on Button
    const innerDot = captureBtn.querySelector('div');
    if(innerDot) innerDot.classList.replace('bg-white', 'bg-red-500');

    if (faceMsg) {
        faceMsg.textContent = 'Scanning...';
        faceMsg.classList.replace('bg-red-500/80', 'bg-black/60'); // reset color
    }

    try {
      if (!video || video.readyState < 2) { 
        if (faceMsg) faceMsg.textContent = 'Camera not ready'; 
        return; 
      }

      const descriptors = [];
      snapshot.width = video.videoWidth;
      snapshot.height = video.videoHeight;
      const ctx = snapshot.getContext('2d');

      // Capture multiple frames for better accuracy
      for (let i = 0; i < CAPTURE_SAMPLES; i++) {
        ctx.drawImage(video, 0, 0, snapshot.width, snapshot.height);
        const desc = await getDescriptorFromImage(snapshot, new faceapi.TinyFaceDetectorOptions({ inputSize: 160, scoreThreshold: 0.2 }));
        if (desc) descriptors.push(l2Normalize(desc));
        await new Promise(r => setTimeout(r, 150));
      }

      if (!descriptors.length) { 
        if (faceMsg) {
            faceMsg.textContent = '❌ No face detected';
            faceMsg.classList.replace('bg-black/60', 'bg-red-500/80');
        }
        return; 
      }
      
      if (faceMsg) faceMsg.textContent = 'Verifying Identity...';

      // --- Matching Logic (UPDATED TO NAME) ---
      if (storedDescriptors.length === 0) {
          if (faceMsg) faceMsg.textContent = '❌ No users enrolled';
          return;
      }

      const scores = [];
      for (const s of storedDescriptors) {
        let tot = 0;
        for (const d of descriptors) tot += euclideanDistance(d, s.descriptor);
        const avg = tot / descriptors.length;
        
        // 5. Use name in score object
        scores.push({ name: s.name, avgDist: avg });
      }

      scores.sort((a,b) => a.avgDist - b.avgDist);
      const best = scores[0];
      const second = scores[1] ?? { avgDist: Infinity };

      // Threshold Check
      if (!best || best.avgDist > THRESHOLD) {
        if (faceMsg) {
            faceMsg.textContent = '❌ Access Denied';
            faceMsg.classList.replace('bg-black/60', 'bg-red-500/80');
        }
        return;
      }

      // Ambiguity Check
      if ((second.avgDist - best.avgDist) < AMBIGUITY_DELTA) {
        if (faceMsg) {
            faceMsg.textContent = '❌ Ambiguous match. Try again.';
            faceMsg.classList.replace('bg-black/60', 'bg-red-500/80');
        }
        return;
      }

      // --- Final Verification (UPDATED TO NAME) ---
      try {
        const users = await fetchUsers(true);
        // 6. Find user by Name
        const user = users.find(u => {
            const uName = u.Name || u['ឈ្មោះ'];
            return String(uName).trim().toLowerCase() === String(best.name).trim().toLowerCase();
        });
        
        if (!user) { if (faceMsg) faceMsg.textContent = '❌ User missing'; stopCamera(); return; }
        if (isBlocked(user)) { if (faceMsg) faceMsg.textContent = '❌ Account Blocked'; return; }

        const passesFinal = await finalVerifyAgainstUserImage(descriptors, user);
        if (!passesFinal) {
          if (faceMsg) faceMsg.textContent = '❌ Verification Failed';
          return;
        }

        // SUCCESS
        if (faceMsg) {
            const displayName = user.Name || user['ឈ្មោះ'] || 'User';
            faceMsg.textContent = `✅ Welcome, ${displayName}!`;
            faceMsg.classList.replace('bg-black/60', 'bg-teal-500');
            faceMsg.classList.replace('bg-red-500/80', 'bg-teal-500');
        }
        
        setTimeout(async () => {
            stopCamera();
            if (faceModal) faceModal.style.display = 'none';
            await updateLastLoginAndRedirect(user);
        }, 1000);

      } catch (err) {
        if (faceMsg) faceMsg.textContent = 'Server Error';
      }

    } catch (err) {
      console.error(err);
      if (faceMsg) faceMsg.textContent = 'Scan Error';
    } finally {
      captureBtn.disabled = false;
      if(innerDot) innerDot.classList.replace('bg-red-500', 'bg-white');
    }
  });
}
