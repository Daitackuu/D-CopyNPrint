// ===================================================================
// D' CopynPrint — Komunitas = direktori CHANNEL (ala Discord/WA), BUKAN
// feed postingan lagi (postingan sekarang ada di halaman Profil).
// Kalau belum ada channel sama sekali, tampil kosong tapi search bar
// & tombol "Buat channel" tetap ada.
// ===================================================================
import { db } from "./firebase-config.js";
import { requireAuth, fmtDate, describeFirestoreError } from "./app.js";
import { initShell } from "./shell.js";
import {
  collection, addDoc, query, orderBy, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const channelSearch = document.getElementById("channelSearch");
const channelList = document.getElementById("channelList");
const createChannelBtn = document.getElementById("createChannelBtn");
const createChannelModal = document.getElementById("createChannelModal");
const channelNameInput = document.getElementById("channelNameInput");
const channelDescInput = document.getElementById("channelDescInput");
const createChannelErr = document.getElementById("createChannelErr");
const createChannelCancel = document.getElementById("createChannelCancel");
const createChannelSubmit = document.getElementById("createChannelSubmit");

let me = null;
let myProfile = null;
let allChannels = [];

requireAuth((user, profile) => {
  me = user;
  myProfile = profile;
  initShell({ user, profile, active: "community" });

  const q = query(collection(db, "channels"), orderBy("createdAt", "desc"));
  onSnapshot(q, (snap) => {
    allChannels = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderChannelList();
  }, (err) => {
    console.error(err);
    channelList.innerHTML = `<div class="empty-state">${describeFirestoreError(err, "memuat channel")}</div>`;
  });

  channelSearch.addEventListener("input", renderChannelList);

  createChannelBtn.addEventListener("click", () => {
    channelNameInput.value = "";
    channelDescInput.value = "";
    createChannelErr.textContent = "";
    createChannelModal.classList.remove("hidden");
  });
  createChannelCancel.addEventListener("click", () => createChannelModal.classList.add("hidden"));
  createChannelModal.addEventListener("click", (e) => {
    if (e.target === createChannelModal) createChannelModal.classList.add("hidden");
  });
  createChannelSubmit.addEventListener("click", submitCreateChannel);
  channelNameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") submitCreateChannel(); });
  channelDescInput.addEventListener("keydown", (e) => { if (e.key === "Enter") submitCreateChannel(); });
});

function renderChannelList() {
  const term = channelSearch.value.trim().toLowerCase();
  const filtered = term
    ? allChannels.filter((c) => (c.name || "").toLowerCase().includes(term) || (c.description || "").toLowerCase().includes(term))
    : allChannels;

  if (allChannels.length === 0) {
    channelList.innerHTML = `<div class="empty-state">Belum ada channel yang tersedia. Jadi yang pertama bikin channel!</div>`;
    return;
  }
  if (filtered.length === 0) {
    channelList.innerHTML = `<div class="empty-state">Nggak ada channel yang cocok dengan pencarian itu.</div>`;
    return;
  }

  channelList.innerHTML = filtered.map((c) => `
    <a class="channel-list-row" href="channel.html?id=${c.id}">
      ${c.photoURL ? `<img src="${c.photoURL}" class="channel-hash-icon" style="object-fit:cover;">` : `<span class="channel-hash-icon">#</span>`}
      <div class="channel-list-info">
        <div class="channel-card-name">${escapeHtml(c.name)}</div>
        ${c.description ? `<div class="channel-card-desc">${escapeHtml(c.description)}</div>` : ""}
        <div class="job-meta" style="margin-top:2px;">Dibuat oleh ${escapeHtml(c.creatorName || "user")} · ${fmtDate(c.createdAt)}</div>
      </div>
      <span class="channel-open-arrow">→</span>
    </a>
  `).join("");
}

async function submitCreateChannel() {
  const name = channelNameInput.value.trim();
  if (!name) {
    createChannelErr.textContent = "Nama channel wajib diisi.";
    return;
  }
  createChannelSubmit.disabled = true;
  createChannelErr.textContent = "";
  try {
    const docRef = await addDoc(collection(db, "channels"), {
      name,
      description: channelDescInput.value.trim(),
      creatorId: me.uid,
      creatorName: myProfile.displayName || me.email.split("@")[0],
      createdAt: serverTimestamp()
    });
    createChannelModal.classList.add("hidden");
    window.location.href = `channel.html?id=${docRef.id}`;
  } catch (e) {
    console.error(e);
    createChannelErr.textContent = "Gagal bikin channel, coba lagi.";
  } finally {
    createChannelSubmit.disabled = false;
  }
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s || "";
  return d.innerHTML;
}
