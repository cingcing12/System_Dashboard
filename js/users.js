async function loadUsers() {
    const res = await fetch(sheetUrl(SHEET_USERS));
    const data = await res.json();
    const users = data.slice(1); // start from row 3
    const list = document.getElementById("user-list");
    list.innerHTML = users.map(u => `
        <div class="flex justify-between items-center p-2 border-b border-gray-200">
            <div>
                <p class="font-semibold">${u.Email}</p>
                <p class="text-sm text-gray-500">${u.Role} | Blocked: ${u.IsBlocked}</p>
            </div>
            <div class="space-x-2">
                <button onclick="toggleBlock('${u.Email}', '${u.IsBlocked}')" class="bg-red-500 text-white px-2 py-1 rounded text-sm">Toggle Block</button>
                <button onclick="resetPassword('${u.Email}')" class="bg-yellow-500 text-white px-2 py-1 rounded text-sm">Reset PW</button>
            </div>
        </div>
    `).join("");
}

async function addUser() {
    const email = document.getElementById("newEmail").value.trim();
    const password = document.getElementById("newPassword").value.trim();
    const role = document.getElementById("newRole").value;

    if(!email || !password) return alert("Fill all fields!");

    const payload = {
        data: [{
            Email: email,
            PasswordHash: password,
            Role: role,
            IsBlocked: "FALSE",
            LastLogin: ""
        }]
    };

    await fetch(sheetUrl(SHEET_USERS), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    alert("User added!");
    loadUsers();
}

async function toggleBlock(email, currentStatus) {
    const newStatus = currentStatus === "TRUE" ? "FALSE" : "TRUE";
    await fetch(`${SHEETDB_BASE_URL}/Email/${encodeURIComponent(email)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: [{ IsBlocked: newStatus }] })
    });
    loadUsers();
}

async function resetPassword(email) {
    const newPw = prompt("Enter new password for " + email);
    if(!newPw) return;
    await fetch(`${SHEETDB_BASE_URL}/Email/${encodeURIComponent(email)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: [{ PasswordHash: newPw }] })
    });
    loadUsers();
}

// Call loadUsers on dashboard load
loadUsers();
    