// ===================================================================
// D' CopynPrint — daftar user role "printer" (khusus developer).
// Ditampilkan sebagai list (bukan grid): pfp, username, status online.
// Klik baris -> ke profile.html?uid=... milik printer itu.
// ===================================================================
import { db } from "./firebase-config.js";
import { requireAuth, usernameLabel, avatarHtml, describeFirestoreError } from "./app.js";
import { initShell, initBubbleMenu } from "./shell.js";
import {
  collection, query, where, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const printerList = document.getElementById("printerList");

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s || "";
  return d.innerHTML;
}

function render(docs) {
  if (!docs.length) {
    printerList.innerHTML = `<div class="empty-state">Belum ada user dengan role printer.</div>`;
    return;
  }
  printerList.innerHTML = docs.map((d) => {
    const u = d.data();
    return `
      <a class="printer-row" href="profile.html?uid=${d.id}">
        ${avatarHtml(u, "sm")}
        <div class="printer-row-info">
          <div class="printer-row-name">${escapeHtml(u.username || usernameLabel(u.email))}</div>
        </div>
        <span class="status-pill ${u.online ? "is-online" : "is-offline"}">
          <span class="status-dot"></span>${u.online ? "Online" : "Offline"}
        </span>
      </a>`;
  }).join("");
}

requireAuth((user, profile) => {
  initShell({ user, profile, active: "printers" });
  initBubbleMenu(profile);
  const q = query(collection(db, "users"), where("role", "==", "printer"));
  onSnapshot(q, (snap) => render(snap.docs), (err) => {
    console.error(err);
    printerList.innerHTML = `<div class="empty-state">${describeFirestoreError(err, "memuat daftar printer")}</div>`;
  });
}, "developer");
