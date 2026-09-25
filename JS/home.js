import { db, auth } from "./firebase-config.js";
import { fmtDate, fmtRupiah, fmtFileSize, ensureUserDoc, usernameLabel, describeFirestoreError, generateJobCode, jobCodeLabel, openReasonPrompt, iconImg, regionKeyFrom, regionLabel, regionSnapshot } from "./app.js";

import { initShell } from "./shell.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  collection, addDoc, query, where, getDocs, onSnapshot,
  orderBy, serverTimestamp, doc, updateDoc
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { CLOUDINARY_CLOUD_NAME, CLOUDINARY_UPLOAD_PRESET } from "./cloudinary-config.js";

// Upload file ke Cloudinary (unsigned preset) lewat XHR supaya progress
// bar tetap jalan. Return-nya URL publik file yang bisa dibuka operator.
function uploadToCloudinary(file, onProgress) {
  return new Promise((resolve, reject) => {
    const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`;
    const form = new FormData();
    form.append("file", file);
    form.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) onProgress((e.loaded / e.total) * 100);
    });
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const data = JSON.parse(xhr.responseText);
        resolve(data.secure_url);
      } else {
        reject(new Error("Cloudinary upload gagal: " + xhr.status));
      }
    };
    xhr.onerror = () => reject(new Error("Koneksi upload gagal"));
    xhr.send(form);
  });
}

const uploadMainBtn = document.getElementById("uploadMainBtn");
const caretBtn = document.getElementById("caretBtn");
const filetypeMenu = document.getElementById("filetypeMenu");
const fileInput = document.getElementById("fileInput");
const helperText = document.getElementById("helperText");
const errMsg = document.getElementById("errMsg");
const progressTrack = document.getElementById("progressTrack");
const progressFill = document.getElementById("progressFill");
const jobList = document.getElementById("jobList");
const printerCtaCard = document.getElementById("printerCtaCard");
const paperSizeWrap = document.getElementById("paperSizeWrap");
const paperSizeSelect = document.getElementById("paperSizeSelect");
const paperSizeCustomInput = document.getElementById("paperSizeCustomInput");
const paperSizeManageBtn = document.getElementById("paperSizeManageBtn");
const paperSizeModal = document.getElementById("paperSizeModal");
const paperSizeManageList = document.getElementById("paperSizeManageList");
const paperSizeNewInput = document.getElementById("paperSizeNewInput");
const paperSizeAddBtn = document.getElementById("paperSizeAddBtn");
const paperSizeManageErr = document.getElementById("paperSizeManageErr");
const paperSizeManageClose = document.getElementById("paperSizeManageClose");
const typeWarnModal = document.getElementById("typeWarnModal");
const typeWarnCancel = document.getElementById("typeWarnCancel");
const typeWarnPick = document.getElementById("typeWarnPick");

let currentAccept = null;
let currentUser = null;
let currentProfile = null;
let unsubscribeJobs = null;
let isDeveloper = false;

// ---------------------------------------------------------------------
// Kelola daftar pilihan "Ukuran kertas" — bisa ditambah, diubah nama,
// dan dihapus lewat tombol gigi di sebelah dropdown. Opsi "Custom…"
// SENGAJA tidak masuk daftar ini (dia opsi tetap, bukan bagian dari
// daftar yang dikelola) supaya selalu ada jalan buat customer nulis
// ukuran bebas walau semua pilihan siap-pakai dihapus. Disimpan di
// localStorage — per-browser, tidak disinkronkan ke Firestore.
// ---------------------------------------------------------------------
const PAPER_SIZE_STORAGE_KEY = "dcp_paperSizes";
const DEFAULT_PAPER_SIZES = ["A4", "A5", "A3", "F4 / Legal", "Letter"];

function loadPaperSizes() {
  try {
    const raw = localStorage.getItem(PAPER_SIZE_STORAGE_KEY);
    if (!raw) return DEFAULT_PAPER_SIZES.slice();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((v) => typeof v === "string")) return parsed;
    return DEFAULT_PAPER_SIZES.slice();
  } catch (e) {
    return DEFAULT_PAPER_SIZES.slice();
  }
}
function savePaperSizes() {
  localStorage.setItem(PAPER_SIZE_STORAGE_KEY, JSON.stringify(paperSizes));
}
let paperSizes = loadPaperSizes();

// Bangun ulang <option> di dropdown dari array paperSizes + opsi "Custom…"
// yang selalu ditaruh terakhir dan tidak pernah ikut dihapus/diubah.
// preferValue: value yang mau dipertahankan terpilih kalau masih ada
// setelah dibangun ulang (dipakai pas nambah/ubah/hapus daftar).
function renderPaperSizeSelect(preferValue) {
  const wanted = preferValue !== undefined ? preferValue : paperSizeSelect.value;
  paperSizeSelect.innerHTML = [
    ...paperSizes.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`),
    `<option value="custom">Custom…</option>`
  ].join("");
  const stillExists = Array.from(paperSizeSelect.options).some((o) => o.value === wanted);
  paperSizeSelect.value = stillExists ? wanted : (paperSizes[0] || "custom");
  paperSizeCustomInput.classList.toggle("hidden", paperSizeSelect.value !== "custom");
}
renderPaperSizeSelect(paperSizes[0] || "custom");

// --- dropdown ukuran kertas: munculin kolom isian sendiri kalau "Custom" ---
paperSizeSelect.addEventListener("change", () => {
  paperSizeCustomInput.classList.toggle("hidden", paperSizeSelect.value !== "custom");
  if (paperSizeSelect.value === "custom") paperSizeCustomInput.focus();
});

// Baca ukuran kertas yang lagi dipilih di dropdown — dipanggil pas file
// mau diupload (lihat uploadFile di bawah), bukan disimpan lebih awal,
// supaya selalu ambil pilihan TERBARU tepat sebelum upload jalan.
function currentPaperSize() {
  if (paperSizeSelect.value === "custom") {
    return paperSizeCustomInput.value.trim() || "Custom";
  }
  return paperSizeSelect.value;
}

// ---- modal "Kelola pilihan ukuran kertas" (tambah / ubah / hapus) ----
function renderPaperSizeManageList() {
  paperSizeManageErr.textContent = "";
  const rows = paperSizes.map((s, i) => `
    <div class="job-row">
      <div class="job-name">${escapeHtml(s)}</div>
      <div style="display:flex;align-items:center;gap:8px;">
        <button type="button" class="btn btn-outline btn-icon btn-icon-sm" data-edit="${i}" title="Ubah" aria-label="Ubah">${iconImg("Edit-Dark", "Ubah")}</button>
        <button type="button" class="btn btn-outline btn-icon btn-icon-sm" data-delete="${i}" title="Hapus" aria-label="Hapus">${iconImg("Trash-Dark", "Hapus")}</button>
      </div>
    </div>`).join("");
  // Baris "Custom…" ditampilkan biar kelihatan di daftar, tapi terkunci
  // (tanpa tombol Ubah/Hapus) — sesuai permintaan: opsi ini tidak boleh
  // diedit atau dihapus siapa pun.
  const lockedRow = `
    <div class="job-row">
      <div class="job-name">Custom…</div>
      <div class="job-meta">Terkunci — tidak bisa diubah/dihapus</div>
    </div>`;
  paperSizeManageList.innerHTML = rows + lockedRow;

  paperSizeManageList.querySelectorAll("button[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.edit);
      const oldVal = paperSizes[idx];
      const next = window.prompt("Ubah nama ukuran kertas:", oldVal);
      if (next === null) return; // batal
      const trimmed = next.trim();
      if (!trimmed) { paperSizeManageErr.textContent = "Nama ukuran tidak boleh kosong."; return; }
      if (trimmed.toLowerCase() === "custom" || trimmed.toLowerCase() === "custom…") {
        paperSizeManageErr.textContent = "Nama itu dipakai buat opsi Custom… bawaan, pakai nama lain ya.";
        return;
      }
      if (paperSizes.some((s, j) => j !== idx && s.toLowerCase() === trimmed.toLowerCase())) {
        paperSizeManageErr.textContent = "Sudah ada ukuran dengan nama itu.";
        return;
      }
      const wasSelected = paperSizeSelect.value === oldVal;
      paperSizes[idx] = trimmed;
      savePaperSizes();
      renderPaperSizeManageList();
      renderPaperSizeSelect(wasSelected ? trimmed : undefined);
    });
  });
  paperSizeManageList.querySelectorAll("button[data-delete]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.delete);
      const val = paperSizes[idx];
      if (!confirm(`Hapus pilihan ukuran "${val}"?`)) return;
      paperSizes.splice(idx, 1);
      savePaperSizes();
      renderPaperSizeManageList();
      renderPaperSizeSelect();
    });
  });
}

paperSizeManageBtn.addEventListener("click", () => {
  if (!isDeveloper) return; // jaga-jaga kalau tombolnya dipaksa ditampilkan lewat devtools
  renderPaperSizeManageList();
  paperSizeModal.classList.remove("hidden");
});
paperSizeAddBtn.addEventListener("click", () => {
  const val = paperSizeNewInput.value.trim();
  if (!val) { paperSizeManageErr.textContent = "Isi nama ukuran dulu."; return; }
  if (val.toLowerCase() === "custom" || val.toLowerCase() === "custom…") {
    paperSizeManageErr.textContent = "Nama itu dipakai buat opsi Custom… bawaan, pakai nama lain ya.";
    return;
  }
  if (paperSizes.some((s) => s.toLowerCase() === val.toLowerCase())) {
    paperSizeManageErr.textContent = "Sudah ada ukuran dengan nama itu.";
    return;
  }
  paperSizes.push(val);
  savePaperSizes();
  paperSizeNewInput.value = "";
  renderPaperSizeManageList();
  renderPaperSizeSelect(val);
});
paperSizeNewInput.addEventListener("keydown", (e) => { if (e.key === "Enter") paperSizeAddBtn.click(); });
paperSizeManageClose.addEventListener("click", () => paperSizeModal.classList.add("hidden"));
paperSizeModal.addEventListener("click", (e) => { if (e.target === paperSizeModal) paperSizeModal.classList.add("hidden"); });

// --- dropdown: panah menampilkan 3 opsi tipe file ---
caretBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  if (!currentUser) {
    window.location.href = "login.html";
    return;
  }
  filetypeMenu.classList.toggle("open");
});
document.addEventListener("click", () => filetypeMenu.classList.remove("open"));

filetypeMenu.querySelectorAll("button[data-accept]").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    currentAccept = btn.dataset.accept;
    fileInput.setAttribute("accept", currentAccept);
    helperText.textContent = `Tipe dipilih: ${btn.textContent.trim()}. Klik tombol upload untuk buka file explorer.`;
    filetypeMenu.classList.remove("open");
    // Kolom "Ukuran kertas" sengaja disembunyikan sampai tipe file dipilih
    // dulu — baru relevan buat diisi kalau sudah jelas mau upload apa.
    paperSizeWrap.classList.remove("hidden");
  });
});

// Tombol utama:
// - Belum login sama sekali -> langsung lempar ke halaman login/daftar.
// - Sudah login tapi belum pilih tipe file -> munculkan popup peringatan
//   (bukan langsung buka dropdown), user pilih Batal atau Pilih Tipe.
// - Sudah login & sudah pilih tipe -> langsung buka file explorer.
uploadMainBtn.addEventListener("click", () => {
  if (!currentUser) {
    window.location.href = "login.html";
    return;
  }
  if (!customerRegionKey()) {
    errMsg.textContent = REGION_INCOMPLETE_MSG;
    return;
  }
  errMsg.textContent = "";
  if (!currentAccept) {
    typeWarnModal.classList.remove("hidden");
    return;
  }
  fileInput.click();
});

typeWarnCancel.addEventListener("click", () => {
  typeWarnModal.classList.add("hidden");
});
typeWarnPick.addEventListener("click", () => {
  typeWarnModal.classList.add("hidden");
  filetypeMenu.classList.add("open");
});
typeWarnModal.addEventListener("click", (e) => {
  if (e.target === typeWarnModal) typeWarnModal.classList.add("hidden");
});

fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  if (!file) return;
  errMsg.textContent = "";
  await uploadFile(file);
  fileInput.value = "";
});

// Wilayah customer (Provinsi + Kota/Kab + Kecamatan + Kelurahan/Desa) harus
// lengkap dulu — order cuma bisa sampai ke operator yang wilayahnya sama
// persis, jadi tanpa wilayah lengkap pesanan tidak akan pernah kelihatan
// di dashboard operator mana pun.
const REGION_INCOMPLETE_MSG = "Lengkapi dulu lokasi kamu (Provinsi, Kota/Kabupaten, Kecamatan, Kelurahan/Desa) di menu Profil → Edit profil. Pesanan cuma dikirim ke operator yang wilayahnya sama denganmu.";
function customerRegionKey() {
  return regionKeyFrom(currentProfile && currentProfile.location);
}

// Cari operator print yang sedang online DAN wilayahnya sama persis dengan
// customer (field regionKey), pilih salah satu secara acak (load balancing
// sederhana). Kalau tidak ada yang online di wilayah itu, job disimpan
// dengan status "waiting" dan akan diambil otomatis oleh operator
// pertama di wilayah yang sama yang online (lihat js/printer.js).
async function pickOnlinePrinter(regionKey) {
  const q = query(
    collection(db, "users"),
    where("role", "==", "printer"),
    where("online", "==", true),
    where("regionKey", "==", regionKey)
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const printers = snap.docs;
  const chosen = printers[Math.floor(Math.random() * printers.length)];
  return { id: chosen.id, ...chosen.data() };
}

async function uploadFile(file) {
  const regionKey = customerRegionKey();
  if (!regionKey) {
    errMsg.textContent = REGION_INCOMPLETE_MSG;
    return;
  }
  uploadMainBtn.disabled = true;
  progressTrack.classList.remove("hidden");
  progressFill.style.width = "0%";

  try {
    const fileURL = await uploadToCloudinary(file, (pct) => {
      progressFill.style.width = pct + "%";
    });
    const printer = await pickOnlinePrinter(regionKey);
    const jobCode = generateJobCode();

    // Fase C: job yang langsung ketemu operator online TIDAK langsung
    // "queued" — statusnya "pending" dulu, nunggu operator itu Terima
    // (baru masuk antrean beneran, sambil isi harga) atau Tolak (balik
    // "waiting" biar diambil operator lain). Kalau tidak ada operator
    // online sama sekali, tetap "waiting" seperti sebelumnya.
    await addDoc(collection(db, "printJobs"), {
      customerId: currentUser.uid,
      customerEmail: currentUser.email,
      customerWaNumber: (currentProfile && currentProfile.waNumber) || null,
      // Wilayah customer saat memesan (disalin, tanpa koordinat). regionKey
      // dipakai buat mencocokkan operator; customerLocation buat ditampilkan.
      regionKey,
      customerLocation: regionSnapshot(currentProfile.location),
      printerId: printer ? printer.id : null,
      printerEmail: printer ? printer.email : null,
      code: jobCode,
      fileName: file.name,
      fileURL,
      fileType: currentAccept,
      fileSize: file.size,
      paperSize: currentPaperSize(),
      price: null,
      status: printer ? "pending" : "waiting",
      createdAt: serverTimestamp()
    });

    helperText.innerHTML = (printer
      ? `Terkirim ke operator online (${escapeHtml(usernameLabel(printer.email))}) — menunggu dia konfirmasi terima pesanan.`
      : `Belum ada operator online di wilayahmu (${escapeHtml(regionLabel(currentProfile.location))}) — file akan diambil otomatis begitu ada operator di wilayah yang sama yang online.`)
      + ` Kode pesanan kamu: <strong class="job-code">#${escapeHtml(jobCode)}</strong> — simpan/sebutkan kode ini kalau mau tanya ke operator, biar gampang & nggak salah pesanan.`
      + " Pilih tipe file lagi lewat panah buat upload berikutnya.";
  } catch (e) {
    console.error(e);
    errMsg.textContent = "Upload gagal, coba lagi.";
  } finally {
    // Paksa pilih tipe file lagi tiap mau upload baru (nggak boleh asal
    // pencet tombol utama pakai tipe yang lama tanpa sadar).
    currentAccept = null;
    fileInput.removeAttribute("accept");
    uploadMainBtn.disabled = false;
    progressTrack.classList.add("hidden");
    // Sembunyikan lagi kolom "Ukuran kertas" sampai tipe file dipilih
    // ulang buat upload berikutnya, dan balikin dropdown-nya ke default.
    paperSizeWrap.classList.add("hidden");
    renderPaperSizeSelect(paperSizes[0] || "custom");
    paperSizeCustomInput.classList.add("hidden");
    paperSizeCustomInput.value = "";
  }
}

function stampClass(status) {
  return { queued: "stamp-queued", printing: "stamp-printing", done: "stamp-done", waiting: "stamp-waiting", pending: "stamp-waiting", cancelled: "stamp-cancelled", rejected: "stamp-cancelled" }[status] || "stamp-queued";
}
function stampLabel(status) {
  return { queued: "Antre", printing: "Diprint", done: "Selesai", waiting: "Menunggu operator", pending: "Menunggu konfirmasi operator", cancelled: "Dibatalkan", rejected: "Ditolak semua operator" }[status] || status;
}

function renderJobs(docs) {
  if (docs.length === 0) {
    jobList.innerHTML = `<div class="empty-state">Belum ada file yang diupload.</div>`;
    return;
  }
  // "Batal" cuma boleh selama pesanan BELUM diterima resmi sama operator
  // (masih "waiting" — belum ketemu operator online, atau "pending" —
  // sudah ditugaskan tapi operatornya belum klik Terima). Begitu sudah
  // "queued"/"printing"/"done" tidak bisa dibatalkan sendiri lewat sini
  // lagi (lihat firestore.rules — di level database juga dikunci sama).
  const cancellable = (status) => status === "waiting" || status === "pending";
  jobList.innerHTML = docs.map((d) => {
    const j = d.data();
    return `
      <div class="job-row">
        <div>
          <div class="job-name">${escapeHtml(j.fileName)}</div>
          <div class="job-meta"><span class="job-code">#${escapeHtml(jobCodeLabel(j, d.id))}</span> · ${fmtDate(j.createdAt)} · ${fmtFileSize(j.fileSize)}${j.price ? " · " + fmtRupiah(j.price) : ""}</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <span class="stamp-badge ${stampClass(j.status)}">${stampLabel(j.status)}</span>
          <a class="btn btn-outline btn-sm" href="job.html?id=${d.id}">Detail Info</a>
          ${cancellable(j.status) ? `<button type="button" class="btn btn-outline btn-icon btn-icon-sm job-cancel-btn" data-cancel="${d.id}" title="Batal" aria-label="Batal">${iconImg("Reject", "Batal")}</button>` : ""}
        </div>
      </div>`;
  }).join("");

  jobList.querySelectorAll("button[data-cancel]").forEach((btn) => {
    btn.addEventListener("click", () => {
      openReasonPrompt({
        title: "Batalkan pesanan?",
        subtitle: "File tidak akan diproses lagi. Kasih tau alasannya ya.",
        reasons: [
          "Salah upload file",
          "Gak jadi print",
          "Ketemu operator/toko lain",
          "Kelamaan nunggu operator",
          "Harga kemahalan"
        ],
        confirmLabel: "Batalkan pesanan",
        onConfirm: async (reason) => {
          btn.disabled = true;
          try {
            await updateDoc(doc(db, "printJobs", btn.dataset.cancel), { status: "cancelled", cancelReason: reason });
          } catch (e) {
            console.error(e);
            // Kasus paling umum: pesanan ini sudah keburu diterima operator
            // (status sudah pindah dari waiting/pending ke queued) tepat
            // sebelum klik Batal diproses — firestore.rules memang sengaja
            // menolak customer membatalkan pesanan yang sudah "queued".
            const extra = (e && e.code === "permission-denied")
              ? " Kemungkinan besar pesanan ini sudah diterima operator (statusnya sudah bukan \"Menunggu operator\" lagi) sesaat sebelum kamu klik Batal — refresh halaman untuk lihat status terbarunya."
              : "";
            alert(describeFirestoreError(e, "membatalkan pesanan") + extra);
            btn.disabled = false;
            throw e; // biar modal alasan tetap kebuka & tombolnya re-enable
          }
        }
      });
    });
  });
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s || "";
  return d.innerHTML;
}

function renderGuestState() {
  initShell({ user: null, profile: null, active: "home" });
  helperText.textContent = "Klik tombol upload untuk masuk/daftar dulu, lalu pilih tipe filenya.";
  jobList.innerHTML = `<div class="empty-state">Masuk dulu untuk lihat riwayat print kamu.</div>`;
  isDeveloper = false;
  paperSizeManageBtn.classList.add("hidden");
}

function renderLoggedInState(user, profile) {
  initShell({ user, profile, active: "home" });
  helperText.textContent = "Pilih tipe file dulu lewat panah di samping tombol.";
  // Kalau role-nya "printer", kasih tombol menu tambahan ke Dashboard
  // Operator langsung di halaman Upload ini (bukan cuma link di sidebar) —
  // soalnya halaman Upload memang ditujukan buat customer, jadi operator
  // yang nyasar ke sini butuh jalan pintas balik ke dashboard-nya sendiri.
  printerCtaCard.classList.toggle("hidden", !(profile && profile.role === "printer"));
  // Tombol "Kelola pilihan ukuran" (tambah/ubah/hapus opsi di dropdown)
  // KHUSUS role "developer" — customer/printer biasa cuma boleh PILIH
  // dari dropdown, bukan ubah daftarnya.
  isDeveloper = !!(profile && profile.role === "developer");
  paperSizeManageBtn.classList.toggle("hidden", !isDeveloper);
}

onAuthStateChanged(auth, async (user) => {
  if (unsubscribeJobs) { unsubscribeJobs(); unsubscribeJobs = null; }
  currentUser = user;

  if (!user) {
    renderGuestState();
    return;
  }

  const profile = await ensureUserDoc(user);
  currentProfile = profile;
  renderLoggedInState(user, profile);

  const q = query(
    collection(db, "printJobs"),
    where("customerId", "==", user.uid),
    orderBy("createdAt", "desc")
  );
  unsubscribeJobs = onSnapshot(q, (snap) => renderJobs(snap.docs), (err) => {
    console.error(err);
    jobList.innerHTML = `<div class="empty-state">${describeFirestoreError(err, "memuat riwayat print")}</div>`;
  });
});
