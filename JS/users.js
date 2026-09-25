// ===================================================================
// D' CopynPrint — Kelola User (khusus role "developer")
// UI ala Discord: baris per user (pfp, email, role dropdown, ban, hapus).
// ===================================================================
import { db } from "./firebase-config.js";
import { requireAuth, usernameLabel, normalizeUsername, isValidUsername, avatarHtml, describeFirestoreError } from "./app.js";
import { initShell, initBubbleMenu } from "./shell.js";
import {
  collection, onSnapshot, doc, updateDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const userRows = document.getElementById("userRows");
const searchInput = document.getElementById("userSearch");
const confirmModal = document.getElementById("confirmModal");
const confirmTitle = document.getElementById("confirmTitle");
const confirmBody = document.getElementById("confirmBody");
const confirmCancelBtn = document.getElementById("confirmCancelBtn");
const confirmOkBtn = document.getElementById("confirmOkBtn");
const editUsernameModal = document.getElementById("editUsernameModal");
const editUsernameInput = document.getElementById("editUsernameInput");
const editUsernameErr = document.getElementById("editUsernameErr");
const editUsernameCancelBtn = document.getElementById("editUsernameCancelBtn");
const editUsernameSaveBtn = document.getElementById("editUsernameSaveBtn");

let allDocs = [];
let myUid = null;

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s || "";
  return d.innerHTML;
}

function askConfirm(title, body) {
  return new Promise((resolve) => {
    confirmTitle.textContent = title;
    confirmBody.textContent = body;
    confirmModal.classList.remove("hidden");
    const cleanup = (result) => {
      confirmModal.classList.add("hidden");
      confirmOkBtn.onclick = null;
      confirmCancelBtn.onclick = null;
      resolve(result);
    };
    confirmOkBtn.onclick = () => cleanup(true);
    confirmCancelBtn.onclick = () => cleanup(false);
  });
}

// Modal buat benerin field "username" (mis. kapitalisasi "satya" ->
// "Satya") langsung dari sini, tanpa perlu buka Firebase Console manual.
// Cuma boleh ganti EJAAN/KAPITALISASI-nya — huruf/angka/titik/underscore-
// nya (versi lowercase) harus sama kayak sebelumnya, biar tidak ketuker
// sama akun lain (uniqueness username aslinya dijamin dari email palsu
// Firebase Auth yang dibikin pas Daftar, BUKAN dari field ini — field ini
// murni cuma buat tampilan, tapi tetap dibatasi biar konsisten sama
// aturan format username di form Daftar/Masuk).
let editingUid = null;
let editingLowerUsername = null;

function closeEditUsername() {
  editUsernameModal.classList.add("hidden");
  editingUid = null;
  editingLowerUsername = null;
}

function openEditUsername(uid, u) {
  editingUid = uid;
  const current = u.username || usernameLabel(u.email) || "";
  editingLowerUsername = normalizeUsername(current);
  editUsernameInput.value = current;
  editUsernameErr.textContent = "";
  editUsernameModal.classList.remove("hidden");
  editUsernameInput.focus();
  editUsernameInput.select();
}

editUsernameCancelBtn.addEventListener("click", closeEditUsername);
editUsernameModal.addEventListener("click", (e) => {
  if (e.target === editUsernameModal) closeEditUsername();
});

editUsernameSaveBtn.addEventListener("click", async () => {
  editUsernameErr.textContent = "";
  const newValue = editUsernameInput.value.trim();
  const newLower = normalizeUsername(newValue);
  if (!newValue) {
    editUsernameErr.textContent = "Username tidak boleh kosong.";
    return;
  }
  if (!isValidUsername(newLower)) {
    editUsernameErr.textContent = "Username 3-20 karakter: huruf, angka, titik, atau underscore saja.";
    return;
  }
  if (newLower !== editingLowerUsername) {
    editUsernameErr.textContent = `Cuma boleh ubah kapitalisasi/ejaan tampilan — hurufnya tetap harus "${editingLowerUsername}" (login orang ini tidak berubah sama sekali kalau beda).`;
    return;
  }
  editUsernameSaveBtn.disabled = true;
  try {
    await updateDoc(doc(db, "users", editingUid), { username: newValue });
    closeEditUsername();
  } catch (e) {
    console.error(e);
    editUsernameErr.textContent = "Gagal simpan (izin ditolak). Pastikan firestore.rules sudah dipublish & kamu login sebagai developer.";
  } finally {
    editUsernameSaveBtn.disabled = false;
  }
});

function render() {
  const term = searchInput.value.trim().toLowerCase();
  const docs = allDocs.filter((d) => {
    if (!term) return true;
    const u = d.data();
    return (u.username || "").toLowerCase().includes(term) ||
           (u.email || "").toLowerCase().includes(term) ||
           (u.contactEmail || "").toLowerCase().includes(term);
  });

  if (!docs.length) {
    userRows.innerHTML = `<div class="empty-state">Tidak ada user yang cocok.</div>`;
    return;
  }

  userRows.innerHTML = docs.map((d) => {
    const u = d.data();
    const roles = ["customer", "printer", "developer"];
    const options = roles.map((r) => `<option value="${r}" ${u.role === r ? "selected" : ""}>${r}</option>`).join("");
    const isMe = d.id === myUid;
    const banned = !!u.banned;
    return `
      <div class="user-mgmt-row ${banned ? "is-banned" : ""}" data-uid="${d.id}">
        <a href="profile.html?uid=${encodeURIComponent(d.id)}" class="user-mgmt-identity" title="Lihat profil">
          ${avatarHtml(u, "sm")}
          <div class="user-mgmt-info">
            <div class="user-mgmt-name">${escapeHtml(u.username || usernameLabel(u.email))}${isMe ? " (kamu)" : ""}${banned ? ' <span class="ban-badge">Diblokir</span>' : ""}</div>
            <div class="user-mgmt-email">${escapeHtml(u.contactEmail || u.email || "-")}</div>
          </div>
        </a>
        <button type="button" class="btn btn-outline btn-sm edit-username-btn" data-uid="${d.id}" title="Benerin kapitalisasi/ejaan field username">Edit username</button>
        <select class="user-mgmt-role" data-uid="${d.id}" ${isMe ? "disabled" : ""}>${options}</select>
        <button type="button" class="btn btn-outline btn-sm ban-btn" data-uid="${d.id}" ${isMe ? "disabled" : ""}>${banned ? "Buka blokir" : "Ban"}</button>
        <button type="button" class="btn btn-stamp btn-sm delete-btn" data-uid="${d.id}" ${isMe ? "disabled" : ""}>Hapus</button>
      </div>`;
  }).join("");

  userRows.querySelectorAll("select.user-mgmt-role").forEach((sel) => {
    sel.addEventListener("change", async () => {
      try {
        await updateDoc(doc(db, "users", sel.dataset.uid), { role: sel.value });
      } catch (e) {
        console.error(e);
        alert("Gagal ubah role (izin ditolak). Pastikan firestore.rules sudah dipublish.");
      }
    });
  });

  userRows.querySelectorAll(".ban-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const uid = btn.dataset.uid;
      const target = allDocs.find((d) => d.id === uid);
      const banned = !!(target && target.data().banned);
      const ok = await askConfirm(
        banned ? "Buka blokir user?" : "Blokir user ini?",
        banned ? "User bisa login lagi setelah ini." : "User akan otomatis logout dan tidak bisa login lagi sampai dibuka blokirnya."
      );
      if (!ok) return;
      try {
        await updateDoc(doc(db, "users", uid), { banned: !banned });
      } catch (e) {
        console.error(e);
        alert("Gagal ubah status blokir (izin ditolak). Pastikan firestore.rules sudah dipublish & kamu login sebagai developer.");
      }
    });
  });

  userRows.querySelectorAll(".edit-username-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const uid = btn.dataset.uid;
      const target = allDocs.find((d) => d.id === uid);
      openEditUsername(uid, target ? target.data() : {});
    });
  });

  userRows.querySelectorAll(".delete-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const uid = btn.dataset.uid;
      const ok = await askConfirm(
        "Hapus user ini?",
        "Ini menghapus profil & datanya dari database (Firestore) secara permanen. Catatan: akun login (Firebase Auth) tidak otomatis ikut terhapus — kalau orang ini login lagi, akunnya akan dibuatkan ulang otomatis dengan role \"customer\" (lihat README bagian Kelola User untuk detail & cara menutup akun login itu total lewat Cloud Function/Admin SDK)."
      );
      if (!ok) return;
      try {
        await deleteDoc(doc(db, "users", uid));
      } catch (e) {
        console.error(e);
        alert("Gagal hapus user (izin ditolak). Pastikan firestore.rules sudah dipublish & kamu login sebagai developer.");
      }
    });
  });
}

requireAuth((user, profile) => {
  myUid = user.uid;
  initShell({ user, profile, active: "users" });
  initBubbleMenu(profile);
  searchInput.addEventListener("input", render);
  onSnapshot(collection(db, "users"), (snap) => {
    allDocs = snap.docs;
    render();
  }, (err) => {
    console.error(err);
    userRows.innerHTML = `<div class="empty-state">${describeFirestoreError(err, "memuat daftar user")}</div>`;
  });
}, "developer");
