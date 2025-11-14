async function loadExpenses() {
  const res = await fetch(sheetUrl(SHEET_EXPENSES));
  const data = await res.json();
  const filteredData = data.slice(1); // Skip row 2 (start from row 3)

  const list = document.getElementById("expense-list");
  list.innerHTML = filteredData
    .filter(x => x.Status !== "Deleted")
    .map(x => `
      <div class="expense-item">
        <span>${x.Date}</span>
        <span>${x.Category}</span>
        <span>${x.Amount} ៛</span>
        <button onclick="deleteExpense('${x.ID}')">🗑️</button>
      </div>
    `)
    .join("");
}

async function addExpense() {
  const date = document.getElementById("date").value;
  const amount = document.getElementById("amount").value;
  const type = document.getElementById("type").value;
  const category = document.getElementById("category").value;
  const desc = document.getElementById("desc").value;

  const user = JSON.parse(localStorage.getItem("user"));

  const payload = {
    data: [
      {
        ID: Date.now(),
        Date: date,
        Amount: amount,
        Type: type,
        Category: category,
        Description: desc,
        UserEmail: user.Email,
        Status: "Active",
        ModifiedDate: new Date().toISOString()
      }
    ]
  };

  await fetch(sheetUrl(SHEET_EXPENSES), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  loadExpenses();
}

async function deleteExpense(id) {
  const url = `${SHEETDB_BASE_URL}/ID/${id}?sheet=${SHEET_EXPENSES}`;

  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: [{ Status: "Deleted" }] })
  });

  if (res.ok) {
    console.log("Deleted successfully");
    loadExpenses();
  } else {
    const err = await res.text();
    console.error("Delete failed:", err);
  }
}

loadExpenses();


function logout() {
  // Remove user data from localStorage
  localStorage.removeItem("user");

  // Optional: clear other local data (if you stored more)
  localStorage.clear();

  // Redirect to login page
  window.location.href = "index.html"; // change if your login page has another name
}

const user = JSON.parse(localStorage.getItem("user"));
if (!user) {
  window.location.href = "index.html";
}

