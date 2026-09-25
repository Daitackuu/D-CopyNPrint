import { db } from "./firebase-config.js";
import { requireAuth, fmtDate, fmtRupiah, fmtFileSize, describeFirestoreError, downloadUrl, iconImg, jobCodeLabel, openReasonPrompt, regionKeyFrom, regionLabel } from "./app.js";
import { initShell } from "./shell.js";
import { waLinkTo } from "./support-config.js";
import {
  collection, query, where, onSnapshot, orderBy, doc, updateDoc,
  runTransaction, limit, getDocs, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const onlineToggle = document.getElementById("onlineToggle");
const statusText = document.getElementById("statusText");
const earningsTotal = document.getElementById("earningsTotal");
const pendingList = document.getElementById("pendingList");
const jobList = document.getElementById("jobList");

const priceModal = document.getElementById("priceModal");
const priceModalFileName = document.getElementById("priceModalFileName");
const priceInput = document.getElementById("priceInput");
const priceErr = document.getElementById("priceErr");
const priceCancelBtn = document.getElementById("priceCancelBtn");
const priceConfirmBtn = document.getElementById("priceConfirmBtn");

let currentUser = null;
let currentProfile = null;
let jobForPricing = null; // {id, data}

// Kunci wilayah operator (Provinsi|Kota/Kab|Kecamatan|Kelurahan/Desa yang
// sudah dinormalisasi). Kosong = lokasi profil belum lengkap -> tidak ada
// pesanan yang bisa masuk ke sini.
function myRegionKey() {
  return regionKeyFrom(currentProfile && currentProfile.location);
}
const REGION_MISSING_TEXT = "Lokasi profilmu belum lengkap (Provinsi, Kota/Kabupaten, Kecamatan, Kelurahan/Desa) — pesanan TIDAK akan masuk sebelum dilengkapi di Profil → Edit profil.";

// Ambil job-job yang belum kebagian operator (dibuat saat tidak ada
// operator online di wilayah itu) dan "klaim" satu per satu pakai transaction
// supaya tidak diambil dua operator sekaligus. HANYA job dengan regionKey
// yang sama dengan wilayah operator ini yang diambil. Job yang berhasil
// diklaim masuk status "pending" — TETAP butuh operator ini Terima/Tolak,
// bukan langsung masuk antrean.
async function claimWaitingJobs(printerUid, printerEmail) {
  const regionKey = myRegionKey();
  if (!regionKey) return;
  const q = query(
    collection(db, "printJobs"),
    where("status", "==", "waiting"),
    where("regionKey", "==", regionKey),
    limit(20)
  );
  const snap = await getDocs(q);
  for (const d of snap.docs) {
    if ((d.data().rejectedBy || []).includes(printerUid)) continue; // sudah pernah ditolak operator ini
    const ref = doc(db, "printJobs", d.id);
    try {
      await runTransaction(db, async (tx) => {
        const fresh = await tx.get(ref);
        if (fresh.data().status !== "waiting") return; // sudah diambil operator lain
        if (fresh.data().regionKey !== regionKey) return; // wilayah beda -> bukan urusan operator ini
        if ((fresh.data().rejectedBy || []).includes(printerUid)) return; // operator ini sudah pernah menolak order ini
        tx.update(ref, { status: "pending", printerId: printerUid, printerEmail });
      });
    } catch (e) {
      console.error("gagal klaim job", d.id, e);
    }
  }
}

function onlineStatusText(isOnline) {
  if (!myRegionKey()) return REGION_MISSING_TEXT;
  const where_ = regionLabel(currentProfile.location);
  return isOnline
    ? `Online — file baru dari customer di ${where_} akan masuk ke sini.`
    : "Sedang offline — tidak menerima file baru.";
}

async function setOnline(uid, isOnline, email) {
  await updateDoc(doc(db, "users", uid), { online: isOnline });
  onlineToggle.classList.toggle("on", isOnline);
  statusText.textContent = onlineStatusText(isOnline);
  if (isOnline) {
    try {
      await claimWaitingJobs(uid, email);
    } catch (e) {
      console.error(e);
      statusText.textContent = describeFirestoreError(e, "mengambil pesanan yang menunggu");
    }
  }
}

function stampClass(status) {
  return { queued: "stamp-queued", printing: "stamp-printing", done: "stamp-done", waiting: "stamp-waiting", pending: "stamp-waiting", cancelled: "stamp-cancelled", rejected: "stamp-cancelled" }[status] || "stamp-queued";
}
function stampLabel(status) {
  return { queued: "Antre", printing: "Diprint", done: "Selesai", waiting: "Menunggu", pending: "Perlu konfirmasi", cancelled: "Dibatalkan customer", rejected: "Ditolak semua operator" }[status] || status;
}
function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s || "";
  return d.innerHTML;
}

function nextAction(status) {
  if (status === "queued") return { next: "printing", label: "Mulai print", icon: "Print-Start", btnClass: "btn-primary" };
  if (status === "printing") return { next: "done", label: "Tandai selesai", icon: "Print-Done", btnClass: "btn-success" };
  return null;
}

// ---------------------------------------------------------------------
// Notif WA (Fase C) — dikirim manual (operator klik tombol, browser buka
// tab wa.me baru) ke nomor WhatsApp customer, KALAU customer sudah isi
// "No. WhatsApp" di profilnya (field customerWaNumber, disalin ke job
// pas dia upload — lihat js/home.js). Kalau belum isi, tombolnya
// disembunyikan karena tidak ada nomor tujuan.
// ---------------------------------------------------------------------
function notifyCustomer(job, message) {
  const link = waLinkTo(job.customerWaNumber, message);
  if (link) window.open(link, "_blank", "noopener");
}

function waButtonHtml(jobId) {
  return `<button class="btn btn-outline" style="padding:8px 12px;font-size:12px;" data-wa="${jobId}">Notif WA</button>`;
}

// Setelah satu operator menolak, tentukan nasib order berikutnya:
// - masih ada operator LAIN di wilayah yang sama yang belum menolak dan
//   sedang online -> langsung dilempar ke salah satunya (pending);
// - masih ada yang belum menolak tapi semuanya offline -> waiting, nanti
//   diklaim begitu salah satunya online (claimWaitingJobs);
// - SEMUA operator di wilayah itu sudah menolak -> status "rejected"
//   (final): tidak jadi pending lagi dan tidak bisa diterima siapa pun.
// Customer tetap bisa membatalkan selama status masih waiting/pending.
async function nextStepAfterReject(regionKey, rejectedBy) {
  const snap = await getDocs(query(
    collection(db, "users"),
    where("role", "==", "printer"),
    where("regionKey", "==", regionKey)
  ));
  const candidates = snap.docs.filter((u) => !u.data().banned && !rejectedBy.includes(u.id));
  if (candidates.length === 0) return { status: "rejected", printerId: null, printerEmail: null, rejectedAt: serverTimestamp() };
  const online = candidates.filter((u) => u.data().online);
  if (online.length === 0) return { status: "waiting", printerId: null, printerEmail: null };
  const chosen = online[Math.floor(Math.random() * online.length)];
  return { status: "pending", printerId: chosen.id, printerEmail: chosen.data().email || null };
}

// ---- render "Pesanan masuk" (status pending, perlu Terima/Tolak) ----
function renderPending(docs) {
  if (docs.length === 0) {
    pendingList.innerHTML = `<div class="empty-state">Belum ada pesanan masuk.</div>`;
    return;
  }
  pendingList.innerHTML = docs.map((d) => {
    const j = d.data();
    return `
      <div class="job-row">
        <div>
          <div class="job-name">${escapeHtml(j.fileName)}</div>
          <div class="job-meta"><span class="job-code">#${escapeHtml(jobCodeLabel(j, d.id))}</span> · ${fmtDate(j.createdAt)} · ${fmtFileSize(j.fileSize)}${j.paperSize ? ` · Ukuran ${escapeHtml(j.paperSize)}` : ""}</div>
          ${j.customerLocation && regionLabel(j.customerLocation) ? `<div class="job-meta">📍 ${escapeHtml(regionLabel(j.customerLocation))}</div>` : ""}
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <a class="btn btn-outline" style="padding:8px 12px;font-size:12px;" href="${j.fileURL}" target="_blank" rel="noopener">Buka file</a>
          <a class="btn btn-outline" style="padding:8px 12px;font-size:12px;" href="job.html?id=${d.id}">Detail Info</a>
          <button class="btn btn-outline btn-icon" data-reject="${d.id}" title="Tolak" aria-label="Tolak">${iconImg("Reject", "Tolak")}</button>
          <button class="btn btn-primary btn-icon" data-accept="${d.id}" title="Terima" aria-label="Terima">${iconImg("Accept", "Terima")}</button>
        </div>
      </div>`;
  }).join("");

  pendingList.querySelectorAll("button[data-accept]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const d = docs.find((x) => x.id === btn.dataset.accept);
      openPriceModal(btn.dataset.accept, d.data());
    });
  });
  pendingList.querySelectorAll("button[data-reject]").forEach((btn) => {
    btn.addEventListener("click", () => {
      openReasonPrompt({
        title: "Tolak pesanan ini?",
        subtitle: "Pesanan bakal dilempar ke operator lain di wilayahmu yang belum menolak. Kalau semua operator di wilayah itu menolak, pesanan dinyatakan ditolak dan tidak bisa diterima lagi. Kasih tau alasannya ya.",
        reasons: [
          "File tidak bisa dibuka",
          "Ukuran/jenis kertas tidak tersedia",
          "Lagi terlalu sibuk/antrean penuh",
          "Sebentar lagi mau offline",
          "File melanggar aturan/tidak pantas"
        ],
        confirmLabel: "Tolak pesanan",
        onConfirm: async (reason) => {
          btn.disabled = true;
          const d = docs.find((x) => x.id === btn.dataset.reject);
          try {
            // Catat operator ini di rejectedBy, lalu cari nasib order
            // berikutnya (lihat nextStepAfterReject di atas).
            const j = d.data();
            const rejectedBy = Array.from(new Set([...(j.rejectedBy || []), currentUser.uid]));
            const next = j.regionKey
              ? await nextStepAfterReject(j.regionKey, rejectedBy)
              // Order lama tanpa regionKey: perilaku lama (balik ke waiting).
              : { status: "waiting", printerId: null, printerEmail: null };
            await updateDoc(doc(db, "printJobs", btn.dataset.reject), {
              ...next, rejectedBy, rejectReason: reason
            });
          } catch (e) {
            console.error(e);
            alert(describeFirestoreError(e, "menolak pesanan"));
            btn.disabled = false;
            throw e;
          }
        }
      });
    });
  });
}

function openPriceModal(jobId, jobData) {
  jobForPricing = { id: jobId, data: jobData };
  priceModalFileName.textContent = `${jobData.fileName} (kode #${jobCodeLabel(jobData, jobId)})`;
  priceInput.value = "";
  priceErr.textContent = "";
  priceModal.classList.remove("hidden");
  priceInput.focus();
}
function closePriceModal() {
  priceModal.classList.add("hidden");
  jobForPricing = null;
}
priceCancelBtn.addEventListener("click", closePriceModal);
priceModal.addEventListener("click", (e) => { if (e.target === priceModal) closePriceModal(); });
priceInput.addEventListener("keydown", (e) => { if (e.key === "Enter") priceConfirmBtn.click(); });
priceConfirmBtn.addEventListener("click", async () => {
  if (!jobForPricing) return;
  const price = Number(priceInput.value);
  if (!price || price <= 0) {
    priceErr.textContent = "Isi harga yang valid dulu.";
    return;
  }
  priceConfirmBtn.disabled = true;
  try {
    // acceptedAt dicatat di sini — ini momen operator resmi "menerima"
    // pesanan (dipakai di halaman detail pesanan customer, job.html).
    await updateDoc(doc(db, "printJobs", jobForPricing.id), {
      status: "queued", price, acceptedAt: serverTimestamp()
    });
    notifyCustomer(jobForPricing.data,
      `Halo! Pesanan print kode #${jobCodeLabel(jobForPricing.data, jobForPricing.id)} kamu sudah DITERIMA operator. Total biaya: ${fmtRupiah(price)}. Ditunggu ya, nanti kami kabarin kalau sudah selesai.`);
    closePriceModal();
  } catch (e) {
    console.error(e);
    priceErr.textContent = "Gagal menyimpan, coba lagi.";
  } finally {
    priceConfirmBtn.disabled = false;
  }
});

// ---- render antrean aktif (cuma queued/printing — yang masih PERLU
// dikerjakan). "done" & "cancelled" sengaja TIDAK ditampilkan di list ini
// biar operator nggak bingung ngira masih ada kerjaan padahal udah kelar/
// dibatalkan customer — pendapatan & jumlah "selesai" tetap dihitung dari
// SEMUA data (termasuk yang sudah "done"), cuma barisnya aja yang disaring.
function renderJobs(docs) {
  let doneCount = 0;
  let total = 0;
  docs.forEach((d) => {
    const j = d.data();
    if (j.status === "done" && j.price) {
      doneCount++;
      total += Number(j.price) || 0;
    }
  });
  earningsTotal.textContent = `${fmtRupiah(total)} (${doneCount} selesai)`;

  const active = docs.filter((d) => ["queued", "printing"].includes(d.data().status));

  if (active.length === 0) {
    jobList.innerHTML = `<div class="empty-state">Belum ada file masuk.</div>`;
    return;
  }
  jobList.innerHTML = active.map((d) => {
    const j = d.data();
    const action = nextAction(j.status);
    // Tombol "Simpan file" sengaja cuma tampil begitu statusnya SUDAH
    // "printing" atau "done" — belum relevan buat operator selagi masih
    // "queued" (antre, belum mulai dikerjakan). Klik "Mulai print" di
    // bawah juga otomatis memicu download-nya, jadi ini lebih ke tombol
    // "download ulang" kalau perlu.
    const showSaveBtn = j.status === "printing" || j.status === "done";
    return `
      <div class="job-row">
        <div>
          <div class="job-name">${escapeHtml(j.fileName)}</div>
          <div class="job-meta"><span class="job-code">#${escapeHtml(jobCodeLabel(j, d.id))}</span> · ${fmtDate(j.createdAt)} · ${fmtFileSize(j.fileSize)}${j.paperSize ? ` · Ukuran ${escapeHtml(j.paperSize)}` : ""}${j.price ? " · " + fmtRupiah(j.price) : ""}</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <span class="stamp-badge ${stampClass(j.status)}">${stampLabel(j.status)}</span>
          <a class="btn btn-outline" style="padding:8px 12px;font-size:12px;" href="${j.fileURL}" target="_blank" rel="noopener">Buka file</a>
          ${showSaveBtn ? `<a class="btn btn-outline" style="padding:8px 12px;font-size:12px;" href="${downloadUrl(j.fileURL, j.fileName)}">Simpan file</a>` : ""}
          <a class="btn btn-outline" style="padding:8px 12px;font-size:12px;" href="job.html?id=${d.id}">Detail Info</a>
          ${j.customerWaNumber ? waButtonHtml(d.id) : ""}
          ${action ? `<button class="btn ${action.btnClass} btn-icon" data-id="${d.id}" data-next="${action.next}" title="${action.label}" aria-label="${action.label}">${iconImg(action.icon, action.label)}</button>` : ""}
        </div>
      </div>`;
  }).join("");

  jobList.querySelectorAll("button[data-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const d = active.find((x) => x.id === btn.dataset.id);
      const j = d.data();
      // printingAt / doneAt dicatat di sini — dipakai di halaman detail
      // pesanan customer (job.html) buat nampilin "tanggal mulai diprint"
      // & "tanggal selesai" sesuai status.
      const update = { status: btn.dataset.next };
      if (btn.dataset.next === "printing") update.printingAt = serverTimestamp();
      if (btn.dataset.next === "done") update.doneAt = serverTimestamp();
      await updateDoc(doc(db, "printJobs", btn.dataset.id), update);
      if (btn.dataset.next === "printing") {
        // Begitu operator klik "Mulai print", file-nya langsung didownload
        // otomatis — nge-set location.href ke URL fl_attachment Cloudinary
        // bikin browser download filenya TANPA pindah/reload halaman ini
        // (Content-Disposition: attachment dari respon Cloudinary), jadi
        // aman dipanggil di sini.
        window.location.href = downloadUrl(j.fileURL, j.fileName);
      }
      if (btn.dataset.next === "done") {
        notifyCustomer(j, `Halo! Pesanan print kode #${jobCodeLabel(j, btn.dataset.id)} kamu sudah SELESAI dicetak dan siap diambil. Total: ${fmtRupiah(j.price || 0)}. Makasih ya!`);
      }
    });
  });
  jobList.querySelectorAll("button[data-wa]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const d = active.find((x) => x.id === btn.dataset.wa);
      const j = d.data();
      notifyCustomer(j, `Halo, update pesanan print kode #${jobCodeLabel(j, btn.dataset.wa)} kamu: status sekarang "${stampLabel(j.status)}".`);
    });
  });
}

onlineToggle.addEventListener("click", () => {
  const goingOnline = !onlineToggle.classList.contains("on");
  setOnline(currentUser.uid, goingOnline, currentUser.email);
});

requireAuth((user, profile) => {
  currentUser = user;
  currentProfile = profile;
  // active: "home" (bukan "printer") -> supaya nav "Upload" di sidebar
  // tetap ke-highlight walau halaman ini sebenarnya /printer.html, karena
  // link "Dashboard Operator" sudah dihapus dari sidebar (lihat js/shell.js).
  initShell({ user, profile, active: "home", homeLabel: "Printer" });
  onlineToggle.classList.toggle("on", !!profile.online);
  statusText.textContent = onlineStatusText(!!profile.online);

  const q = query(
    collection(db, "printJobs"),
    where("printerId", "==", user.uid),
    orderBy("createdAt", "desc")
  );
  onSnapshot(q, (snap) => {
    const pendingAll = snap.docs.filter((d) => d.data().status === "pending");
    // "Pesanan masuk" cuma nampilin order yang wilayahnya SAMA dengan wilayah
    // operator sekarang. Order pending yang wilayahnya beda (mis. operator
    // pindah wilayah setelah order ditugaskan) tidak ditampilkan dan
    // dilepas balik ke antrean "waiting" supaya bisa diambil operator di
    // wilayah yang benar. Order lama tanpa regionKey (dibuat sebelum fitur
    // wilayah ada) dibiarkan apa adanya.
    const myKey = myRegionKey();
    const pendingDocs = pendingAll.filter((d) => !d.data().regionKey || d.data().regionKey === myKey);
    pendingAll
      .filter((d) => d.data().regionKey && d.data().regionKey !== myKey)
      .forEach((d) => {
        updateDoc(doc(db, "printJobs", d.id), {
          status: "waiting", printerId: null, printerEmail: null
        }).catch((e) => console.error("gagal melepas order beda wilayah", d.id, e));
      });
    renderPending(pendingDocs);
    renderJobs(snap.docs);
  }, (err) => {
    console.error(err);
    jobList.innerHTML = `<div class="empty-state">${describeFirestoreError(err, "memuat antrean")}</div>`;
    pendingList.innerHTML = "";
  });
}, ["printer", "developer"]);
