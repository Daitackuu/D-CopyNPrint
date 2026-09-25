// ===================================================================
// D' CopynPrint — Detail Pesanan Print (job.html)
// Diakses lewat tombol "Detail Info" di halaman Upload (customer) MAUPUN
// Dashboard Operator (printer) — isinya menyesuaikan siapa yang lihat:
// - Kalau customer yang buka: kartu bio OPERATOR yang mengerjakan.
// - Kalau operator yang buka: kartu bio CUSTOMER pemesan.
// Isinya juga beda-beda TERGANTUNG STATUS pesanannya:
// - "waiting"/"pending" (belum ada operator yang resmi menerima & isi
//   harga) -> cuma teks status, disesuaikan siapa yang lihat.
// - "queued"/"printing"/"done" (sudah diterima operator) -> tampilkan
//   bio pihak satunya (foto, nama, bio, No. WA) + harga.
// Detail dokumen (nama, ukuran, tanggal upload/diterima/diprint/selesai)
// selalu ditampilkan, tapi baris tanggal yang belum terjadi disembunyikan.
// ===================================================================
import { db } from "./firebase-config.js";
import { requireAuth, fmtDate, fmtRupiah, fmtFileSize, avatarHtml, describeFirestoreError, downloadUrl, jobCodeLabel, openReasonPrompt, regionLabel } from "./app.js";
import { initShell } from "./shell.js";
import { waLinkTo } from "./support-config.js";
import { doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const jobFileName = document.getElementById("jobFileName");
const jobStatusBadge = document.getElementById("jobStatusBadge");
const jobBody = document.getElementById("jobBody");

const params = new URLSearchParams(window.location.search);
const jobId = params.get("id");

function stampClass(status) {
  return { queued: "stamp-queued", printing: "stamp-printing", done: "stamp-done", waiting: "stamp-waiting", pending: "stamp-waiting", cancelled: "stamp-cancelled", rejected: "stamp-cancelled" }[status] || "stamp-queued";
}
function stampLabel(status) {
  return { queued: "Antre", printing: "Diprint", done: "Selesai", waiting: "Menunggu operator", pending: "Menunggu konfirmasi operator", cancelled: "Dibatalkan", rejected: "Ditolak semua operator" }[status] || status;
}
function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s || "";
  return d.innerHTML;
}

// Satu baris "label: value" di kartu Detail Dokumen. Baris dilewatkan
// (return "") kalau valuenya kosong — dipakai buat tanggal yang belum
// terjadi (mis. "Tanggal diprint" sebelum statusnya beneran "printing").
function detailRow(label, value) {
  if (!value) return "";
  return `
    <div class="detail-row">
      <span class="detail-label">${escapeHtml(label)}</span>
      <span class="detail-value">${escapeHtml(value)}</span>
    </div>`;
}

requireAuth(async (user, profile) => {
  initShell({ user, profile, active: "home" });

  if (!jobId) {
    jobFileName.textContent = "Pesanan tidak ditemukan";
    jobBody.innerHTML = `<div class="empty-state">Link pesanan tidak valid.</div>`;
    return;
  }

  try {
    const snap = await getDoc(doc(db, "printJobs", jobId));
    if (!snap.exists()) {
      jobFileName.textContent = "Pesanan tidak ditemukan";
      jobBody.innerHTML = `<div class="empty-state">Pesanan ini mungkin sudah dihapus.</div>`;
      return;
    }
    const j = snap.data();

    jobFileName.textContent = j.fileName || "(tanpa nama)";
    jobStatusBadge.textContent = stampLabel(j.status);
    jobStatusBadge.className = `stamp-badge ${stampClass(j.status)}`;

    // Kode pesanan pendek (Fase E) — dipasang di atas, jelas & gampang
    // di-copy, supaya kalau customer/operator mau saling tanya soal
    // pesanan ini, mereka sebut KODE-nya, bukan nama file yang bisa
    // panjang/mirip-mirip dan bikin bingung.
    const jobCode = jobCodeLabel(j, jobId);
    jobBody.insertAdjacentHTML("beforebegin", `
      <div class="job-code-banner" id="jobCodeBanner">
        <span class="job-meta">Kode pesanan</span>
        <span class="job-code job-code-lg">#${escapeHtml(jobCode)}</span>
        <button type="button" class="btn btn-outline btn-sm" id="copyJobCodeBtn">Salin kode</button>
      </div>`);
    const copyBtn = document.getElementById("copyJobCodeBtn");
    if (copyBtn) {
      copyBtn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(`#${jobCode}`);
          copyBtn.textContent = "Tersalin!";
          setTimeout(() => { copyBtn.textContent = "Salin kode"; }, 1500);
        } catch (e) {
          console.error(e);
        }
      });
    }

    // Siapa yang lagi buka halaman ini: customer pemesan, operator yang
    // (mungkin) mengerjakan, atau pihak lain (mis. developer). Dipakai
    // buat nentuin kartu bio siapa yang ditampilkan & teks status mana.
    const viewerIsPrinter = user.uid === j.printerId;
    const viewerIsCustomer = user.uid === j.customerId;
    const otherPartyId = viewerIsPrinter ? j.customerId : j.printerId;
    const otherPartyRoleLabel = viewerIsPrinter ? "Customer" : "printer";

    const accepted = ["queued", "printing", "done"].includes(j.status);
    const cancellable = viewerIsCustomer && (j.status === "waiting" || j.status === "pending");

    let receiverSection;
    if (!accepted) {
      const notYetText = viewerIsPrinter
        ? `Kamu belum menerima pesanan ini — buka <a href="printer.html">Dashboard Operator</a> dan klik Terima dulu.`
        : j.status === "cancelled"
          ? `Pesanan ini sudah kamu batalkan.`
          : j.status === "rejected"
            ? `Pesanan ini sudah ditolak oleh semua operator di wilayahmu, jadi tidak bisa diterima lagi. Kamu bisa upload ulang nanti kalau ada operator baru atau file-nya sudah diperbaiki.`
            : `Belum ada yang mau menerima dokumen kamu untuk diprint.`;
      receiverSection = `
        <div class="ticket">
          <div class="empty-state">${notYetText}</div>
          ${cancellable ? `
            <div style="margin-top:16px;">
              <button type="button" class="btn btn-outline" id="cancelJobBtn">Batal pesanan</button>
            </div>` : ""}
        </div>`;
    } else {
      let partyCardHtml = "";
      if (otherPartyId) {
        try {
          const partySnap = await getDoc(doc(db, "users", otherPartyId));
          if (partySnap.exists()) {
            const p = partySnap.data();
            const waNumber = viewerIsPrinter ? (j.customerWaNumber || p.waNumber) : p.waNumber;
            const waLink = waLinkTo(waNumber, `Halo, saya mau tanya soal pesanan print kode #${jobCode}.`);
            const profileHref = `profile.html?uid=${encodeURIComponent(otherPartyId)}`;
            partyCardHtml = `
              <div class="profile-head-row" style="margin-top:14px;">
                <a href="${profileHref}" class="chat-avatar-link" title="Lihat profil">${avatarHtml(p, "lg")}</a>
                <div style="flex:1;min-width:0;">
                  <div class="post-head" style="margin-bottom:2px;">
                    <h1 style="margin:0;font-size:20px;">${escapeHtml(p.displayName || p.username || otherPartyRoleLabel)}</h1>
                    <span class="role-pill">${escapeHtml(otherPartyRoleLabel.toLowerCase())}</span>
                  </div>
                  <p class="sub" style="margin:0 0 6px;">@${escapeHtml(p.username || "user")}</p>
                  <p style="margin:0 0 10px;">${p.bio ? escapeHtml(p.bio) : `<span class="job-meta">Belum ada bio.</span>`}</p>
                  <div class="job-meta">
                    ${waLink ? `<a href="${waLink}" target="_blank" rel="noopener">Chat No. WA ${escapeHtml(otherPartyRoleLabel.toLowerCase())}</a>` : `No. WA ${escapeHtml(otherPartyRoleLabel.toLowerCase())} belum diisi.`}
                  </div>
                  <div style="margin-top:12px;">
                    <a class="btn btn-outline btn-sm" href="${profileHref}">Lihat detail profil</a>
                  </div>
                </div>
              </div>`;
          }
        } catch (e) {
          console.error(e);
          partyCardHtml = `<div class="empty-state" style="margin-top:10px;">${describeFirestoreError(e, `memuat profil ${otherPartyRoleLabel.toLowerCase()}`)}</div>`;
        }
      }
      const headTitle = viewerIsPrinter
        ? (j.status === "done" ? "Sudah kamu selesaikan" : "Sedang kamu kerjakan")
        : (j.status === "done" ? "Sudah selesai diprint" : "Sedang dalam proses print");
      receiverSection = `
        <div class="ticket">
          <h2>${headTitle}</h2>
          ${partyCardHtml || `<div class="empty-state">${escapeHtml(otherPartyRoleLabel)} tidak ditemukan.</div>`}
          ${j.price ? `
            <div class="ticket" style="background:var(--paper-2);margin-top:14px;">
              <div class="job-meta">Harga ditentukan operator</div>
              <div style="font-size:20px;font-weight:700;">${fmtRupiah(j.price)}</div>
            </div>` : ""}
        </div>`;
    }

    const detailSection = `
      <div class="ticket">
        <h2>Detail dokumen</h2>
        ${detailRow("Kode pesanan", `#${jobCode}`)}
        ${detailRow("Nama file", j.fileName)}
        ${detailRow("Ukuran file", fmtFileSize(j.fileSize))}
        ${detailRow("Ukuran kertas", j.paperSize || "-")}
        ${detailRow("Wilayah customer", regionLabel(j.customerLocation))}
        ${detailRow("Diupload", fmtDate(j.createdAt))}
        ${detailRow("Diterima operator", j.acceptedAt ? fmtDate(j.acceptedAt) : "")}
        ${detailRow("Mulai diprint", j.printingAt ? fmtDate(j.printingAt) : "")}
        ${detailRow("Selesai", j.doneAt ? fmtDate(j.doneAt) : "")}
        ${detailRow("Alasan dibatalkan", j.status === "cancelled" ? j.cancelReason : "")}
        ${detailRow("Alasan ditolak operator (terakhir)", (j.status === "waiting" || j.status === "pending" || j.status === "rejected") ? j.rejectReason : "")}
        ${j.fileURL ? `<div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap;">
          <a class="btn btn-outline btn-sm" href="${j.fileURL}" target="_blank" rel="noopener">Buka file</a>
          <a class="btn btn-outline btn-sm" href="${downloadUrl(j.fileURL, j.fileName)}">Simpan file</a>
        </div>` : ""}
      </div>`;

    jobBody.innerHTML = receiverSection + detailSection;

    const cancelBtn = document.getElementById("cancelJobBtn");
    if (cancelBtn) {
      cancelBtn.addEventListener("click", () => {
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
            cancelBtn.disabled = true;
            cancelBtn.textContent = "Membatalkan...";
            try {
              await updateDoc(doc(db, "printJobs", jobId), { status: "cancelled", cancelReason: reason });
              jobStatusBadge.textContent = stampLabel("cancelled");
              jobStatusBadge.className = `stamp-badge ${stampClass("cancelled")}`;
              cancelBtn.remove();
              const emptyState = jobBody.querySelector(".empty-state");
              if (emptyState) emptyState.textContent = "Pesanan ini sudah kamu batalkan.";
            } catch (e) {
              console.error(e);
              const extra = (e && e.code === "permission-denied")
                ? " Kemungkinan besar pesanan ini sudah diterima operator (statusnya sudah bukan \"Menunggu operator\" lagi) sesaat sebelum kamu klik Batal — refresh halaman untuk lihat status terbarunya."
                : "";
              alert(describeFirestoreError(e, "membatalkan pesanan") + extra);
              cancelBtn.disabled = false;
              cancelBtn.textContent = "Batal pesanan";
              throw e;
            }
          }
        });
      });
    }
  } catch (e) {
    console.error(e);
    jobFileName.textContent = "Gagal memuat pesanan";
    jobBody.innerHTML = `<div class="empty-state">${describeFirestoreError(e, "memuat detail pesanan")}</div>`;
  }
});
