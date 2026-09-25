// ===================================================================
// D' CopynPrint — shared app shell (sidebar ala Discord + top strip mini)
// Dipakai oleh semua halaman yang butuh navigasi: home, community,
// profile, messages, printer, users, printers.
//
// Setiap halaman HARUS punya markup ini di <body>:
//   <div class="app-shell">
//     <aside class="sidebar" id="sidebar"></aside>
//     <div class="main-col">
//       <div class="topbar-mini" id="topbarMini"></div>
//       <div class="wrap"> ...isi halaman... </div>
//     </div>
//   </div>
//
// Aturan layout (per revisi terakhir):
// - Topbar atas (topbar-mini): CUMA tombol Kontak CS. Tidak ada apa-apa
//   lagi di sana (bukan link profil, bukan avatar).
// - Klik Kontak CS TIDAK langsung buka WhatsApp — user isi form (username +
//   email + keluhan/pertanyaan) dulu di modal, baru abis Submit diarahkan
//   ke WhatsApp CS dengan pesan yang udah otomatis terisi dari form itu.
// - Sidebar: menu navigasi + link Profil di paling bawah (menggantikan
//   tombol Keluar lama). Logout & switch account sekarang cuma ada di
//   halaman profile.html (lihat js/profile.js).
// ===================================================================
import { supportWaLink } from "./support-config.js";
import { iconImg, avatarHtml, regionKeyFrom } from "./app.js";
import { auth, db } from "./firebase-config.js";
import {
  doc, getDoc, collection, query, where, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// active: "home" | "community" | "messages" | "profile" | "users" | "printers"
// (printer.html JUGA memanggil initShell dengan active: "home" — lihat
// catatan di initShell di bawah soal kenapa)
const NAV_ITEMS = [
  { id: "home", href: "home.html", icon: "Upload", label: "Printer" },
  { id: "community", href: "community.html", icon: "Community", label: "Komunitas" },
  { id: "messages", href: "messages.html", icon: "Message", label: "Pesan" },
];

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s || "";
  return d.innerHTML;
}

function initials(nameOrEmail) {
  const s = (nameOrEmail || "?").trim();
  return s ? s[0].toUpperCase() : "?";
}

// Topbar-mini SELALU cuma berisi tombol Kontak CS, guest maupun sudah login.
// Ini <button>, BUKAN <a> — supaya klik-nya buka form dulu, bukan langsung
// lompat ke WhatsApp.
function renderTopbar(topbarMini) {
  topbarMini.innerHTML = `
    <button type="button" class="mobile-menu-btn" id="mobileMenuBtn" aria-label="Buka menu" aria-expanded="false">
      <span></span><span></span><span></span>
    </button>
    <button type="button" class="topbar-mini-link" id="ctcCsBtn">
      <span class="avatar-circle" style="background:#3B7A57;">${iconImg("Support", "CS", "icon-img icon-sm")}</span> Kontak CS
    </button>
  `;
}

// ---------------------------------------------------------------------
// Mobile: sidebar SEKARANG jadi drawer yang slide dari kiri (ala menu
// riwayat chat di app Claude versi mobile), bukan lagi baris navigasi
// yang nempel di atas layar (itu makan tempat & aneh di HP). Dibuka
// lewat tombol hamburger di topbar-mini, ditutup lewat tombol hamburger
// lagi, tap di luar (backdrop), atau tap salah satu link di dalamnya.
// Idempotent & aman dipanggil ulang tiap initShell (tiap ganti halaman).
// ---------------------------------------------------------------------
function ensureSidebarBackdrop() {
  let backdrop = document.getElementById("sidebarBackdrop");
  if (!backdrop) {
    backdrop = document.createElement("div");
    backdrop.id = "sidebarBackdrop";
    backdrop.className = "sidebar-backdrop";
    document.body.appendChild(backdrop);
  }
  return backdrop;
}

function initMobileDrawer(sidebar) {
  const menuBtn = document.getElementById("mobileMenuBtn");
  const backdrop = ensureSidebarBackdrop();
  if (!menuBtn) return;

  const closeDrawer = () => {
    sidebar.classList.remove("is-open");
    backdrop.classList.remove("is-open");
    menuBtn.setAttribute("aria-expanded", "false");
  };
  const openDrawer = () => {
    sidebar.classList.add("is-open");
    backdrop.classList.add("is-open");
    menuBtn.setAttribute("aria-expanded", "true");
  };

  menuBtn.addEventListener("click", () => {
    sidebar.classList.contains("is-open") ? closeDrawer() : openDrawer();
  });
  backdrop.addEventListener("click", closeDrawer);
  // Tap link navigasi di dalam drawer -> otomatis tertutup (rapi kalau
  // sempat kelihatan sesaat sebelum halaman baru dimuat).
  sidebar.querySelectorAll("a, button").forEach((el) => {
    el.addEventListener("click", closeDrawer);
  });
}

// ---------------------------------------------------------------------
// Modal form Kontak CS: dibikin sekali (ditempel ke <body>, dipakai ulang
// tiap kali tombol Kontak CS diklik di halaman mana pun). Isi form dulu
// (username + email + keluhan/pertanyaan), baru pas Submit dibuka tab baru
// ke wa.me dengan teks pesan yang sudah digabung dari isian form. Kalau
// user lagi login, field username & email OTOMATIS keisi dari profil dia
// (masih bisa diedit) — keluhan tetap harus diketik manual tiap kali.
// ---------------------------------------------------------------------
function ensureContactModal() {
  if (document.getElementById("csContactModal")) return;

  const modal = document.createElement("div");
  modal.id = "csContactModal";
  modal.className = "modal-backdrop hidden";
  modal.innerHTML = `
    <div class="modal-box" style="max-width:420px;">
      <h3>Kontak CS</h3>
      <p class="sub" style="margin-bottom:14px;">
        Isi dulu formulirnya — nanti kamu diarahkan ke WhatsApp CS dengan pesan yang sudah otomatis terisi.
      </p>
      <label for="csUsername">Username</label>
      <input type="text" id="csUsername" placeholder="usernamekamu">
      <label for="csEmail">Email</label>
      <input type="email" id="csEmail" placeholder="emailkamu@contoh.com">
      <label for="csMessage">Keluhan / pertanyaan</label>
      <textarea id="csMessage" class="post-textarea" rows="4" placeholder="Ceritain kendalanya di sini..."></textarea>
      <div class="error-msg" id="csErr"></div>
      <div class="modal-actions" style="margin-top:16px;">
        <button class="btn btn-outline" id="csCancelBtn">Batal</button>
        <button class="btn btn-primary" id="csSubmitBtn">Submit</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const usernameInput = document.getElementById("csUsername");
  const emailInput = document.getElementById("csEmail");
  const msgInput = document.getElementById("csMessage");
  const errEl = document.getElementById("csErr");
  const cancelBtn = document.getElementById("csCancelBtn");
  const submitBtn = document.getElementById("csSubmitBtn");

  const close = () => modal.classList.add("hidden");
  cancelBtn.addEventListener("click", close);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });

  // Enter di field satu baris (username/email) langsung submit. Textarea
  // keluhan SENGAJA tidak dikasih ini — Enter di textarea harus tetap
  // bikin baris baru, bukan langsung kirim.
  [usernameInput, emailInput].forEach((inp) => {
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") submitBtn.click(); });
  });

  submitBtn.addEventListener("click", () => {
    const username = usernameInput.value.trim();
    const email = emailInput.value.trim();
    const message = msgInput.value.trim();
    if (!username || !message) {
      errEl.textContent = "Isi username dan keluhan/pertanyaan kamu dulu.";
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errEl.textContent = "Format email tidak valid.";
      return;
    }
    errEl.textContent = "";
    const waText = `Halo, saya ${username}${email ? ` (${email})` : ""}. ${message}`;
    window.open(supportWaLink(waText), "_blank", "noopener");
    msgInput.value = "";
    close();
  });
}

async function openContactModal(defaultUsername, defaultEmail) {
  ensureContactModal();
  const modal = document.getElementById("csContactModal");
  const usernameInput = document.getElementById("csUsername");
  const emailInput = document.getElementById("csEmail");
  const errEl = document.getElementById("csErr");
  if (defaultUsername) usernameInput.value = defaultUsername;
  if (defaultEmail) emailInput.value = defaultEmail;
  errEl.textContent = "";
  modal.classList.remove("hidden");

  // Ambil ulang dokumen user LANGSUNG dari Firestore begitu modal dibuka
  // (bukan cuma andalkan objek "profile" yang ditangkap sekali pas halaman
  // pertama dimuat). Ini jaga-jaga kalau field "contactEmail"/"username"
  // baru saja berubah (mis. baru daftar) — supaya username & email SELALU
  // otomatis keisi dengan data terbaru, bukan cuma username doang.
  const uid = auth.currentUser && auth.currentUser.uid;
  if (!uid) return;
  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (!snap.exists() || modal.classList.contains("hidden")) return;
    const fresh = snap.data();
    if (!usernameInput.value.trim() && (fresh.username || fresh.displayName)) {
      usernameInput.value = fresh.username || fresh.displayName;
    }
    if (!emailInput.value.trim() && fresh.contactEmail) {
      emailInput.value = fresh.contactEmail;
    }
  } catch (e) {
    // Diam saja kalau gagal — field tetap terisi dari data yang sudah ada.
  }
}

// ===================================================================
// Popup notif "pesanan belum diterima" — dipasang di SINI (bukan di
// printer.js) supaya nongol di halaman MANA PUN selama operator/dev
// login, bukan cuma pas lagi buka Dashboard Operator. Nempel ke
// document.body (kayak modal Kontak CS di atas), jadi otomatis ada
// tiap kali initShell dipanggil (tiap halaman yang pakai shell).
//
// seenPendingIds: id job yang toast-nya udah pernah ditampilin — biar
// snapshot berikutnya (mis. ada job LAIN yang berubah status, tapi job
// pending yang sama masih ada) tidak bikin toast yang sama muncul lagi.
// lastPendingDocs: cache snapshot pending terakhir.
//
// PENTING soal "Ingatkan aku nanti": app ini MPA (tiap link = reload
// penuh), jadi variable JS di atas ke-reset tiap kali pindah halaman —
// setTimeout doang nggak bakal pernah sempat kepanggil (mati bareng
// halaman lama). Makanya progress snooze-nya DISIMPAN DI localStorage
// (bertahan lintas reload) dan dihitung berdasarkan JUMLAH PINDAH
// HALAMAN sungguhan (tiap initShell jalan di halaman baru = +1),
// bukan berdasarkan waktu. Begitu nyampe SNOOZE_NAV_THRESHOLD kali
// pindah halaman, job yang di-snooze itu "dilupakan" dari daftar
// seen supaya toast-nya muncul lagi kalau masih pending.
// ===================================================================
const SNOOZE_NAV_THRESHOLD = 5; // diingatkan lagi setelah 5x pindah halaman
let seenPendingIds = new Set();
let lastPendingDocs = [];
let pendingNotifierStarted = false;
let notifierUid = null;

function seenStorageKey(uid) { return `dcnp_seenPending_${uid}`; }
function snoozeStorageKey(uid) { return `dcnp_snoozePending_${uid}`; }

function loadSeenIds(uid) {
  try {
    const raw = localStorage.getItem(seenStorageKey(uid));
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch (e) {
    return new Set();
  }
}
function saveSeenIds(uid, set) {
  try { localStorage.setItem(seenStorageKey(uid), JSON.stringify([...set])); } catch (e) {}
}
// snooze record: { jobIds: string[], navCount: number }
function loadSnooze(uid) {
  try {
    const raw = localStorage.getItem(snoozeStorageKey(uid));
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}
function saveSnooze(uid, data) {
  try {
    if (!data || !data.jobIds || data.jobIds.length === 0) {
      localStorage.removeItem(snoozeStorageKey(uid));
    } else {
      localStorage.setItem(snoozeStorageKey(uid), JSON.stringify(data));
    }
  } catch (e) {}
}
// Kode tiket pendek buat ditampilin di toast — biar keliatan "advanced"
// tanpa nampilin id Firestore yang panjang & bikin toast berantakan.
function shortJobCode(id) {
  return (id || "").slice(-6).toUpperCase();
}

function ensurePendingToastWrap() {
  let wrap = document.getElementById("pendingToastWrap");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.id = "pendingToastWrap";
    wrap.className = "pending-toast-wrap";
    document.body.appendChild(wrap);
  }
  return wrap;
}

function showPendingToast(newDocs) {
  if (newDocs.length === 0) return;
  const wrap = ensurePendingToastWrap();
  const toast = document.createElement("div");
  toast.className = "pending-toast";
  const ids = newDocs.map((d) => d.id);
  const title = newDocs.length === 1 ? "Ada pesanan belum diterima!" : `${newDocs.length} pesanan belum diterima!`;

  // Ringkas: cuma tampilin 2 file + ID pendeknya inline dalam satu baris
  // teks (bukan kartu terpisah per file) supaya toast tetap kecil & tidak
  // makan tempat, sesuai versi awal — ID-nya tetap ada, cuma dikemas
  // sebagai chip mono kecil nempel di sebelah nama file.
  const VISIBLE = 2;
  const fileChips = newDocs.slice(0, VISIBLE).map((d) => {
    const fileName = (d.data() && d.data().fileName) || "File tanpa nama";
    return `<span class="pending-toast-filechip">${escapeHtml(fileName)}</span><span class="pending-toast-id">#${shortJobCode(d.id)}</span>`;
  }).join(", ");
  const extraCount = newDocs.length - VISIBLE;
  const extraText = extraCount > 0 ? ` +${extraCount} lainnya` : "";

  toast.innerHTML = `
    ${iconImg("Bell", "", "pending-toast-icon")}
    <div class="pending-toast-body">
      <p class="pending-toast-title">${title}</p>
      <p class="pending-toast-text">${fileChips}${escapeHtml(extraText)} — buruan Terima/Tolak sebelum keburu lama.</p>
      <div class="pending-toast-actions">
        <button type="button" class="btn btn-primary" data-toast-view>Lihat pesanan</button>
        <button type="button" class="btn btn-outline" data-toast-snooze>Ingatkan aku nanti</button>
      </div>
    </div>
    <button type="button" class="pending-toast-close" aria-label="Tutup" data-toast-close>&times;</button>
  `;
  wrap.appendChild(toast);

  const remove = () => {
    if (!toast.isConnected) return;
    toast.classList.add("is-leaving");
    setTimeout(() => toast.remove(), 180);
  };
  toast.querySelector("[data-toast-close]").addEventListener("click", remove);
  toast.querySelector("[data-toast-view]").addEventListener("click", () => {
    // Kalau lagi di printer.html, scroll ke section-nya langsung. Kalau
    // lagi di halaman lain, arahin dulu ke Dashboard Operator.
    const pendingList = document.getElementById("pendingList");
    if (pendingList) {
      pendingList.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      window.location.href = "printer.html";
    }
    remove();
  });
  toast.querySelector("[data-toast-snooze]").addEventListener("click", () => {
    // "Ingatkan aku nanti" BENERAN nunggu, bukan gimmick: progress-nya
    // disimpan di localStorage (navCount mulai dari 0) dan baru dicek
    // lagi setelah operator pindah halaman SNOOZE_NAV_THRESHOLD (5) kali
    // — dihitung tiap initShell jalan di halaman baru, lihat
    // initPendingNotifier(). Timer/setTimeout TIDAK dipakai karena mati
    // begitu halaman di-reload.
    if (notifierUid) {
      saveSnooze(notifierUid, { jobIds: ids, navCount: 0 });
    }
    remove();
  });
  // Toast otomatis nutup abis 9 detik supaya nggak numpuk di layar, TAPI
  // ini cuma nyembunyiin tampilannya doang — id-nya tetap tercatat di
  // seenPendingIds/localStorage, jadi TIDAK dianggap "snooze". Kalau job
  // masih pending pas balik lagi ke halaman ini nanti, toast tidak akan
  // muncul ulang sendiri sampai ada job baru atau snooze-nya kena giliran.
  setTimeout(remove, 9000);
}

// Bandingin daftar id pending sekarang vs yang sudah pernah "seen" — yang
// belum pernah dilihat dikasih tau lewat popup, lalu ditandai seen supaya
// tidak diulang lagi di snapshot berikutnya. seenPendingIds disimpan ke
// localStorage tiap berubah supaya bertahan lintas reload halaman (lihat
// catatan besar di atas initPendingNotifier soal kenapa ini MPA-safe).
// Dipakai KHUSUS buat snapshot PERTAMA tiap halaman dimuat — snapshot
// berikutnya (masih di halaman yang sama) pakai docChanges() langsung
// di initPendingNotifier, bukan fungsi ini (lihat catatan di sana).
function checkNewPending(pendingDocs) {
  lastPendingDocs = pendingDocs;
  const currentIds = new Set(pendingDocs.map((d) => d.id));
  reconcileSnooze(currentIds);
  const newOnes = pendingDocs.filter((d) => !seenPendingIds.has(d.id));
  seenPendingIds = currentIds;
  if (notifierUid) saveSeenIds(notifierUid, seenPendingIds);
  if (newOnes.length > 0) showPendingToast(newOnes);
}

// Job yang sebelumnya di-snooze tapi sudah tidak pending lagi (sudah
// diterima/ditolak/dibatalkan) — bersihkan dari antrian snooze supaya
// tidak nyangkut selamanya nunggu giliran diingatkan lagi.
function reconcileSnooze(currentIds) {
  if (!notifierUid) return;
  const snooze = loadSnooze(notifierUid);
  if (snooze && snooze.jobIds && snooze.jobIds.length > 0) {
    const stillPending = snooze.jobIds.filter((id) => currentIds.has(id));
    if (stillPending.length !== snooze.jobIds.length) {
      saveSnooze(notifierUid, { jobIds: stillPending, navCount: snooze.navCount });
    }
  }
}

// Cuma dipasang buat role "printer"/"developer" (satu-satunya role yang
// bisa punya job dengan printerId == dirinya sendiri — lihat printer.js
// & firestore.rules). pendingNotifierStarted jaga-jaga biar listener-nya
// nggak numpuk kalau initShell kepanggil lebih dari sekali di halaman
// yang sama.
function initPendingNotifier(user, profile) {
  if (pendingNotifierStarted) return;
  if (!user || !profile) return;
  if (profile.role !== "printer" && profile.role !== "developer") return;
  pendingNotifierStarted = true;
  notifierUid = user.uid;

  // Muat status "seen" yang sudah tersimpan dari halaman sebelumnya —
  // supaya job yang sudah pernah ditampilin toast-nya TIDAK muncul lagi
  // cuma gara-gara operator pindah halaman (tiap navigasi = reload
  // penuh, jadi tanpa ini semua job pending bakal keanggap "baru" lagi
  // tiap kali buka halaman lain).
  seenPendingIds = loadSeenIds(user.uid);

  // Hitung progress "Ingatkan aku nanti": TIAP KALI HALAMAN INI DIMUAT
  // dianggap 1x "pindah halaman". Kalau ada snooze aktif, tambah 1 —
  // begitu nyampe SNOOZE_NAV_THRESHOLD, job yang di-snooze dilupakan
  // dari seenPendingIds supaya checkNewPending() nganggep mereka "baru"
  // lagi & toast-nya nongol ulang (kalau masih pending).
  const snooze = loadSnooze(user.uid);
  if (snooze && snooze.jobIds && snooze.jobIds.length > 0) {
    const navCount = (snooze.navCount || 0) + 1;
    if (navCount >= SNOOZE_NAV_THRESHOLD) {
      snooze.jobIds.forEach((id) => seenPendingIds.delete(id));
      saveSeenIds(user.uid, seenPendingIds);
      saveSnooze(user.uid, null);
    } else {
      saveSnooze(user.uid, { jobIds: snooze.jobIds, navCount });
    }
  }

  const q = query(
    collection(db, "printJobs"),
    where("printerId", "==", user.uid),
    where("status", "==", "pending")
  );

  // Popup cuma buat order yang wilayahnya sama dengan wilayah operator ini
  // (order lama tanpa regionKey tetap dianggap cocok). Order beda wilayah
  // dilepas balik ke antrean oleh printer.js, jadi tidak perlu dinotif.
  const myRegionKey = regionKeyFrom(profile.location);
  const inMyRegion = (d) => {
    const k = d.data().regionKey;
    return !k || k === myRegionKey;
  };

  // FIX: sebelumnya toast baru cuma nongol di snapshot PERTAMA tiap
  // halaman dimuat (dibandingin manual ke seenPendingIds) — begitu ada
  // job KEDUA/KETIGA yang jadi pending SEMENTARA operator masih di
  // halaman yang sama (tanpa reload), itu ketutup & nggak kedeteksi.
  // Sekarang snapshot SESUDAH yang pertama pakai snap.docChanges() —
  // ini sumber kebenaran resmi dari Firestore soal dokumen mana yang
  // BENERAN baru nambah ke hasil query dibanding update sebelumnya,
  // jadi file customer lain yang baru pending PASTI kedeteksi sendiri²,
  // nggak peduli ada file lain yang sudah pernah ditampilin duluan.
  let isFirstSnapshot = true;
  onSnapshot(q, (snap) => {
    const regionDocs = snap.docs.filter(inMyRegion);
    if (isFirstSnapshot) {
      isFirstSnapshot = false;
      checkNewPending(regionDocs);
      return;
    }
    lastPendingDocs = regionDocs;
    const currentIds = new Set(regionDocs.map((d) => d.id));
    reconcileSnooze(currentIds);

    const addedDocs = snap.docChanges().filter((c) => c.type === "added").map((c) => c.doc).filter(inMyRegion);
    const removedIds = snap.docChanges().filter((c) => c.type === "removed").map((c) => c.doc.id);
    addedDocs.forEach((d) => seenPendingIds.add(d.id));
    removedIds.forEach((id) => seenPendingIds.delete(id));
    if (notifierUid) saveSeenIds(notifierUid, seenPendingIds);

    if (addedDocs.length > 0) showPendingToast(addedDocs);
  }, (err) => {
    console.error("gagal mantau pesanan masuk buat notif", err);
  });
}

// user: Firebase Auth user object atau null (guest)
// profile: dokumen Firestore /users/{uid} (role, displayName, username, ...) atau null kalau guest
// active: id halaman yang lagi aktif, buat highlight link sidebar
// homeLabel: override teks nav "home" (default "Upload") — dipakai printer.js
// supaya pas operator lagi di Dashboard Operator, tulisan di sidebar
// berubah jadi "Printer" (bukan "Upload") walau link-nya tetap ke home.html.
export function initShell({ user, profile, active, homeLabel }) {
  const sidebar = document.getElementById("sidebar");
  const topbarMini = document.getElementById("topbarMini");
  if (!sidebar || !topbarMini) return;

  renderTopbar(topbarMini);
  const csBtn = document.getElementById("ctcCsBtn");
  if (csBtn) {
    csBtn.addEventListener("click", () => openContactModal(
      profile && (profile.username || profile.displayName),
      profile && profile.contactEmail
    ));
  }

  // ---- guest: belum login sama sekali ----
  if (!user) {
    sidebar.innerHTML = `
      <div class="brand"><span class="dot"></span> D' COPYNPRINT</div>
      <a class="side-link ${active === "home" ? "active" : ""}" href="home.html">
        <span class="side-icon">${iconImg("Upload", "Printer")}</span> Printer
      </a>
      <div class="side-spacer"></div>
      <a class="side-link" href="login.html">
        <span class="side-icon">${iconImg("Login", "Masuk")}</span> Masuk / Daftar
      </a>
    `;
    initMobileDrawer(sidebar);
    return;
  }

  // ---- sudah login ----
  initPendingNotifier(user, profile);

  // Label nav "home" (default "Upload") otomatis berubah jadi "Printer"
  // buat akun berrole "printer" — DI SEMUA HALAMAN, bukan cuma pas lagi
  // buka printer.html. Sebelumnya cuma printer.js yang override manual
  // (homeLabel: "Printer"), jadi di halaman lain (home.html, job.html,
  // dst.) operator print masih lihat tulisan "Upload" di sidebar. Param
  // homeLabel tetap dihormati kalau ada yang mau override manual.
  const effectiveHomeLabel = homeLabel || (profile && profile.role === "printer" ? "Printer" : null);
  const navHtml = NAV_ITEMS.map((it) => {
    const label = (it.id === "home" && effectiveHomeLabel) ? effectiveHomeLabel : it.label;
    return `
    <a class="side-link ${active === it.id ? "active" : ""}" href="${it.href}">
      <span class="side-icon">${iconImg(it.icon, label)}</span> ${label}
    </a>
  `;
  }).join("");

  // Catatan: link "Dashboard Operator" SENGAJA tidak ada lagi di sidebar.
  // Operator print sekarang masuk ke printer.html lewat tombol khusus di
  // halaman Upload (lihat home.html/home.js). Supaya sidebar tidak
  // kelihatan "kosong" tanpa highlight pas lagi di printer.html, halaman
  // itu memanggil initShell({ active: "home" }) — jadi nav "Upload" tetap
  // ke-highlight walau URL-nya sebenarnya /printer.html.
  // Role "developer": tidak ada lagi link Panel Admin di sidebar — akses
  // Kelola User & Printers sekarang lewat bubble menu (lihat initBubbleMenu).

  sidebar.innerHTML = `
    <div class="brand"><span class="dot"></span> D' COPYNPRINT</div>
    ${navHtml}
    <div class="side-spacer"></div>
    <a class="sidebar-user-panel ${active === "profile" ? "active" : ""}" href="profile.html">
      ${avatarHtml(profile, "sm")}
      <div class="sidebar-user-panel-info">
        <div class="sidebar-user-panel-name">${escapeHtml((profile && (profile.displayName || profile.username)) || "user")}</div>
        <div class="sidebar-user-panel-role">${escapeHtml((profile && profile.role) || "customer")}</div>
      </div>
    </a>
  `;

  initBubbleMenu(profile);
  initMobileDrawer(sidebar);
}

// ===================================================================
// Bubble menu mengambang (khusus role "developer") — lingkaran bulat
// di pojok kanan bawah dengan ikon. Diklik -> menu muncul KE ATAS dari
// bubble-nya dengan animasi slide+fade, isinya "Kelola User" & "Printers".
// Idempotent: aman dipanggil berkali-kali (mis. dari initShell tiap
// halaman) — kalau elemennya sudah ada, tidak dibuat ulang.
// ===================================================================
export function initBubbleMenu(profile) {
  const existing = document.getElementById("devBubble");
  if (existing) existing.remove();
  if (!profile || profile.role !== "developer") return;

  const root = document.getElementById("bubbleMenuRoot") || document.body;
  const wrap = document.createElement("div");
  wrap.id = "devBubble";
  wrap.className = "dev-bubble-wrap";
  wrap.innerHTML = `
    <div class="dev-bubble-menu hidden" id="devBubbleMenu">
      <a class="dev-bubble-item" href="users.html">
        <span class="side-icon">${iconImg("Members", "Kelola User")}</span> Kelola User
      </a>
      <a class="dev-bubble-item" href="printers.html">
        <span class="side-icon">${iconImg("Printer", "Printers")}</span> Printers
      </a>
      <a class="dev-bubble-item" href="printer.html">
        <span class="side-icon">${iconImg("Dashboard", "Dashboard Operator")}</span> Dashboard Operator
      </a>
    </div>
    <button type="button" class="dev-bubble-fab" id="devBubbleFab" aria-label="Menu developer">${iconImg("Settings", "Menu", "icon-img icon-lg")}</button>
  `;
  root.appendChild(wrap);

  const fab = wrap.querySelector("#devBubbleFab");
  const menu = wrap.querySelector("#devBubbleMenu");
  fab.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.classList.toggle("hidden");
    fab.classList.toggle("is-open");
  });
  document.addEventListener("click", (e) => {
    if (!wrap.contains(e.target)) {
      menu.classList.add("hidden");
      fab.classList.remove("is-open");
    }
  });
}
