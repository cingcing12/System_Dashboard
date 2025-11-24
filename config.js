// ✅ Your unique SheetDB API base URL
const SHEETDB_BASE_URL = "https://sheetdb.io/api/v1/3ack97nmcay65";

// Tabs (Sheets)
const SHEET_EXPENSES = "Expenses";
const SHEET_USERS = "Users";
const SHEET_SETTINGS = "Settings";

// Helper to build URLs by tab name
function sheetUrl(sheetName) {
  return `${SHEETDB_BASE_URL}?sheet=${sheetName}`;
}
