// ===================================================================
// D' CopynPrint — shared auth guard & user profile helpers
// ===================================================================
import { auth, db } from "./firebase-config.js";
import {
  onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  doc, getDoc, setDoc, updateDoc, serverTimestamp, collection, getCountFromServer
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// ===================================================================
// Kode pesanan pendek & acak (Fase E) — dibikin sekali pas file
// diupload (lihat home.js), disimpan di field "code" pada dokumen
// printJobs. Tujuannya: customer & operator bisa saling nyebut/nanya
// soal SATU pesanan pakai kode pendek ini ("pesanan kode CP-A3K9X2"),
// bukan nama file asli yang kadang panjang/bikin bingung (apalagi kalau
// ada beberapa file dengan nama mirip/sama, mis. "WhatsApp Image...jpeg").
// Karakter yang gampang ketuker (O/0, I/1) sengaja dibuang dari alfabet.
// ===================================================================
const JOB_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function generateJobCode() {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += JOB_CODE_CHARS[Math.floor(Math.random() * JOB_CODE_CHARS.length)];
  }
  return `CP-${code}`;
}

// Dipakai di semua tempat yang nampilin/nyebut kode pesanan — fallback
// ke ID dokumen Firestore (dipotong+uppercase) buat job LAMA yang dibuat
// sebelum fitur kode ini ada (belum punya field "code").
export function jobCodeLabel(job, docId) {
  return job && job.code ? job.code : `CP-${(docId || "").slice(0, 6).toUpperCase()}`;
}

// ===================================================================
// Pencocokan WILAYAH customer <-> operator
// Order cuma boleh sampai ke dashboard operator kalau SEMUA tingkat di
// REGION_LEVELS sama persis (setelah dirapikan: huruf kecil, spasi
// dirapikan, awalan "Kecamatan"/"Kelurahan"/"Desa" dibuang, alias
// provinsi disamakan). Kalau mau dilonggarkan (mis. cuma sampai
// kecamatan), cukup kurangi isi REGION_LEVELS di bawah ini — semua
// bagian lain (upload, penugasan, dashboard, firestore.rules lewat
// field regionKey) ikut otomatis, TAPI regionKey user & pesanan lama
// harus dibuat ulang (simpan ulang profil / upload ulang).
// ===================================================================
export const REGION_LEVELS = ["province", "city", "district", "village"];
export const REGION_LABELS = { province: "Provinsi", city: "Kota/Kabupaten", district: "Kecamatan", village: "Kelurahan/Desa" };
const REGION_PREFIXES = {
  district: /^(kecamatan|kec\.?)\s+/,
  village: /^(kelurahan|kel\.?|desa)\s+/
};
const PROVINCE_ALIASES = {
  "daerah khusus ibukota jakarta": "dki jakarta",
  "daerah khusus ibu kota jakarta": "dki jakarta",
  "daerah istimewa yogyakarta": "di yogyakarta"
};
export function normalizeRegionPart(level, value) {
  let s = String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (REGION_PREFIXES[level]) s = s.replace(REGION_PREFIXES[level], "").trim();
  if (level === "province" && PROVINCE_ALIASES[s]) s = PROVINCE_ALIASES[s];
  return s;
}
// "jawa timur|kota malang|klojen|kauman". String kosong = lokasi belum
// lengkap (ada tingkat yang kosong) -> TIDAK BOLEH dicocokkan ke siapa pun.
export function regionKeyFrom(loc) {
  if (!loc) return "";
  const parts = REGION_LEVELS.map((lv) => normalizeRegionPart(lv, loc[lv]));
  return parts.some((p) => !p) ? "" : parts.join("|");
}
// Ringkasan wilayah buat ditampilkan: "Kauman, Klojen, Kota Malang, Jawa Timur"
export function regionLabel(loc) {
  if (!loc) return "";
  return [...REGION_LEVELS].reverse().map((lv) => loc[lv]).filter(Boolean).join(", ");
}
// Cuma ambil field wilayah (tanpa lat/lng) buat disalin ke dokumen pesanan.
export function regionSnapshot(loc) {
  const out = {};
  REGION_LEVELS.forEach((lv) => { out[lv] = (loc && loc[lv]) || ""; });
  return out;
}

// Kode "Web ID" rahasia yang dipakai pas daftar buat langsung dapet role
// tertentu (lihat login.html). Role ini DIPILIH DI SISI CLIENT lalu
// dikirim ke Firestore — siapa pun yang tahu kodenya bisa daftar jadi
// role itu. Ini keputusan yang sudah disadari risikonya oleh developer.
export function roleFromWebID(code) {
  const c = (code || "").trim().toUpperCase();
  if (c === "DP-DEV") return "developer";
  if (c === "DP-PRINTER") return "printer";
  return "customer";
}

// ===================================================================
// Login D' CopynPrint pakai USERNAME + password saja (tanpa email). Firebase
// Auth aslinya cuma bisa email+password, jadi di balik layar kita bikin
// "email palsu" dari username (mis. "budi123" -> "budi123@dcoprint.local").
// Uniqueness username otomatis kejamin dari Firebase Auth sendiri (kalau
// email palsu itu sudah kepakai, createUser bakal error
// auth/email-already-in-use — persis kayak "username sudah dipakai").
// ===================================================================
const USERNAME_DOMAIN = "@dcoprint.local";

export function normalizeUsername(raw) {
  return (raw || "").trim().toLowerCase();
}

// Username: 3-20 karakter, huruf kecil/angka/titik/underscore saja.
export function isValidUsername(u) {
  return /^[a-z0-9_.]{3,20}$/.test(u);
}

export function usernameToEmail(username) {
  return `${username}${USERNAME_DOMAIN}`;
}

// Kebalikan dari usernameToEmail — dipakai buat NAMPILKAN identitas user
// di UI tanpa mengekspos "...@dcoprint.local" yang jelek/membingungkan.
export function usernameLabel(value) {
  if (!value) return value;
  return value.endsWith(USERNAME_DOMAIN) ? value.slice(0, -USERNAME_DOMAIN.length) : value;
}

// Membuat / mengambil dokumen user di koleksi "users".
// roleOverride dipakai cuma saat daftar (signup), berdasarkan kode Web ID
// yang diisi user. Kalau tidak diisi / salah, default-nya tetap "customer".
// usernameOverride dipakai cuma saat daftar, dari input username di form.
// contactEmailOverride dipakai cuma saat daftar, dari input email di form
// signup — ini email BENERAN milik user (buat kontak), BEDA sama field
// "email" yang isinya email palsu "username@dcoprint.local" buat Firebase
// Auth. Login tetap cuma pakai username + password, email TIDAK dipakai
// buat login sama sekali.
export async function ensureUserDoc(user, roleOverride = null, usernameOverride = null, contactEmailOverride = null) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    const role = roleOverride || "customer";
    const username = usernameOverride || usernameLabel(user.email) || user.email.split("@")[0];
    await setDoc(ref, {
      username,
      email: user.email,
      contactEmail: contactEmailOverride || "",
      displayName: username,
      bio: "",
      role,
      online: false,
      banned: false,
      createdAt: serverTimestamp()
    });
    return { username, email: user.email, contactEmail: contactEmailOverride || "", displayName: username, bio: "", role, online: false, banned: false };
  }
  return snap.data();
}

// Hitung jumlah dokumen di sebuah collection/subcollection tanpa perlu
// download semua dokumennya (dipakai buat jumlah follower/following/like).
export async function countDocs(colRef) {
  const snap = await getCountFromServer(colRef);
  return snap.data().count;
}

// Path ke gambar avatar default (ala Discord) — dipakai kalau user belum
// upload foto profil sendiri. File-nya nanti ditaruh di folder
// Resources/Images/. Semua halaman HTML ada di folder HTML/, jadi path
// relatifnya "naik satu folder dulu" (../) baru masuk ke Resources/Images/.
export const DEFAULT_AVATAR_PATH = "../Resources/Images/Default-Avatar.png";

// Render avatar bulat: pakai foto profil (photoURL) kalau ada, kalau tidak
// ada pakai gambar placeholder default di atas — BUKAN inisial huruf lagi.
// profileLike: objek apa saja yang MUNGKIN punya field "photoURL".
// sizeClass (opsional): "lg" buat avatar besar di halaman profil.
export function avatarHtml(profileLike, sizeClass = "") {
  const cls = `avatar-circle ${sizeClass}`.trim();
  const src = (profileLike && profileLike.photoURL) ? profileLike.photoURL : DEFAULT_AVATAR_PATH;
  return `<img src="${src}" class="${cls}" style="object-fit:cover;">`;
}

// ID percakapan DM selalu sama utk sepasang user berapa kalipun dipanggil,
// dibikin dari dua uid yang diurutkan biar konsisten.
export function conversationId(uidA, uidB) {
  return [uidA, uidB].sort().join("_");
}

export { collection };

// Jaga halaman: kalau belum login → lempar ke login.html.
// Kalau sudah login, jalankan callback(user, profile).
// requiredRole (opsional): "customer" | "printer" | "developer",
// atau array kalau lebih dari satu role boleh akses (mis. ["printer","developer"]).
// Kalau role user tidak cocok, lempar ke home.html.
// Kalau akun user di-ban (field "banned" di dokumen Firestore-nya), auto
// logout dan lempar ke login.html dengan pesan kenapa.
export function requireAuth(callback, requiredRole = null) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "login.html";
      return;
    }
    const profile = await ensureUserDoc(user);
    if (profile.banned) {
      await signOut(auth);
      window.location.href = "login.html?banned=1";
      return;
    }
    // Status online sederhana: role "printer" sudah punya toggle manual
    // sendiri (lihat printer.js), jadi tidak disentuh di sini. Role lain
    // otomatis ditandai online selama halaman ini terbuka, dan offline lagi
    // pas ditutup/pindah tab (best-effort — bukan realtime presence beneran,
    // butuh Firebase Realtime Database onDisconnect() untuk itu).
    if (profile.role !== "printer") {
      updateDoc(doc(db, "users", user.uid), { online: true }).catch(() => {});
      window.addEventListener("pagehide", () => {
        updateDoc(doc(db, "users", user.uid), { online: false }).catch(() => {});
      });
    }
    if (requiredRole) {
      const allowed = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
      if (!allowed.includes(profile.role)) {
        window.location.href = "home.html";
        return;
      }
    }
    callback(user, profile);
  });
}

// redirectTo (opsional): halaman tujuan setelah keluar. Default ke
// login.html (mode Masuk) — dipakai tombol "Switch akun". Tombol "Keluar"
// di halaman Profil sengaja kirim "login.html?mode=signup" biar orang
// yang baru keluar diarahkan ke form Daftar, bukan form Masuk (lihat
// js/profile.js#logoutBtn).
export async function logout(redirectTo = "login.html") {
  await signOut(auth);
  window.location.href = redirectTo;
}

// ===================================================================
// "Akun yang diingat" di browser ini — CUMA nyimpen daftar username
// (BUKAN password/token), dipakai buat nentuin kapan tombol "Switch akun"
// di halaman Profil perlu ditampilkan: kalau di browser/perangkat ini
// pernah login/daftar LEBIH DARI 1 akun, tombolnya muncul; kalau cuma 1
// akun yang pernah dipakai di sini, tombolnya disembunyikan (cuma tombol
// Keluar yang tampil) karena "ganti akun" nggak ada gunanya.
// ===================================================================
const KNOWN_ACCOUNTS_KEY = "pf_known_accounts";

export function rememberAccount(username) {
  if (!username) return;
  try {
    const list = getKnownAccounts();
    if (!list.includes(username)) {
      list.push(username);
      localStorage.setItem(KNOWN_ACCOUNTS_KEY, JSON.stringify(list));
    }
  } catch (e) {
    // localStorage penuh/diblokir browser — diamkan, ini cuma fitur kosmetik.
  }
}

export function getKnownAccounts() {
  try {
    const raw = localStorage.getItem(KNOWN_ACCOUNTS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

export function fmtDate(ts) {
  if (!ts) return "-";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

// Format angka jadi "Rp 15.000" — dipakai buat harga job print & pendapatan.
export function fmtRupiah(n) {
  const num = Number(n) || 0;
  return "Rp " + num.toLocaleString("id-ID");
}

// Format ukuran file dari bytes jadi "245 KB" / "1.2 MB" — dipakai di
// halaman detail pesanan print (job.html).
export function fmtFileSize(bytes) {
  const n = Number(bytes);
  if (!n || n <= 0) return "-";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// Ubah URL file Cloudinary jadi URL "paksa download" (bukan cuma dibuka
// di tab baru) pakai flag transformasi fl_attachment — Cloudinary yang
// nge-set header Content-Disposition: attachment di responnya, jadi
// browser otomatis download filenya, TANPA perlu atribut HTML `download`
// (yang gak reliable buat URL beda origin kayak Cloudinary). Nama file
// hasil download juga di-set balik ke nama asli file yang diupload
// (fileName), bukan random public_id bawaan Cloudinary.
export function downloadUrl(fileURL, fileName) {
  if (!fileURL) return "#";
  if (!fileURL.includes("/upload/")) return fileURL;
  const dotIdx = (fileName || "").lastIndexOf(".");
  const base = dotIdx > 0 ? fileName.slice(0, dotIdx) : (fileName || "file");
  // fl_attachment:<nama> tidak boleh ada karakter aneh/slash, jadi
  // dibersihkan dulu.
  const safeName = base.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 100) || "file";
  return fileURL.replace("/upload/", `/upload/fl_attachment:${safeName}/`);
}

// ===================================================================
// Semua emoji di UI diganti gambar (Fase D) — helper ini yang bikin
// <img>-nya, biar konsisten satu tempat. File-nya ditaruh di
// Resources/Icons/{name}.png. Semua halaman HTML ada di folder HTML/,
// jadi path relatifnya "naik satu folder dulu" (../) baru masuk ke
// Resources/Icons/ — SAMA kayak DEFAULT_AVATAR_PATH di atas.
// Daftar lengkap nama file yang harus disiapkan ada di README.md.
// ===================================================================
export function iconImg(name, alt = "", cls = "icon-img") {
  return `<img src="../Resources/Icons/${name}.png" alt="${alt}" class="${cls}">`;
}

// ===================================================================
// Pesan error Firestore yang lebih jelas buat ditampilkan di UI —
// membedakan "permission-denied" (firestore.rules belum dipublish/salah)
// dari "failed-precondition" (index composite di firestore.indexes.json
// belum dipublish — biasanya query yang gabung where()+orderBy() field
// berbeda butuh ini). Dua-duanya sering ketuker jadi "izin ditolak" doang,
// padahal solusinya beda: rules vs indexes.
//
// Kalau errornya soal index, Firebase SDK SENDIRI biasanya sudah nyelipin
// link siap-pakai ke Firebase Console (dalam err.message) buat langsung
// bikin index yang kurang itu — nggak perlu install/pakai Firebase CLI
// sama sekali. Fungsi ini nyari link itu dan nampilinnya sebagai tombol
// klik langsung di UI, bukan cuma nyuruh buka Console manual.
// ===================================================================
export function describeFirestoreError(err, whatFailed = "memuat data") {
  const code = err && err.code;
  const message = (err && err.message) || "";
  const linkMatch = message.match(/https:\/\/console\.firebase\.google\.com\/\S+/);

  if (linkMatch) {
    // Buang tanda kutip/kurung tutup yang kadang nempel di ujung link
    // hasil regex (Firebase suka nutup kalimat pesan errornya pakai itu).
    const link = linkMatch[0].replace(/[)."']+$/, "");
    return `Gagal ${whatFailed}: butuh Firestore index composite yang belum dibuat — ` +
      `<a href="${link}" target="_blank" rel="noopener" style="font-weight:600;text-decoration:underline;">klik di sini buat langsung bikin index-nya di Firebase Console</a>, ` +
      `tunggu status-nya jadi "Enabled" (biasanya 1-2 menit), lalu refresh halaman ini.`;
  }

  let hint;
  if (code === "failed-precondition" || /index/i.test(message)) {
    hint = `butuh Firestore index composite yang belum dibuat/dipublish — jalankan "firebase deploy --only firestore:indexes" (isinya sudah ada di firestore.indexes.json), atau buka Console browser (F12) buat cari link "create it here" di pesan error aslinya`;
  } else if (code === "permission-denied") {
    hint = `firestore.rules di project Firebase kamu belum dipublish ulang (atau kamu login dengan role yang tidak diizinkan) — jalankan "firebase deploy --only firestore:rules"`;
  } else {
    hint = `error tak terduga (${code || "tanpa kode"}) — buka Console browser (F12) buat detail lengkapnya`;
  }
  return `Gagal ${whatFailed}: ${hint}.`;
}

// ===================================================================
// Modal "alasan" — dipakai bareng buat 2 tempat: customer Batal pesanan
// (home.js/job.js) & operator Tolak pesanan (printer.js). Dropdown isi
// alasan siap-pakai (beda-beda per pemanggil, dikirim lewat parameter
// "reasons") + satu opsi "Alasan lain (tulis sendiri)" yang munculin
// textarea custom. Modal-nya dibikin SEKALI, ditempel ke <body>, dipakai
// ulang tiap openReasonPrompt() dipanggil (idempotent, style modal reuse
// pattern yang sama kayak modal Kontak CS di shell.js).
// ===================================================================
const REASON_CUSTOM_VALUE = "__custom__";

function ensureReasonModal() {
  let modal = document.getElementById("reasonPromptModal");
  if (modal) return modal;
  modal = document.createElement("div");
  modal.className = "modal-backdrop hidden";
  modal.id = "reasonPromptModal";
  modal.innerHTML = `
    <div class="modal-box" style="max-width:400px;">
      <h3 id="reasonPromptTitle">Alasan</h3>
      <p class="sub" id="reasonPromptSubtitle" style="margin-bottom:14px;"></p>
      <label for="reasonPromptSelect">Pilih alasan</label>
      <select id="reasonPromptSelect"></select>
      <div id="reasonPromptCustomWrap" style="margin-top:10px;">
        <label for="reasonPromptCustom">Tulis alasan kamu</label>
        <textarea id="reasonPromptCustom" rows="3" placeholder="Tulis alasannya di sini..." style="width:100%;font-family:var(--sans);padding:8px 10px;border-radius:6px;border:1px solid var(--line);"></textarea>
      </div>
      <div class="error-msg" id="reasonPromptErr"></div>
      <div class="modal-actions" style="margin-top:16px;">
        <button class="btn btn-outline" id="reasonPromptCancel" type="button">Batal</button>
        <button class="btn btn-primary" id="reasonPromptConfirm" type="button">Lanjutkan</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  return modal;
}

function escapeHtmlForReason(s) {
  const d = document.createElement("div");
  d.textContent = s || "";
  return d.innerHTML;
}

// title/subtitle: teks di kepala modal. reasons: array string alasan
// siap-pilih. confirmLabel: teks tombol konfirmasi (mis. "Batalkan
// pesanan" / "Tolak pesanan"). onConfirm(reason): dipanggil dengan
// alasan terpilih (string, dari dropdown ATAU dari textarea custom kalau
// yang dipilih "Alasan lain") — kalau onConfirm melempar error, modal
// TETAP kebuka (biar user bisa coba lagi / pesan error-nya keliatan
// lewat alert dari pemanggil), tombol Lanjutkan-nya di-re-enable lagi.
export function openReasonPrompt({ title = "Alasan", subtitle = "", reasons = [], confirmLabel = "Lanjutkan", onConfirm }) {
  const modal = ensureReasonModal();
  const titleEl = document.getElementById("reasonPromptTitle");
  const subEl = document.getElementById("reasonPromptSubtitle");
  const select = document.getElementById("reasonPromptSelect");
  const customWrap = document.getElementById("reasonPromptCustomWrap");
  const customInput = document.getElementById("reasonPromptCustom");
  const errEl = document.getElementById("reasonPromptErr");
  const cancelBtn = document.getElementById("reasonPromptCancel");
  const confirmBtn = document.getElementById("reasonPromptConfirm");

  titleEl.textContent = title;
  subEl.textContent = subtitle;
  subEl.style.display = subtitle ? "" : "none";
  errEl.textContent = "";
  customInput.value = "";
  select.innerHTML = [
    `<option value="" disabled selected>— pilih alasan —</option>`,
    ...reasons.map((r) => `<option value="${escapeHtmlForReason(r)}">${escapeHtmlForReason(r)}</option>`),
    `<option value="${REASON_CUSTOM_VALUE}">Alasan lain (tulis sendiri)</option>`
  ].join("");
  customWrap.style.display = "none";

  const syncCustomVisibility = () => {
    customWrap.style.display = select.value === REASON_CUSTOM_VALUE ? "" : "none";
  };
  select.onchange = syncCustomVisibility;

  confirmBtn.textContent = confirmLabel;
  confirmBtn.disabled = false;

  const close = () => modal.classList.add("hidden");
  cancelBtn.onclick = close;
  modal.onclick = (e) => { if (e.target === modal) close(); };

  confirmBtn.onclick = async () => {
    errEl.textContent = "";
    if (!select.value) {
      errEl.textContent = "Pilih salah satu alasan dulu.";
      return;
    }
    let reason = select.value;
    if (reason === REASON_CUSTOM_VALUE) {
      reason = customInput.value.trim();
      if (!reason) {
        errEl.textContent = "Tulis alasannya dulu.";
        return;
      }
    }
    confirmBtn.disabled = true;
    try {
      await onConfirm(reason);
      close();
    } catch (e) {
      // Pemanggil (home.js/job.js/printer.js) yang tanggung jawab
      // nampilin alert error-nya — di sini cuma re-enable tombolnya lagi
      // supaya user bisa coba ulang tanpa nutup-buka modal dari awal.
    } finally {
      confirmBtn.disabled = false;
    }
  };

  modal.classList.remove("hidden");
}
