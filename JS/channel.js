// ===================================================================
// D' CopynPrint — ruang obrolan di dalam satu channel (dibuka dari
// community.html?...→channel.html?id=xxx). Obrolan publik ala WhatsApp:
// bubble pesan sendiri di kanan, orang lain di kiri (dengan avatar).
// Pemilik channel (creatorId) bisa Hapus Saluran & Kelola Anggota
// (Kick = sementara, Ban = permanen — lihat firestore.rules).
// Developer JUGA punya akses penuh yang sama (Edit + Kelola Anggota +
// Hapus) ke channel SIAPA SAJA, bukan cuma channel yang dia buat sendiri —
// firestore.rules memang sudah lama ngizinin ini di level database
// (myRole() == "developer" di match /channels/{channelId} & sub-collection
// members/messages-nya), panel UI ini cuma nyusul nampilin tombol yang
// sama ke developer.
// ===================================================================
import { db } from "./firebase-config.js";
import { requireAuth, fmtDate, avatarHtml, describeFirestoreError } from "./app.js";
import { initShell } from "./shell.js";
import { uploadToCloudinary } from "./cloudinary.js";
import {
  doc, getDoc, deleteDoc, setDoc, updateDoc, collection, addDoc, query, orderBy, limit,
  onSnapshot, serverTimestamp, getDocs
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const channelNameEl = document.getElementById("channelName");
const channelDescEl = document.getElementById("channelDesc");
const channelAvatarWrap = document.getElementById("channelAvatarWrap");
const channelMsgs = document.getElementById("channelMsgs");
const channelInput = document.getElementById("channelInput");
const channelSendBtn = document.getElementById("channelSendBtn");
const channelOwnerActions = document.getElementById("channelOwnerActions");
const editChannelBtn = document.getElementById("editChannelBtn");
const manageMembersBtn = document.getElementById("manageMembersBtn");
const deleteChannelBtn = document.getElementById("deleteChannelBtn");
const membersModal = document.getElementById("membersModal");
const membersList = document.getElementById("membersList");
const membersCloseBtn = document.getElementById("membersCloseBtn");

const editChannelModal = document.getElementById("editChannelModal");
const editChannelAvatarWrap = document.getElementById("editChannelAvatarWrap");
const editChannelAvatarInput = document.getElementById("editChannelAvatarInput");
const editChannelNameInput = document.getElementById("editChannelNameInput");
const editChannelDescInput = document.getElementById("editChannelDescInput");
const editChannelErr = document.getElementById("editChannelErr");
const editChannelCancel = document.getElementById("editChannelCancel");
const editChannelSubmit = document.getElementById("editChannelSubmit");

const params = new URLSearchParams(window.location.search);
const channelId = params.get("id");

let me = null;
let myProfile = null;
let isOwner = false;
let canManageChannel = false;
let currentChannel = null;
let pendingAvatarFile = null;

// Render foto/hash-icon channel di header (dipakai pas load awal & abis edit).
function renderChannelAvatar(c) {
  channelAvatarWrap.innerHTML = c && c.photoURL
    ? `<img src="${c.photoURL}" class="channel-hash-icon lg" style="object-fit:cover;">`
    : `<span class="channel-hash-icon lg">#</span>`;
}

requireAuth(async (user, profile) => {
  me = user;
  myProfile = profile;
  initShell({ user, profile, active: "community" });

  if (!channelId) {
    channelNameEl.textContent = "Channel tidak ditemukan";
    channelMsgs.innerHTML = `<div class="empty-state">Link channel tidak valid.</div>`;
    return;
  }

  try {
    const snap = await getDoc(doc(db, "channels", channelId));
    if (!snap.exists()) {
      channelNameEl.textContent = "Channel tidak ditemukan";
      channelMsgs.innerHTML = `<div class="empty-state">Channel ini mungkin sudah dihapus.</div>`;
      return;
    }
    const c = snap.data();
    currentChannel = c;
    channelNameEl.textContent = `# ${c.name}`;
    channelDescEl.textContent = c.description || "";
    renderChannelAvatar(c);

    isOwner = c.creatorId === me.uid;
    // Developer dapat akses SAMA PERSIS kayak owner (Edit, Kelola Anggota,
    // Hapus), ke channel siapa saja — bukan cuma miliknya sendiri.
    canManageChannel = isOwner || (myProfile && myProfile.role === "developer");
    if (canManageChannel) channelOwnerActions.classList.remove("hidden");

    // Catat diri sendiri sebagai anggota channel ini (buat panel Kelola
    // Anggota pemilik). Kalau sebelumnya di-kick, ini otomatis "gabung lagi".
    await setDoc(doc(db, "channels", channelId, "members", me.uid), {
      username: myProfile.username || me.email,
      photoURL: myProfile.photoURL || null,
      joinedAt: serverTimestamp()
    }, { merge: true });
  } catch (e) {
    console.error(e);
    channelNameEl.textContent = "Gagal memuat channel";
    channelMsgs.innerHTML = `<div class="empty-state">${describeFirestoreError(e, "memuat channel")}</div>`;
    return;
  }

  const q = query(collection(db, "channels", channelId, "messages"), orderBy("createdAt", "asc"), limit(200));
  onSnapshot(q, (msnap) => {
    renderMessages(msnap.docs.map((d) => d.data()));
  }, (err) => {
    console.error(err);
    channelMsgs.innerHTML = `<div class="empty-state">${describeFirestoreError(err, "memuat pesan")}</div>`;
  });

  channelSendBtn.addEventListener("click", sendChannelMessage);
  channelInput.addEventListener("keydown", (e) => { if (e.key === "Enter") sendChannelMessage(); });

  if (canManageChannel) {
    manageMembersBtn.addEventListener("click", openMembersModal);
    editChannelBtn.addEventListener("click", openEditChannelModal);
    deleteChannelBtn.addEventListener("click", handleDeleteChannel);
  }
  membersCloseBtn.addEventListener("click", () => membersModal.classList.add("hidden"));
  membersModal.addEventListener("click", (e) => { if (e.target === membersModal) membersModal.classList.add("hidden"); });

  editChannelAvatarWrap.addEventListener("click", () => editChannelAvatarInput.click());
  editChannelAvatarInput.addEventListener("change", () => {
    const file = editChannelAvatarInput.files[0];
    if (!file) return;
    pendingAvatarFile = file;
    const preview = document.getElementById("editChannelAvatarPreview");
    preview.outerHTML = `<img id="editChannelAvatarPreview" src="${URL.createObjectURL(file)}" class="channel-hash-icon lg" style="width:88px;height:88px;object-fit:cover;">`;
  });
  editChannelCancel.addEventListener("click", () => editChannelModal.classList.add("hidden"));
  editChannelModal.addEventListener("click", (e) => { if (e.target === editChannelModal) editChannelModal.classList.add("hidden"); });
  editChannelSubmit.addEventListener("click", submitEditChannel);
  editChannelNameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") submitEditChannel(); });
  editChannelDescInput.addEventListener("keydown", (e) => { if (e.key === "Enter") submitEditChannel(); });
});

function renderMessages(msgs) {
  if (msgs.length === 0) {
    channelMsgs.innerHTML = `<div class="empty-state">Belum ada pesan. Mulai obrolan di channel ini!</div>`;
  } else {
    channelMsgs.innerHTML = msgs.map((m) => {
      const mine = m.senderId === me.uid;
      const profileHref = `profile.html?uid=${encodeURIComponent(m.senderId)}`;
      return `
        <div class="chat-bubble-row ${mine ? "is-mine" : "is-theirs"}">
          ${!mine ? `<a href="${profileHref}" class="chat-avatar-link" title="Lihat profil">${avatarHtml({ photoURL: m.senderPhotoURL }, "sm")}</a>` : ""}
          <div class="chat-bubble">
            ${!mine ? `<a href="${profileHref}" class="msg-author">${escapeHtml(m.senderName || "user")}</a>` : ""}
            <div class="msg-text">${escapeHtml(m.text)}</div>
            <span class="msg-time">${fmtDate(m.createdAt)}</span>
          </div>
        </div>`;
    }).join("");
  }
  channelMsgs.scrollTop = channelMsgs.scrollHeight;
}

async function sendChannelMessage() {
  const text = channelInput.value.trim();
  if (!text || !channelId) return;
  channelInput.value = "";
  try {
    await addDoc(collection(db, "channels", channelId, "messages"), {
      senderId: me.uid,
      senderName: myProfile.displayName || myProfile.username || me.email,
      senderPhotoURL: myProfile.photoURL || null,
      text,
      createdAt: serverTimestamp()
    });
  } catch (e) {
    console.error(e);
    alert("Gagal kirim pesan, coba lagi (kalau kamu baru saja di-ban dari channel ini, itu sebabnya).");
  }
}

// ---------------------------------------------------------------------
// Edit Saluran (khusus pemilik channel) — nama, deskripsi, foto.
// ---------------------------------------------------------------------
function openEditChannelModal() {
  pendingAvatarFile = null;
  editChannelErr.textContent = "";
  editChannelNameInput.value = currentChannel.name || "";
  editChannelDescInput.value = currentChannel.description || "";
  const preview = document.getElementById("editChannelAvatarPreview");
  if (currentChannel.photoURL) {
    preview.outerHTML = `<img id="editChannelAvatarPreview" src="${currentChannel.photoURL}" class="channel-hash-icon lg" style="width:88px;height:88px;object-fit:cover;">`;
  } else {
    preview.outerHTML = `<span id="editChannelAvatarPreview" class="channel-hash-icon lg" style="width:88px;height:88px;font-size:32px;">#</span>`;
  }
  editChannelModal.classList.remove("hidden");
}

async function submitEditChannel() {
  const name = editChannelNameInput.value.trim();
  if (!name) {
    editChannelErr.textContent = "Nama channel wajib diisi.";
    return;
  }
  editChannelSubmit.disabled = true;
  editChannelErr.textContent = "";
  try {
    const update = {
      name,
      description: editChannelDescInput.value.trim()
    };
    if (pendingAvatarFile) {
      update.photoURL = await uploadToCloudinary(pendingAvatarFile);
    }
    await updateDoc(doc(db, "channels", channelId), update);
    currentChannel = { ...currentChannel, ...update };
    channelNameEl.textContent = `# ${currentChannel.name}`;
    channelDescEl.textContent = currentChannel.description || "";
    renderChannelAvatar(currentChannel);
    editChannelModal.classList.add("hidden");
  } catch (e) {
    console.error(e);
    editChannelErr.textContent = "Gagal simpan perubahan, coba lagi.";
  } finally {
    editChannelSubmit.disabled = false;
  }
}

// ---------------------------------------------------------------------
// Panel Kelola Anggota (khusus pemilik channel)
// ---------------------------------------------------------------------
async function openMembersModal() {
  membersList.innerHTML = `<div class="empty-state">Memuat anggota…</div>`;
  membersModal.classList.remove("hidden");
  try {
    const snap = await getDocs(collection(db, "channels", channelId, "members"));
    const chSnap = await getDoc(doc(db, "channels", channelId));
    const bannedUids = (chSnap.data() && chSnap.data().bannedUids) || [];
    const rows = snap.docs.filter((d) => d.id !== me.uid);
    if (!rows.length) {
      membersList.innerHTML = `<div class="empty-state">Belum ada anggota lain.</div>`;
      return;
    }
    membersList.innerHTML = rows.map((d) => {
      const u = d.data();
      const banned = bannedUids.includes(d.id);
      const profileHref = `profile.html?uid=${encodeURIComponent(d.id)}`;
      return `
        <div class="user-mgmt-row" data-uid="${d.id}">
          <a href="${profileHref}" class="user-mgmt-identity" title="Lihat profil">
            ${avatarHtml(u, "sm")}
            <div class="user-mgmt-info">
              <div class="user-mgmt-name">${escapeHtml(u.username || "user")}${banned ? ' <span class="ban-badge">Diblokir</span>' : ""}</div>
            </div>
          </a>
          <button type="button" class="btn btn-outline btn-sm kick-btn" data-uid="${d.id}">Kick</button>
          <button type="button" class="btn btn-stamp btn-sm ban-btn" data-uid="${d.id}" ${banned ? "disabled" : ""}>Ban</button>
        </div>`;
    }).join("");

    membersList.querySelectorAll(".kick-btn").forEach((btn) => {
      btn.addEventListener("click", () => kickMember(btn.dataset.uid));
    });
    membersList.querySelectorAll(".ban-btn").forEach((btn) => {
      btn.addEventListener("click", () => banMember(btn.dataset.uid));
    });
  } catch (e) {
    console.error(e);
    membersList.innerHTML = `<div class="empty-state">${describeFirestoreError(e, "memuat anggota")}</div>`;
  }
}

async function kickMember(uid) {
  if (!confirm("Kick anggota ini? Dia masih bisa gabung lagi kalau buka channel ini lagi.")) return;
  try {
    await deleteDoc(doc(db, "channels", channelId, "members", uid));
    openMembersModal();
  } catch (e) {
    console.error(e);
    alert("Gagal kick, coba lagi.");
  }
}

async function banMember(uid) {
  if (!confirm("Ban anggota ini? Dia tidak akan bisa kirim pesan di channel ini lagi sampai di-unban.")) return;
  try {
    const chRef = doc(db, "channels", channelId);
    const chSnap = await getDoc(chRef);
    const current = (chSnap.data() && chSnap.data().bannedUids) || [];
    if (!current.includes(uid)) {
      await setDoc(chRef, { bannedUids: [...current, uid] }, { merge: true });
    }
    await deleteDoc(doc(db, "channels", channelId, "members", uid));
    openMembersModal();
  } catch (e) {
    console.error(e);
    alert("Gagal ban, coba lagi.");
  }
}

async function handleDeleteChannel() {
  if (!confirm("Hapus saluran ini? Tidak bisa dibatalkan.")) return;
  try {
    // Catatan: ini hanya menghapus dokumen channel-nya. Sub-collection
    // "messages"/"members" di dalamnya TIDAK ikut otomatis terhapus di
    // Firestore (perlu Cloud Function batch-delete kalau mau bersih total),
    // tapi channel-nya sendiri langsung hilang dari daftar & tidak bisa dibuka.
    await deleteDoc(doc(db, "channels", channelId));
    window.location.href = "community.html";
  } catch (e) {
    console.error(e);
    alert(describeFirestoreError(e, "hapus saluran"));
  }
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s || "";
  return d.innerHTML;
}
