
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
  getFirestore,
  collection,
  addDoc,
  doc,
  updateDoc,
  query,
  getDocs,
  limit,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCatvZdoiio60Is3QKVFzTANAvK_ybkl_g",
  authDomain: "rafly-45dc4.firebaseapp.com",
  projectId: "rafly-45dc4",
  storageBucket: "rafly-45dc4.firebasestorage.app",
  messagingSenderId: "556160858793",
  appId: "1:556160858793:web:1cf6085488902b10f0c7b8"
};

const USERNAME_EMAIL_MAP = {
  grading: "grading@dura.local",
  staff: "staff@dura.local",
};

const DEFAULT_SUPPLIERS = [
  "CV Lembah Hijau Perkasa",
  "Koperasi Karya Mandiri",
  "Tani Rampah Jaya",
  "PT Putra Utama Lestari",
  "PT Manunggal Adi Jaya"
];

const SUPPLIER_COLLECTION_CANDIDATES = ["suppliers", "supplier"];
const LOCAL_KEYS = {
  suppliers: "dt_quick_suppliers",
  drivers: "dt_quick_drivers",
  plates: "dt_quick_plates"
};

const PAGE_TITLES = {
  dashboardPage: "Dashboard",
  inputPage: "Input Transaksi",
  transactionsPage: "Data Transaksi",
  dailyPage: "Rekap Harian",
  weeklyPage: "Rekap Mingguan",
  monthlyPage: "Rekap Bulanan",
  spreadsheetPage: "Spreadsheet",
  waPage: "Laporan WA",
  suppliersPage: "Supplier"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;
let currentRole = "grading";
let transactionsCache = [];
let todayCache = [];
let suppliersCollectionName = null;
let suppliersCache = [];
let unsubscribeTransactions = null;
let realtimeFirstSnapshot = false;

let txPage = 1;
let txPageSize = 12;
let spreadsheetPage = 1;
let spreadsheetPageSize = 20;
let supplierEditing = null;
let pendingDeleteId = null;
let currentPageId = "dashboardPage";

document.addEventListener("DOMContentLoaded", () => {
  bindUI();
  setTodayInputs();
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      currentUser = user;
      currentRole = resolveRole(user);
      showApp();
      await initializeAppData();
    } else {
      currentUser = null;
      currentRole = "grading";
      showLogin();
    }
  });
});

function bindUI() {
  window.handleLogin = handleLogin;
  window.handleLogout = handleLogout;
  window.toggleSidebar = toggleSidebar;
  window.showPage = showPage;
  window.refreshCurrentPage = refreshCurrentPage;
  window.saveTransaction = saveTransaction;
  window.resetForm = resetForm;
  window.changeTransactionPage = changeTransactionPage;
  window.resetTransactionFilters = resetTransactionFilters;
  window.changeSpreadsheetPage = changeSpreadsheetPage;
  window.resetSpreadsheetFilters = resetSpreadsheetFilters;
  window.generateWA = generateWA;
  window.copyWA = copyWA;
  window.sendWA = sendWA;
  window.deleteTransaction = deleteTransaction;
  window.closeConfirmModal = closeConfirmModal;
  window.exportReportExcel = exportReportExcel;
  window.saveSupplier = saveSupplier;
  window.resetSupplierForm = resetSupplierForm;

  document.querySelectorAll(".nav-link").forEach((btn) => {
    btn.addEventListener("click", () => showPage(btn.dataset.page));
  });

  ["tenera", "dura"].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", updateValidationPreview);
  });

  ["txSearch","txDate","txStart","txEnd","txSupplierFilter","txDriverFilter","txSort"].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", renderTransactionsTable);
    document.getElementById(id)?.addEventListener("change", renderTransactionsTable);
  });

  ["sheetSearch","sheetSupplierFilter","sheetDriverFilter"].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", renderSpreadsheetTable);
    document.getElementById(id)?.addEventListener("change", renderSpreadsheetTable);
  });

  ["waTemplate","waDate","waStart","waEnd","waSupplierFilter","waDriverFilter"].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", generateWA);
  });

  document.getElementById("supplierSearch")?.addEventListener("input", renderSuppliersPage);

  document.getElementById("confirmDeleteBtn")?.addEventListener("click", async () => {
    if (!pendingDeleteId) return;
    await performDeleteTransaction(pendingDeleteId);
    closeConfirmModal();
  });
}

function setTodayInputs() {
  const today = new Date().toISOString().split("T")[0];
  ["tanggal","waDate","txDate"].forEach((id) => {
    const el = document.getElementById(id);
    if (el && !el.value) el.value = today;
  });
}

function resolveRole(user) {
  const email = (user.email || "").toLowerCase();
  return email.includes("staff") ? "staff" : "grading";
}

function showLogin() {
  document.getElementById("loginPage").classList.remove("hidden");
  document.getElementById("appShell").classList.add("hidden");
}

function showApp() {
  document.getElementById("loginPage").classList.add("hidden");
  document.getElementById("appShell").classList.remove("hidden");
  document.getElementById("userEmail").textContent = currentUser?.email || "-";
  document.getElementById("userRoleBadge").textContent = currentRole === "staff" ? "STAFF" : "GRADING";
  applyRoleUI();
}

function applyRoleUI() {
  const canManage = currentRole === "staff";
  document.querySelector('[data-page="suppliersPage"]').classList.toggle("hidden", !canManage);
}

async function initializeAppData() {
  showLoading("Memuat data realtime...");
  await detectSuppliersCollection();
  await loadSuppliersBestEffort();
  subscribeTransactions();
  refreshQuickLists();
}

async function handleLogin() {
  const username = document.getElementById("username").value.trim().toLowerCase();
  const password = document.getElementById("password").value;
  const loginBtn = document.getElementById("loginBtn");
  const msg = document.getElementById("loginMessage");

  msg.textContent = "";
  if (!username || !password) {
    msg.textContent = "Username dan password wajib diisi.";
    return;
  }

  const email = USERNAME_EMAIL_MAP[username];
  if (!email) {
    msg.textContent = "Username tidak dikenal.";
    return;
  }

  loginBtn.disabled = true;
  loginBtn.textContent = "Memproses...";
  try {
    await signInWithEmailAndPassword(auth, email, password);
    toast("Login berhasil.");
  } catch (error) {
    console.error(error);
    msg.textContent = "Login gagal. Periksa akun Firebase Auth.";
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = "Login";
  }
}

async function handleLogout() {
  await signOut(auth);
  if (unsubscribeTransactions) {
    unsubscribeTransactions();
    unsubscribeTransactions = null;
  }
  realtimeFirstSnapshot = false;
  toast("Logout berhasil.");
}

function toggleSidebar(force) {
  const sidebar = document.getElementById("sidebar");
  const backdrop = document.getElementById("mobileBackdrop");
  const shouldOpen = typeof force === "boolean" ? force : !sidebar.classList.contains("open");
  sidebar.classList.toggle("open", shouldOpen);
  backdrop.classList.toggle("open", shouldOpen);
}

function showPage(pageId) {
  currentPageId = pageId;
  document.querySelectorAll(".page").forEach((p) => p.classList.add("hidden"));
  document.getElementById(pageId)?.classList.remove("hidden");
  document.querySelectorAll(".nav-link").forEach((btn) => btn.classList.toggle("active", btn.dataset.page === pageId));
  document.getElementById("topbarTitle").textContent = PAGE_TITLES[pageId] || "Dura Tenera";
  toggleSidebar(false);

  if (pageId === "dashboardPage") renderDashboard(todayCache);
  if (pageId === "transactionsPage") renderTransactionsTable();
  if (pageId === "dailyPage") renderReportPage("daily");
  if (pageId === "weeklyPage") renderReportPage("weekly");
  if (pageId === "monthlyPage") renderReportPage("monthly");
  if (pageId === "spreadsheetPage") renderSpreadsheetTable();
  if (pageId === "waPage") generateWA();
  if (pageId === "suppliersPage") renderSuppliersPage();
  if (pageId === "inputPage") {
    refreshQuickLists();
    updateValidationPreview();
  }
}

function refreshCurrentPage() {
  renderActiveViews();
  toast("Tampilan diperbarui.");
}

function showLoading(text="Memuat...") {
  document.getElementById("loadingText").textContent = text;
  document.getElementById("loadingOverlay").classList.remove("hidden");
}

function hideLoading() {
  document.getElementById("loadingOverlay").classList.add("hidden");
}

function toast(message, type="ok") {
  const wrap = document.getElementById("toastContainer");
  const el = document.createElement("div");
  el.className = `toast ${type === "error" ? "error" : type === "warn" ? "warn" : ""}`;
  el.textContent = message;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

function setSyncStatus(text) {
  document.getElementById("syncStatus").textContent = text;
}

function parseDate(value) {
  if (!value) return null;
  return new Date(`${value}T00:00:00`);
}

function formatDateId(date) {
  return new Date(date).toISOString().split("T")[0];
}

function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0,0,0,0);
  return d;
}

function endOfWeek(date) {
  const d = startOfWeek(date);
  d.setDate(d.getDate() + 6);
  d.setHours(23,59,59,999);
  return d;
}

function startOfMonth(date) {
  const d = new Date(date);
  d.setDate(1);
  d.setHours(0,0,0,0);
  return d;
}

function endOfMonth(date) {
  const d = new Date(date);
  d.setMonth(d.getMonth()+1, 0);
  d.setHours(23,59,59,999);
  return d;
}

function inRangeByTanggal(item, start, end) {
  const value = parseDate(item.tanggal);
  if (!value) return false;
  return value >= start && value <= end;
}

function safeText(v) {
  return (v ?? "").toString();
}

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function saveRecentValue(key, value) {
  if (!value) return;
  const existing = JSON.parse(localStorage.getItem(key) || "[]");
  const cleaned = [value, ...existing.filter((x) => x !== value)].slice(0, 12);
  localStorage.setItem(key, JSON.stringify(cleaned));
}

function getRecentValues(key) {
  return JSON.parse(localStorage.getItem(key) || "[]");
}

function refreshQuickLists() {
  const supplierNames = Array.from(new Set([
    ...DEFAULT_SUPPLIERS,
    ...suppliersCache.map((s) => s.name).filter(Boolean),
    ...transactionsCache.map((t) => t.supplier).filter(Boolean),
    ...getRecentValues(LOCAL_KEYS.suppliers),
  ])).filter(Boolean);

  const driverNames = Array.from(new Set([
    ...transactionsCache.map((t) => t.sopir).filter(Boolean),
    ...getRecentValues(LOCAL_KEYS.drivers),
  ]));

  const plates = Array.from(new Set([
    ...transactionsCache.map((t) => t.plat).filter(Boolean),
    ...getRecentValues(LOCAL_KEYS.plates),
  ]));

  populateDatalist("supplierQuickList", supplierNames);
  populateDatalist("driverQuickList", driverNames);
  populateDatalist("plateQuickList", plates);

  renderChips("quickSuppliers", supplierNames.slice(0, 10), "supplier");
  renderChips("quickDrivers", driverNames.slice(0, 10), "sopir");
  renderChips("quickPlates", plates.slice(0, 10), "plat");

  const supplierOptions = ["Semua Supplier", ...supplierNames];
  const driverOptions = ["Semua Sopir", ...driverNames];

  ["txSupplierFilter","sheetSupplierFilter","waSupplierFilter"].forEach((id) => fillSelect(id, supplierOptions));
  ["txDriverFilter","sheetDriverFilter","waDriverFilter"].forEach((id) => fillSelect(id, driverOptions));
}

function populateDatalist(id, values) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = values.map((v) => `<option value="${escapeHtml(v)}"></option>`).join("");
}

function renderChips(targetId, values, fieldId) {
  const wrap = document.getElementById(targetId);
  if (!wrap) return;
  wrap.innerHTML = values.length
    ? values.map((v) => `<button class="chip" type="button" data-field="${fieldId}" data-value="${escapeHtml(v)}">${escapeHtml(v)}</button>`).join("")
    : '<span class="muted">Belum ada data.</span>';

  wrap.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const field = chip.dataset.field;
      document.getElementById(field).value = chip.dataset.value;
    });
  });
}

function fillSelect(id, values) {
  const el = document.getElementById(id);
  if (!el) return;
  const current = el.value;
  el.innerHTML = values.map((v, i) => `<option value="${i === 0 ? "" : escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
  if ([...el.options].some((opt) => opt.value === current)) el.value = current;
}

function escapeHtml(v) {
  return safeText(v)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function detectSuppliersCollection() {
  for (const name of SUPPLIER_COLLECTION_CANDIDATES) {
    try {
      await getDocs(query(collection(db, name), limit(1)));
      suppliersCollectionName = name;
      return;
    } catch (e) {}
  }
  suppliersCollectionName = null;
}

async function loadSuppliersBestEffort() {
  if (!suppliersCollectionName) {
    suppliersCache = DEFAULT_SUPPLIERS.map((name) => ({ id: name, name, status: "aktif", source: "default" }));
    return;
  }

  try {
    const snap = await getDocs(collection(db, suppliersCollectionName));
    suppliersCache = snap.docs.map((d) => {
      const data = d.data();
      const name = data.name || data.nama || data.nama_supplier || data.supplier || data.title || d.id;
      const statusRaw = data.status ?? data.aktif ?? data.active ?? "aktif";
      const status = typeof statusRaw === "boolean" ? (statusRaw ? "aktif" : "nonaktif") : safeText(statusRaw);
      return { id: d.id, name, status, raw: data, source: "firebase" };
    }).filter((x) => x.name);
  } catch (e) {
    suppliersCache = DEFAULT_SUPPLIERS.map((name) => ({ id: name, name, status: "aktif", source: "default" }));
  }
}

function subscribeTransactions() {
  if (unsubscribeTransactions) unsubscribeTransactions();
  realtimeFirstSnapshot = false;
  setSyncStatus("Menyambung realtime...");

  // Fix utama realtime:
  // Dengarkan seluruh collection tanpa where/orderBy untuk menghindari masalah index/query
  unsubscribeTransactions = onSnapshot(collection(db, "transactions"), (snap) => {
    transactionsCache = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((x) => !x.deleted)
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

    const today = formatDateId(new Date());
    todayCache = transactionsCache.filter((x) => x.tanggal === today);

    refreshQuickLists();
    renderActiveViews();
    setSyncStatus(`Realtime aktif • ${transactionsCache.length} data`);

    if (!realtimeFirstSnapshot) {
      realtimeFirstSnapshot = true;
      hideLoading();
      toast("Sinkron realtime aktif.");
    }
  }, (error) => {
    console.error(error);
    hideLoading();
    setSyncStatus("Gagal sinkron");
    toast("Gagal sinkron realtime. Cek rules/auth Firebase.", "error");
  });
}

function renderActiveViews() {
  renderDashboard(todayCache);
  if (!document.getElementById("transactionsPage").classList.contains("hidden")) renderTransactionsTable();
  if (!document.getElementById("dailyPage").classList.contains("hidden")) renderReportPage("daily");
  if (!document.getElementById("weeklyPage").classList.contains("hidden")) renderReportPage("weekly");
  if (!document.getElementById("monthlyPage").classList.contains("hidden")) renderReportPage("monthly");
  if (!document.getElementById("spreadsheetPage").classList.contains("hidden")) renderSpreadsheetTable();
  if (!document.getElementById("waPage").classList.contains("hidden")) generateWA();
  if (!document.getElementById("suppliersPage").classList.contains("hidden")) renderSuppliersPage();
}

function computeSummary(data) {
  const totalTransaksi = data.length;
  const totalSampel = data.reduce((sum, x) => sum + toNumber(x.total), 0);
  const totalTenera = data.reduce((sum, x) => sum + toNumber(x.tenera), 0);
  const totalDura = data.reduce((sum, x) => sum + toNumber(x.dura), 0);
  const persenTenera = totalSampel ? ((totalTenera / totalSampel) * 100) : 0;
  const persenDura = totalSampel ? ((totalDura / totalSampel) * 100) : 0;
  const dominan = totalTenera >= totalDura ? "Tenera" : "Dura";

  const bySupplier = aggregateBy(data, "supplier");
  const byDriver = aggregateBy(data, "sopir");

  const sortedSuppliers = [...bySupplier].sort((a, b) => b.totalSampel - a.totalSampel || b.jumlahTransaksi - a.jumlahTransaksi);
  const sortedDrivers = [...byDriver].sort((a, b) => b.totalSampel - a.totalSampel || b.jumlahTransaksi - a.jumlahTransaksi);

  return {
    totalTransaksi,
    totalSampel,
    totalTenera,
    totalDura,
    persenTenera,
    persenDura,
    dominan,
    supplierTertinggi: sortedSuppliers[0]?.name || "-",
    sopirTertinggi: sortedDrivers[0]?.name || "-",
    top3Supplier: sortedSuppliers.slice(0, 3),
    top3Sopir: sortedDrivers.slice(0, 3),
    bySupplier: sortedSuppliers,
    byDriver: sortedDrivers,
  };
}

function aggregateBy(data, key) {
  const map = new Map();
  data.forEach((row) => {
    const name = safeText(row[key] || "-");
    const item = map.get(name) || {
      name,
      jumlahTransaksi: 0,
      totalSampel: 0,
      totalTenera: 0,
      totalDura: 0,
    };
    item.jumlahTransaksi += 1;
    item.totalSampel += toNumber(row.total);
    item.totalTenera += toNumber(row.tenera);
    item.totalDura += toNumber(row.dura);
    map.set(name, item);
  });

  return Array.from(map.values()).map((item) => ({
    ...item,
    persenTenera: item.totalSampel ? (item.totalTenera / item.totalSampel) * 100 : 0,
    persenDura: item.totalSampel ? (item.totalDura / item.totalSampel) * 100 : 0,
  }));
}

function summaryCardsHTML(summary) {
  const topSuppliers = summary.top3Supplier.length
    ? summary.top3Supplier.map((x, i) => `<li>${i+1}. ${escapeHtml(x.name)}</li>`).join("")
    : "<li>-</li>";
  const topDrivers = summary.top3Sopir.length
    ? summary.top3Sopir.map((x, i) => `<li>${i+1}. ${escapeHtml(x.name)}</li>`).join("")
    : "<li>-</li>";

  return `
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><h4>1. Total</h4></div>
        <div class="metric-grid">
          <div class="metric-card"><div class="label">Total transaksi</div><div class="value">${summary.totalTransaksi}</div></div>
          <div class="metric-card"><div class="label">Total sampel</div><div class="value">${summary.totalSampel}</div></div>
          <div class="metric-card"><div class="label">Total Tenera</div><div class="value">${summary.totalTenera}</div></div>
          <div class="metric-card"><div class="label">Total Dura</div><div class="value">${summary.totalDura}</div></div>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h4>2. Persentase</h4></div>
        <div class="metric-grid">
          <div class="metric-card"><div class="label">% Tenera</div><div class="value">${summary.persenTenera.toFixed(2)}%</div></div>
          <div class="metric-card"><div class="label">% Dura</div><div class="value">${summary.persenDura.toFixed(2)}%</div></div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:16px;">
      <div class="card-head"><h4>3. Kesimpulan</h4></div>
      <div class="metric-grid">
        <div class="metric-card"><div class="label">Dominan</div><div class="value">${summary.dominan}</div></div>
        <div class="metric-card"><div class="label">Supplier tertinggi</div><div class="value">${escapeHtml(summary.supplierTertinggi)}</div></div>
        <div class="metric-card"><div class="label">Sopir tertinggi</div><div class="value">${escapeHtml(summary.sopirTertinggi)}</div></div>
      </div>
      <div class="grid-2" style="margin-top:14px;">
        <div class="reference-box"><strong>Top 3 Supplier</strong><ol>${topSuppliers}</ol></div>
        <div class="reference-box"><strong>Top 3 Sopir</strong><ol>${topDrivers}</ol></div>
      </div>
    </div>
  `;
}

function renderDashboard(data) {
  const wrap = document.getElementById("dashboardSummary");
  const summary = computeSummary(data);
  wrap.innerHTML = summaryCardsHTML(summary);
  renderAggregateTable("dashboardSupplierBody", summary.bySupplier);
  renderAggregateTable("dashboardDriverBody", summary.byDriver);
}

function renderAggregateTable(targetId, rows) {
  const body = document.getElementById(targetId);
  if (!body) return;
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="7">Belum ada data.</td></tr>';
    return;
  }
  body.innerHTML = rows.map((row) => `
    <tr>
      <td>${escapeHtml(row.name)}</td>
      <td>${row.jumlahTransaksi}</td>
      <td>${row.totalSampel}</td>
      <td>${row.totalTenera}</td>
      <td>${row.totalDura}</td>
      <td>${row.persenTenera.toFixed(2)}%</td>
      <td>${row.persenDura.toFixed(2)}%</td>
    </tr>
  `).join("");
}

function updateValidationPreview() {
  const tenera = toNumber(document.getElementById("tenera")?.value);
  const dura = toNumber(document.getElementById("dura")?.value);
  const total = tenera + dura;

  document.getElementById("previewTotal").textContent = total;
  document.getElementById("previewTenera").textContent = `${tenera}%`;
  document.getElementById("previewDura").textContent = `${dura}%`;

  const indicator = document.getElementById("validationIndicator");
  const valid = total === 100;
  let message = "Belum valid";
  let cls = "invalid";
  if (valid) {
    message = "Valid 100";
    cls = "valid";
  } else if (total < 100) {
    message = `Kurang dari 100 (${total})`;
    cls = "warn";
  } else {
    message = `Lebih dari 100 (${total})`;
    cls = "invalid";
  }
  indicator.className = `validation ${cls}`;
  indicator.textContent = message;

  document.getElementById("saveBtn").disabled = !valid;
  document.getElementById("saveNewBtn").disabled = !valid;
}

async function getDaySequence(dateStr) {
  // Tidak pakai query kombinasi yang rawan index.
  const sameDay = transactionsCache.filter((x) => x.tanggal === dateStr && !x.deleted);
  return sameDay.length + 1;
}

function generateTrxId(dateStr, count) {
  const raw = dateStr.replaceAll("-", "");
  return `TRX-${raw}-${String(count).padStart(3, "0")}`;
}

function formatTime(isoString) {
  const d = new Date(isoString);
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

async function saveTransaction(andNew=false) {
  const saveMessage = document.getElementById("saveMessage");
  const saveBtn = document.getElementById("saveBtn");
  const saveNewBtn = document.getElementById("saveNewBtn");

  const tanggal = document.getElementById("tanggal").value;
  const supplier = document.getElementById("supplier").value.trim();
  const sopir = document.getElementById("sopir").value.trim();
  const plat = document.getElementById("plat").value.trim();
  const tenera = toNumber(document.getElementById("tenera").value);
  const dura = toNumber(document.getElementById("dura").value);

  if (!tanggal || !supplier || !sopir || !plat) {
    saveMessage.textContent = "Semua field wajib diisi.";
    toast("Lengkapi semua field.", "warn");
    return;
  }
  if (tenera + dura !== 100) {
    saveMessage.textContent = "Tenera + Dura harus 100.";
    toast("Validasi gagal.", "warn");
    return;
  }

  saveBtn.disabled = true;
  saveNewBtn.disabled = true;
  saveMessage.textContent = "Menyimpan...";
  setSyncStatus("Menyimpan...");

  try {
    const now = new Date().toISOString();
    const seq = await getDaySequence(tanggal);

    await addDoc(collection(db, "transactions"), {
      trx_id: generateTrxId(tanggal, seq),
      tanggal,
      jam: formatTime(now),
      supplier,
      sopir,
      plat,
      tenera,
      dura,
      total: tenera + dura,
      persen_tenera: tenera,
      persen_dura: dura,
      created_by: currentUser?.email || null,
      created_at: now,
      deleted: false,
    });

    saveRecentValue(LOCAL_KEYS.suppliers, supplier);
    saveRecentValue(LOCAL_KEYS.drivers, sopir);
    saveRecentValue(LOCAL_KEYS.plates, plat);
    refreshQuickLists();

    saveMessage.textContent = "Data berhasil disimpan.";
    toast("Data tersimpan.");
    if (andNew) {
      resetForm(true);
    } else {
      showPage("transactionsPage");
    }
  } catch (error) {
    console.error(error);
    saveMessage.textContent = `Gagal simpan: ${error.message}`;
    toast("Gagal simpan data.", "error");
  } finally {
    updateValidationPreview();
    setSyncStatus(`Realtime aktif • ${transactionsCache.length} data`);
  }
}

function resetForm(keepDate=false) {
  const oldDate = document.getElementById("tanggal").value;
  ["supplier","sopir","plat","tenera","dura"].forEach((id) => {
    document.getElementById(id).value = "";
  });
  document.getElementById("saveMessage").textContent = "";
  if (!keepDate) document.getElementById("tanggal").value = formatDateId(new Date());
  else document.getElementById("tanggal").value = oldDate || formatDateId(new Date());
  updateValidationPreview();
}

function getTransactionFilteredRows() {
  const search = document.getElementById("txSearch").value.trim().toLowerCase();
  const singleDate = document.getElementById("txDate").value;
  const start = document.getElementById("txStart").value;
  const end = document.getElementById("txEnd").value;
  const supplier = document.getElementById("txSupplierFilter").value;
  const driver = document.getElementById("txDriverFilter").value;
  const sort = document.getElementById("txSort").value;

  let rows = [...transactionsCache];

  if (search) rows = rows.filter((row) => JSON.stringify(row).toLowerCase().includes(search));
  if (singleDate) rows = rows.filter((row) => row.tanggal === singleDate);
  if (start && end) {
    const s = parseDate(start);
    const e = parseDate(end);
    rows = rows.filter((row) => inRangeByTanggal(row, s, e));
  }
  if (supplier) rows = rows.filter((row) => row.supplier === supplier);
  if (driver) rows = rows.filter((row) => row.sopir === driver);

  rows.sort((a, b) => sort === "oldest"
    ? new Date(a.created_at || 0) - new Date(b.created_at || 0)
    : new Date(b.created_at || 0) - new Date(a.created_at || 0)
  );
  return rows;
}

function renderTransactionsTable() {
  const rows = getTransactionFilteredRows();
  const totalPages = Math.max(1, Math.ceil(rows.length / txPageSize));
  txPage = Math.min(txPage, totalPages);
  txPage = Math.max(1, txPage);
  const startIndex = (txPage - 1) * txPageSize;
  const pageRows = rows.slice(startIndex, startIndex + txPageSize);
  const body = document.getElementById("transactionsBody");

  document.getElementById("txCountInfo").textContent = `${rows.length} data`;
  document.getElementById("txPageInfo").textContent = `Hal. ${txPage} / ${totalPages}`;

  if (!pageRows.length) {
    body.innerHTML = '<tr><td colspan="13">Tidak ada data.</td></tr>';
    return;
  }

  body.innerHTML = pageRows.map((row, idx) => `
    <tr>
      <td>${startIndex + idx + 1}</td>
      <td>${escapeHtml(row.trx_id)}</td>
      <td>${escapeHtml(row.tanggal)}</td>
      <td>${escapeHtml(row.jam)}</td>
      <td>${escapeHtml(row.supplier)}</td>
      <td>${escapeHtml(row.sopir)}</td>
      <td>${escapeHtml(row.plat)}</td>
      <td>${toNumber(row.tenera)}</td>
      <td>${toNumber(row.dura)}</td>
      <td>${toNumber(row.total)}</td>
      <td>${toNumber(row.persen_tenera)}%</td>
      <td>${toNumber(row.persen_dura)}%</td>
      <td>${renderTransactionActions(row)}</td>
    </tr>
  `).join("");
}

function renderTransactionActions(row) {
  if (currentRole !== "staff") return '<span class="muted">Lihat</span>';
  return `<button class="action-link" onclick="deleteTransaction('${row.id}')">Hapus</button>`;
}

function resetTransactionFilters() {
  ["txSearch","txDate","txStart","txEnd"].forEach((id) => document.getElementById(id).value = "");
  ["txSupplierFilter","txDriverFilter"].forEach((id) => document.getElementById(id).value = "");
  document.getElementById("txSort").value = "newest";
  txPage = 1;
  renderTransactionsTable();
}

function changeTransactionPage(delta) {
  txPage += delta;
  renderTransactionsTable();
}

function getSpreadsheetRows() {
  const search = document.getElementById("sheetSearch").value.trim().toLowerCase();
  const supplier = document.getElementById("sheetSupplierFilter").value;
  const driver = document.getElementById("sheetDriverFilter").value;
  let rows = [...transactionsCache];

  if (search) rows = rows.filter((row) => JSON.stringify(row).toLowerCase().includes(search));
  if (supplier) rows = rows.filter((row) => row.supplier === supplier);
  if (driver) rows = rows.filter((row) => row.sopir === driver);

  return rows;
}

function renderSpreadsheetTable() {
  const rows = getSpreadsheetRows();
  const totalPages = Math.max(1, Math.ceil(rows.length / spreadsheetPageSize));
  spreadsheetPage = Math.min(spreadsheetPage, totalPages);
  spreadsheetPage = Math.max(1, spreadsheetPage);
  const startIndex = (spreadsheetPage - 1) * spreadsheetPageSize;
  const pageRows = rows.slice(startIndex, startIndex + spreadsheetPageSize);
  const body = document.getElementById("spreadsheetBody");
  document.getElementById("sheetCountInfo").textContent = `${rows.length} data tampil`;
  document.getElementById("sheetPageInfo").textContent = `Hal. ${spreadsheetPage} / ${totalPages}`;

  if (!pageRows.length) {
    body.innerHTML = '<tr><td colspan="12">Tidak ada data.</td></tr>';
    return;
  }

  body.innerHTML = pageRows.map((row, idx) => `
    <tr>
      <td>${startIndex + idx + 1}</td>
      <td>${escapeHtml(row.trx_id)}</td>
      <td>${escapeHtml(row.tanggal)}</td>
      <td>${escapeHtml(row.jam)}</td>
      <td>${escapeHtml(row.supplier)}</td>
      <td>${escapeHtml(row.sopir)}</td>
      <td>${escapeHtml(row.plat)}</td>
      <td>${toNumber(row.tenera)}</td>
      <td>${toNumber(row.dura)}</td>
      <td>${toNumber(row.total)}</td>
      <td>${toNumber(row.persen_tenera)}%</td>
      <td>${toNumber(row.persen_dura)}%</td>
    </tr>
  `).join("");
}

function resetSpreadsheetFilters() {
  ["sheetSearch"].forEach((id) => document.getElementById(id).value = "");
  ["sheetSupplierFilter","sheetDriverFilter"].forEach((id) => document.getElementById(id).value = "");
  spreadsheetPage = 1;
  renderSpreadsheetTable();
}

function changeSpreadsheetPage(delta) {
  spreadsheetPage += delta;
  renderSpreadsheetTable();
}

function getRowsByMode(mode) {
  const today = new Date();
  if (mode === "daily") {
    return transactionsCache.filter((x) => x.tanggal === formatDateId(today));
  }
  if (mode === "weekly") {
    const start = startOfWeek(today);
    const end = endOfWeek(today);
    return transactionsCache.filter((x) => inRangeByTanggal(x, start, end));
  }
  if (mode === "monthly") {
    const start = startOfMonth(today);
    const end = endOfMonth(today);
    return transactionsCache.filter((x) => inRangeByTanggal(x, start, end));
  }
  return [...transactionsCache];
}

function reportDetailTableHTML(title, rows, kind) {
  if (kind === "transactions") {
    return `
      <div class="card" style="margin-top:16px;">
        <div class="card-head"><h4>${title}</h4></div>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>ID transaksi</th>
                <th>Tanggal</th>
                <th>Jam</th>
                <th>Supplier</th>
                <th>Sopir</th>
                <th>Plat</th>
                <th>Tenera</th>
                <th>Dura</th>
                <th>Total</th>
                <th>% Tenera</th>
                <th>% Dura</th>
              </tr>
            </thead>
            <tbody>
              ${rows.length ? rows.map((row) => `
                <tr>
                  <td>${escapeHtml(row.trx_id)}</td>
                  <td>${escapeHtml(row.tanggal)}</td>
                  <td>${escapeHtml(row.jam)}</td>
                  <td>${escapeHtml(row.supplier)}</td>
                  <td>${escapeHtml(row.sopir)}</td>
                  <td>${escapeHtml(row.plat)}</td>
                  <td>${toNumber(row.tenera)}</td>
                  <td>${toNumber(row.dura)}</td>
                  <td>${toNumber(row.total)}</td>
                  <td>${toNumber(row.persen_tenera)}%</td>
                  <td>${toNumber(row.persen_dura)}%</td>
                </tr>
              `).join("") : '<tr><td colspan="11">Tidak ada data.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  return `
    <div class="card" style="margin-top:16px;">
      <div class="card-head"><h4>${title}</h4></div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Nama</th>
              <th>Jumlah transaksi</th>
              <th>Total sampel</th>
              <th>Total tenera</th>
              <th>Total dura</th>
              <th>% tenera</th>
              <th>% dura</th>
            </tr>
          </thead>
          <tbody>
            ${rows.length ? rows.map((row) => `
              <tr>
                <td>${escapeHtml(row.name)}</td>
                <td>${row.jumlahTransaksi}</td>
                <td>${row.totalSampel}</td>
                <td>${row.totalTenera}</td>
                <td>${row.totalDura}</td>
                <td>${row.persenTenera.toFixed(2)}%</td>
                <td>${row.persenDura.toFixed(2)}%</td>
              </tr>
            `).join("") : '<tr><td colspan="7">Tidak ada data.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderReportPage(mode) {
  const targetId = mode === "daily" ? "dailyReport" : mode === "weekly" ? "weeklyReport" : "monthlyReport";
  const target = document.getElementById(targetId);
  const rows = getRowsByMode(mode);
  const summary = computeSummary(rows);

  target.innerHTML = `
    ${summaryCardsHTML(summary)}
    ${reportDetailTableHTML("4. Detail Per Supplier", summary.bySupplier, "aggregate")}
    ${reportDetailTableHTML("Detail Per Sopir", summary.byDriver, "aggregate")}
    ${reportDetailTableHTML("Detail Transaksi", rows, "transactions")}
  `;
}

function getWAFilters() {
  return {
    template: document.getElementById("waTemplate").value,
    date: document.getElementById("waDate").value,
    start: document.getElementById("waStart").value,
    end: document.getElementById("waEnd").value,
    supplier: document.getElementById("waSupplierFilter").value,
    driver: document.getElementById("waDriverFilter").value,
  };
}

function getRowsForWA() {
  const f = getWAFilters();
  let rows = [...transactionsCache];

  if (f.date) rows = rows.filter((x) => x.tanggal === f.date);
  if (f.start && f.end) rows = rows.filter((x) => inRangeByTanggal(x, parseDate(f.start), parseDate(f.end)));
  if (f.supplier) rows = rows.filter((x) => x.supplier === f.supplier);
  if (f.driver) rows = rows.filter((x) => x.sopir === f.driver);

  return rows;
}

function generateWA() {
  const rows = getRowsForWA();
  const textArea = document.getElementById("waText");
  if (!rows.length) {
    textArea.value = "Belum ada data untuk laporan sesuai filter.";
    return;
  }

  const f = getWAFilters();
  const summary = computeSummary(rows);
  const period = f.start && f.end ? `${f.start} s/d ${f.end}` : f.date || "Semua Data";
  const template = f.template;

  let text = "";
  text += `LAPORAN DURA TENERA\n`;
  text += `Periode: ${period}\n\n`;
  text += `TOTAL\n`;
  text += `- Total transaksi: ${summary.totalTransaksi}\n`;
  text += `- Total sampel: ${summary.totalSampel}\n`;
  text += `- Total Tenera: ${summary.totalTenera}\n`;
  text += `- Total Dura: ${summary.totalDura}\n\n`;
  text += `PERSENTASE\n`;
  text += `- % Tenera: ${summary.persenTenera.toFixed(2)}%\n`;
  text += `- % Dura: ${summary.persenDura.toFixed(2)}%\n\n`;
  text += `KESIMPULAN\n`;
  text += `- Dominan: ${summary.dominan}\n`;
  text += `- Supplier tertinggi: ${summary.supplierTertinggi}\n`;
  text += `- Sopir tertinggi: ${summary.sopirTertinggi}\n\n`;

  if (template === "ringkas") {
    text += `TOP 3 SUPPLIER\n`;
    summary.top3Supplier.forEach((x, i) => text += `${i+1}. ${x.name}\n`);
    text += `\nTOP 3 SOPIR\n`;
    summary.top3Sopir.forEach((x, i) => text += `${i+1}. ${x.name}\n`);
  } else if (template === "supplier") {
    text += `DETAIL PER SUPPLIER\n`;
    summary.bySupplier.forEach((x) => {
      text += `- ${x.name}: ${x.jumlahTransaksi} transaksi | Sampel ${x.totalSampel} | Tenera ${x.totalTenera} | Dura ${x.totalDura} | ${x.persenTenera.toFixed(2)}% : ${x.persenDura.toFixed(2)}%\n`;
    });
  } else if (template === "sopir") {
    text += `DETAIL PER SOPIR\n`;
    summary.byDriver.forEach((x) => {
      text += `- ${x.name}: ${x.jumlahTransaksi} transaksi | Sampel ${x.totalSampel} | Tenera ${x.totalTenera} | Dura ${x.totalDura} | ${x.persenTenera.toFixed(2)}% : ${x.persenDura.toFixed(2)}%\n`;
    });
  } else {
    text += `DETAIL PER SUPPLIER\n`;
    summary.bySupplier.forEach((x) => {
      text += `- ${x.name}: ${x.jumlahTransaksi} transaksi | Sampel ${x.totalSampel} | Tenera ${x.totalTenera} | Dura ${x.totalDura} | ${x.persenTenera.toFixed(2)}% : ${x.persenDura.toFixed(2)}%\n`;
    });
    text += `\nDETAIL PER SOPIR\n`;
    summary.byDriver.forEach((x) => {
      text += `- ${x.name}: ${x.jumlahTransaksi} transaksi | Sampel ${x.totalSampel} | Tenera ${x.totalTenera} | Dura ${x.totalDura} | ${x.persenTenera.toFixed(2)}% : ${x.persenDura.toFixed(2)}%\n`;
    });
  }

  textArea.value = text;
}

async function copyWA() {
  const text = document.getElementById("waText").value;
  if (!text) return toast("Narasi kosong.", "warn");
  await navigator.clipboard.writeText(text);
  toast("Narasi berhasil disalin.");
}

function sendWA() {
  const text = document.getElementById("waText").value;
  if (!text) return toast("Generate narasi dulu.", "warn");
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
}

function buildWorkbook(title, rows) {
  const summary = computeSummary(rows);
  const wb = XLSX.utils.book_new();
  const generated = new Date().toLocaleString("id-ID");

  const ringkasanRows = [
    ["Judul Laporan", title],
    ["Periode", title],
    ["Tanggal Generate", generated],
    [],
    ["Total transaksi", summary.totalTransaksi],
    ["Total sampel", summary.totalSampel],
    ["Total tenera", summary.totalTenera],
    ["Total dura", summary.totalDura],
    ["% tenera", `${summary.persenTenera.toFixed(2)}%`],
    ["% dura", `${summary.persenDura.toFixed(2)}%`],
    ["Dominan", summary.dominan],
    ["Supplier tertinggi", summary.supplierTertinggi],
    ["Sopir tertinggi", summary.sopirTertinggi],
    ["Top 3 supplier", summary.top3Supplier.map((x) => x.name).join(", ")],
    ["Top 3 sopir", summary.top3Sopir.map((x) => x.name).join(", ")],
  ];

  const wsSummary = XLSX.utils.aoa_to_sheet(ringkasanRows);
  wsSummary["!cols"] = [{wch:24}, {wch:52}];

  const supplierRows = summary.bySupplier.map((x) => ({
    Nama: x.name,
    "Jumlah Transaksi": x.jumlahTransaksi,
    "Total Sampel": x.totalSampel,
    "Total Tenera": x.totalTenera,
    "Total Dura": x.totalDura,
    "% Tenera": `${x.persenTenera.toFixed(2)}%`,
    "% Dura": `${x.persenDura.toFixed(2)}%`,
  }));

  const driverRows = summary.byDriver.map((x) => ({
    Nama: x.name,
    "Jumlah Transaksi": x.jumlahTransaksi,
    "Total Sampel": x.totalSampel,
    "Total Tenera": x.totalTenera,
    "Total Dura": x.totalDura,
    "% Tenera": `${x.persenTenera.toFixed(2)}%`,
    "% Dura": `${x.persenDura.toFixed(2)}%`,
  }));

  const detailRows = rows.map((x) => ({
    "ID transaksi": x.trx_id || "",
    Tanggal: x.tanggal || "",
    Jam: x.jam || "",
    Supplier: x.supplier || "",
    Sopir: x.sopir || "",
    Plat: x.plat || "",
    Tenera: toNumber(x.tenera),
    Dura: toNumber(x.dura),
    Total: toNumber(x.total),
    "% Tenera": `${toNumber(x.persen_tenera)}%`,
    "% Dura": `${toNumber(x.persen_dura)}%`,
  }));

  const wsSupplier = XLSX.utils.json_to_sheet(supplierRows);
  const wsDriver = XLSX.utils.json_to_sheet(driverRows);
  const wsDetail = XLSX.utils.json_to_sheet(detailRows);

  XLSX.utils.book_append_sheet(wb, wsSummary, "Ringkasan");
  XLSX.utils.book_append_sheet(wb, wsSupplier, "Per Supplier");
  XLSX.utils.book_append_sheet(wb, wsDriver, "Per Sopir");
  XLSX.utils.book_append_sheet(wb, wsDetail, "Detail Transaksi");
  return wb;
}

function exportReportExcel(mode) {
  let rows = [];
  let title = "Rekap Custom";
  if (mode === "daily") {
    rows = getRowsByMode("daily");
    title = "Rekap Harian";
  } else if (mode === "weekly") {
    rows = getRowsByMode("weekly");
    title = "Rekap Mingguan";
  } else if (mode === "monthly") {
    rows = getRowsByMode("monthly");
    title = "Rekap Bulanan";
  } else {
    rows = getRowsForWA().length ? getRowsForWA() : [...transactionsCache];
    title = "Rekap Custom";
  }

  if (!rows.length) return toast("Tidak ada data untuk export.", "warn");
  const wb = buildWorkbook(title, rows);
  const filename = `${title.toLowerCase().replaceAll(" ", "-")}-${formatDateId(new Date())}.xlsx`;
  XLSX.writeFile(wb, filename);
}

function renderSuppliersPage() {
  const body = document.getElementById("supplierBody");
  const search = document.getElementById("supplierSearch").value.trim().toLowerCase();
  const rows = suppliersCache.filter((x) => safeText(x.name).toLowerCase().includes(search));

  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="3">Supplier tidak ditemukan.</td></tr>';
    return;
  }

  body.innerHTML = rows.map((x) => `
    <tr>
      <td>${escapeHtml(x.name)}</td>
      <td>${escapeHtml(x.status || "-")}</td>
      <td>${currentRole === "staff" && suppliersCollectionName && x.source === "firebase"
        ? `<button class="action-link" onclick="editSupplier('${x.id}')">Edit</button>
           <button class="action-link" onclick="deleteSupplier('${x.id}')">Hapus</button>`
        : '<span class="muted">Lihat</span>'}
      </td>
    </tr>
  `).join("");
}

window.editSupplier = (id) => {
  const item = suppliersCache.find((x) => x.id === id);
  if (!item) return;
  supplierEditing = item.id;
  document.getElementById("supplierNameInput").value = item.name;
  document.getElementById("supplierStatusInput").value = item.status?.toLowerCase().includes("non") ? "nonaktif" : "aktif";
};

window.deleteSupplier = async (id) => {
  if (currentRole !== "staff" || !suppliersCollectionName) return;
  const item = suppliersCache.find((x) => x.id === id);
  if (!item) return;
  if (!confirm(`Hapus supplier ${item.name}?`)) return;

  try {
    await updateDoc(doc(db, suppliersCollectionName, id), { deleted: true });
    toast("Supplier ditandai terhapus.");
    await loadSuppliersBestEffort();
    renderSuppliersPage();
  } catch (error) {
    console.error(error);
    toast("Gagal hapus supplier.", "error");
  }
};

async function saveSupplier() {
  if (currentRole !== "staff") return toast("Akses supplier hanya untuk staff.", "warn");
  const name = document.getElementById("supplierNameInput").value.trim();
  const status = document.getElementById("supplierStatusInput").value;
  if (!name) return toast("Nama supplier wajib diisi.", "warn");
  if (!suppliersCollectionName) return toast("Collection supplier tidak terdeteksi.", "warn");

  try {
    if (supplierEditing) {
      await updateDoc(doc(db, suppliersCollectionName, supplierEditing), { name, status });
      toast("Supplier diperbarui.");
    } else {
      await addDoc(collection(db, suppliersCollectionName), { name, status });
      toast("Supplier ditambahkan.");
    }
    supplierEditing = null;
    resetSupplierForm();
    await loadSuppliersBestEffort();
    refreshQuickLists();
    renderSuppliersPage();
  } catch (error) {
    console.error(error);
    toast("Gagal simpan supplier. Cek field collection supplier Anda.", "error");
  }
}

function resetSupplierForm() {
  supplierEditing = null;
  document.getElementById("supplierNameInput").value = "";
  document.getElementById("supplierStatusInput").value = "aktif";
}

function deleteTransaction(id) {
  if (currentRole !== "staff") return toast("Hanya staff yang dapat menghapus.", "warn");
  const item = transactionsCache.find((x) => x.id === id);
  if (!item) return;
  pendingDeleteId = id;
  document.getElementById("confirmModalContent").innerHTML = `
    <p>ID: <strong>${escapeHtml(item.trx_id)}</strong></p>
    <p>Tanggal: <strong>${escapeHtml(item.tanggal)}</strong></p>
    <p>Supplier: <strong>${escapeHtml(item.supplier)}</strong></p>
    <p>Sopir: <strong>${escapeHtml(item.sopir)}</strong></p>
    <p>Total: <strong>${toNumber(item.total)}</strong></p>
  `;
  document.getElementById("confirmModal").classList.remove("hidden");
}

function closeConfirmModal() {
  pendingDeleteId = null;
  document.getElementById("confirmModal").classList.add("hidden");
}

async function performDeleteTransaction(id) {
  try {
    await updateDoc(doc(db, "transactions", id), { deleted: true });
    toast("Data berhasil dihapus.");
  } catch (error) {
    console.error(error);
    toast("Gagal menghapus data.", "error");
  }
}
