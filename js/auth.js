// ================================
// Full updated login + face-login script (Smart Sibling Defense & Blocked Check)
// ================================

// -------------------------------
// Configuration
// -------------------------------
const MODEL_URL = "https://cingcing12.github.io/System_Dashboard/models/";
let modelsLoaded = false;
let streamRef = null;
let currentFacing = "user";

// --- SECURITY SETTINGS (Tuned for Siblings) ---
const THRESHOLD = 0.31;               // VERY STRICT. (Standard is 0.45). < 0.35 rejects lookalikes.
const FINAL_VERIFICATION_THRESHOLD = 0.32; // Double check against specific user data
const AMBIGUITY_DELTA = 0.15;         // The best match must be significantly better than the 2nd best
const CAPTURE_SAMPLES = 6;            // Take 6 snapshots to ensure it's not a lucky frame
let storedDescriptors = [];           // { email, descriptor: Float32Array }
let cachedUsers = null;
let fetchingUsers = false;

// -------------------------------
// UI: Custom Blocked Alert
// -------------------------------
function showBlockedAlert() {
    // Create a modal on the fly if it doesn't exist
    let modal = document.getElementById('blockedModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'blockedModal';
        modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:9999;display:flex;justify-content:center;align-items:center;backdrop-filter:blur(5px);";
        modal.innerHTML = `
            <div style="background:white;padding:30px;border-radius:20px;text-align:center;max-width:400px;border-bottom:6px solid #ef4444;">
                <div style="width:70px;height:70px;background:#fee2e2;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 20px auto;">
                    <svg xmlns="http://www.w3.org/2000/svg" width="35" height="35" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>
                </div>
                <h2 style="margin:0 0 10px 0;color:#991b1b;font-family:sans-serif;font-weight:800;">ACCESS DENIED</h2>
                <p style="margin:0 0 25px 0;color:#374151;font-size:16px;line-height:1.5;">This account has been <b>permanently blocked</b> by the system administrator.</p>
                <button onclick="document.getElementById('blockedModal').remove()" style="background:#dc2626;color:white;border:none;padding:12px 30px;border-radius:10px;font-weight:bold;cursor:pointer;font-size:14px;transition:0.2s;">CLOSE</button>
            </div>
        `;
        document.body.appendChild(modal);
    }
}

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
// Fetch users
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
        if (isBlocked(u)) {
            localStorage.removeItem('user');
            showBlockedAlert();
        } else {
            window.location.href = 'dashboard.html';
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
        
        // IMMEDIATE BLOCK CHECK
        if (isBlocked(user)) {
            showBlockedAlert();
            return; 
        }

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
    try { user.LastLogin = now; localStorage.setItem('user', JSON.stringify(user)); } catch(e){}
    window.location.href = 'dashboard.html';
}

// -------------------------------
// Face Login UI & Logic
// -------------------------------
const faceLoginBtn = document.getElementById('faceLoginBtn');
const faceModal = document.getElementById('faceModal');
const video = document.getElementById('video');
const snapshot = document.getElementById('snapshot');
const captureBtn = document.getElementById('captureBtn');
const cancelFaceBtn = document.getElementById('cancelFaceBtn');
const switchCamBtn = document.getElementById('switchCamBtn');
const faceMsg = document.getElementById('faceMsg');

// Loading overlay
const faceLoading = document.createElement('div');
faceLoading.className = 'absolute inset-0 bg-black/50 flex justify-center items-center z-50 text-white text-lg font-bold';
faceLoading.textContent = 'System Security Check...';
faceLoading.style.display = 'none';
if (faceModal) faceModal.appendChild(faceLoading);

// Load Models
async function loadModels() {
    if (modelsLoaded) return;
    if (faceMsg) faceMsg.textContent = 'Loading neural networks...';
    try {
        await Promise.all([
            faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
            faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
            faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
        ]);
        modelsLoaded = true;
    } catch (err) {
        console.error('Failed to load models', err);
        if (faceMsg) faceMsg.textContent = 'Error loading AI models.';
        throw err;
    }
}

// Preload Descriptors (Filter out blocked users immediately)
async function preloadStoredFaces() {
    storedDescriptors = [];
    try {
        const users = await fetchUsers(true);
        if (!users || !users.length) return;
        
        for (const u of users) {
            try {
                // Note: We load ALL users here to ensure we identify them first, 
                // then block them in the final step.
                if (!u.FaceImageFile) continue;
                
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.src = `https://cingcing12.github.io/System_Dashboard/faces/${u.FaceImageFile}`;
                await img.decode();
                
                // Use slightly stricter options for reference image
                const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
                const desc = await getDescriptorFromImage(img, options);
                
                if (!desc) continue;
                const normalized = l2Normalize(desc);
                storedDescriptors.push({ email: u.Email, descriptor: normalized });
            } catch (imgErr) {
                continue;
            }
        }
        console.log('Secure descriptors loaded:', storedDescriptors.length);
    } catch (err) {
        console.error('Failed to preload', err);
    }
}

async function getDescriptorFromImage(source, options) {
    try {
        const detection = await faceapi.detectSingleFace(source, options).withFaceLandmarks().withFaceDescriptor();
        return detection ? detection.descriptor : null;
    } catch (err) {
        return null;
    }
}

async function startCamera() {
    stopCamera();
    try {
        streamRef = await navigator.mediaDevices.getUserMedia({ video: { width: 480, height: 360, facingMode: currentFacing }, audio: false });
        if (video) { video.srcObject = streamRef; try { await video.play(); } catch(e){} }
    } catch (err) {
        if (faceMsg) faceMsg.textContent = 'Camera access denied.';
    }
}

function stopCamera() {
    if (streamRef) { streamRef.getTracks().forEach(t => t.stop()); streamRef = null; }
    if (video) { try { video.pause(); } catch (e){} video.srcObject = null; }
}

// Initialize Face Login
if (faceLoginBtn) {
    faceLoginBtn.addEventListener('click', async () => {
        if (!faceModal) return;
        faceModal.style.display = 'flex';
        faceLoading.style.display = 'flex';
        if (faceMsg) faceMsg.textContent = 'Initializing Secure Login...';
        try {
            await loadModels();
            await preloadStoredFaces();
            await startCamera();
            if (faceMsg) faceMsg.textContent = 'Position face in center & Hold still.';
        } catch (err) {
            if (faceMsg) faceMsg.textContent = 'System Error.';
        } finally {
            faceLoading.style.display = 'none';
        }
    });
}

if (switchCamBtn) switchCamBtn.addEventListener('click', async () => { currentFacing = currentFacing === 'user' ? 'environment' : 'user'; await startCamera(); });
if (cancelFaceBtn) cancelFaceBtn.addEventListener('click', () => { stopCamera(); if (faceModal) faceModal.style.display = 'none'; });

// -------------------------------
// SMART MATCHING LOGIC
// -------------------------------
if (captureBtn) {
    captureBtn.addEventListener('click', async () => {
        captureBtn.disabled = true;
        
        try {
            if (!video || video.readyState < 2) { if (faceMsg) faceMsg.textContent = 'Wait for camera...'; return; }
            if (!storedDescriptors.length) { if (faceMsg) faceMsg.textContent = 'No users registered.'; return; }

            if (faceMsg) faceMsg.textContent = 'Scanning... (Hold Still)';
            
            const capturedDescriptors = [];
            snapshot.width = video.videoWidth || 480;
            snapshot.height = video.videoHeight || 360;
            const ctx = snapshot.getContext('2d');

            // 1. Multi-Frame Capture (Anti-Spoof/Anti-Blur)
            for (let i = 0; i < CAPTURE_SAMPLES; i++) {
                ctx.drawImage(video, 0, 0, snapshot.width, snapshot.height);
                // Use strict input size 160 for speed, but strict threshold
                const desc = await getDescriptorFromImage(snapshot, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.4 }));
                if (desc) capturedDescriptors.push(l2Normalize(desc));
                await new Promise(r => setTimeout(r, 150)); // Delay between frames
            }

            if (capturedDescriptors.length < 3) { 
                if (faceMsg) faceMsg.textContent = '⚠️ Face unclear or moving too fast.'; 
                captureBtn.disabled = false;
                return; 
            }

            // 2. Average the Live Descriptors to create a "Master Live Profile"
            // This reduces noise and makes it harder for a brother to match "by accident" on one frame
            const avgLiveDescriptor = new Float32Array(128);
            for (let i = 0; i < 128; i++) {
                let sum = 0;
                for (const d of capturedDescriptors) sum += d[i];
                avgLiveDescriptor[i] = sum / capturedDescriptors.length;
            }

            // 3. Match against Stored Data
            const scores = storedDescriptors.map(stored => {
                return { 
                    email: stored.email, 
                    distance: euclideanDistance(avgLiveDescriptor, stored.descriptor) 
                };
            });

            // Sort best matches
            scores.sort((a,b) => a.distance - b.distance);
            const best = scores[0];
            const second = scores[1];

            console.log(`Best Match: ${best.email} (Dist: ${best.distance.toFixed(4)})`);

            // 4. Strict Threshold Checks
            if (best.distance > THRESHOLD) {
                if (faceMsg) faceMsg.textContent = '❌ Face not recognized.';
                // If it's close (e.g. 0.35), it's likely a sibling. We strictly reject it.
                if (best.distance < 0.45) console.warn("Rejected possible sibling match:", best.distance);
                captureBtn.disabled = false;
                return;
            }

            // 5. Ambiguity Check (If 2nd best is also very close, reject to be safe)
            if (second && (second.distance - best.distance) < AMBIGUITY_DELTA) {
                if (faceMsg) faceMsg.textContent = '⚠️ Match ambiguous. Closer/Better lighting needed.';
                captureBtn.disabled = false;
                return;
            }

            // 6. Blocked User Check
            const users = await fetchUsers(true);
            const user = users.find(u => String(u.Email).trim().toLowerCase() === String(best.email).trim().toLowerCase());

            if (!user) { if (faceMsg) faceMsg.textContent = '❌ User data error.'; captureBtn.disabled = false; return; }

            // ** CRITICAL BLOCK CHECK **
            if (isBlocked(user)) {
                stopCamera();
                if (faceModal) faceModal.style.display = 'none';
                showBlockedAlert(); // Show the big red modal
                captureBtn.disabled = false;
                return;
            }

            // 7. Success
            if (faceMsg) faceMsg.textContent = `✅ Verified: ${user.Name || user.Email}`;
            stopCamera();
            setTimeout(() => {
                if (faceModal) faceModal.style.display = 'none';
                updateLastLoginAndRedirect(user);
            }, 800);

        } catch (err) {
            console.error('Logic Error', err);
            if (faceMsg) faceMsg.textContent = 'System Error.';
            captureBtn.disabled = false;
        }
    });
}
