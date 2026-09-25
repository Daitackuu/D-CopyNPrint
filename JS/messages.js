import { db } from "./firebase-config.js";
import { requireAuth, fmtDate, conversationId, usernameLabel, avatarHtml, describeFirestoreError } from "./app.js";
import { initShell } from "./shell.js";
import {
  sendFriendRequest, acceptFriendRequest, declineFriendRequest, removeFriend
} from "./friends.js";
import {
  doc, getDoc, setDoc, updateDoc, collection, addDoc, query, where,
  orderBy, onSnapshot, serverTimestamp, getDocs, limit
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const convList = document.getElementById("convList");
const chatHeader = document.getElementById("chatHeader");
const chatMessages = document.getElementById("chatMessages");
const chatInputRow = document.getElementById("chatInputRow");
const chatInput = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");
const userSearch = document.getElementById("userSearch");
const searchResults = document.getElementById("searchResults");

const tabBtnObrolan = document.getElementById("tabBtnObrolan");
const tabBtnTeman = document.getElementById("tabBtnTeman");
const tabObrolan = document.getElementById("tabObrolan");
const tabTeman = document.getElementById("tabTeman");
const friendReqBadge = document.getElementById("friendReqBadge");
const incomingRequests = document.getElementById("incomingRequests");
const friendsList = document.getElementById("friendsList");
const addFriendSearch = document.getElementById("addFriendSearch");
const addFriendResults = document.getElementById("addFriendResults");

const params = new URLSearchParams(window.location.search);
let me = null;
let myProfile = null;
let activeConvId = null;
let unsubMessages = null;
let lastConvRows = [];
let allUsersCache = null; // dimuat sekali, dipakai buat filter pencarian client-side
const userCache = new Map();

requireAuth(async (user, profile) => {
  me = user;
  myProfile = profile;
  initShell({ user, profile, active: "messages" });

  // Kalau dibuka dengan ?with=uid (dari tombol "Kirim pesan" di profil),
  // langsung buka/bikin percakapan itu.
  const withUid = params.get("with");
  if (withUid && withUid !== me.uid) {
    await openConversation(withUid);
  }

  // Daftar percakapan aku, urut dari yang terakhir aktif.
  const q = query(
    collection(db, "conversations"),
    where("participants", "array-contains", me.uid),
    orderBy("updatedAt", "desc")
  );
  onSnapshot(q, async (snap) => {
    try {
      const rows = await Promise.all(snap.docs.map(async (d) => {
        const c = d.data();
        const otherUid = c.participants.find((p) => p !== me.uid);
        const other = await getUserCached(otherUid);
        return { id: d.id, otherUid, other, lastMessage: c.lastMessage || "", updatedAt: c.updatedAt };
      }));
      lastConvRows = rows;
      renderConvList(rows);
    } catch (e) {
      console.error(e);
      convList.innerHTML = `<div class="empty-state">Gagal memuat percakapan (coba refresh halaman).</div>`;
    }
  }, (err) => {
    // Tanpa handler ini, kalau firestore.rules belum dipublish ulang,
    // daftar percakapan akan diam selamanya di "Memuat percakapan…".
    console.error(err);
    convList.innerHTML = `<div class="empty-state">${describeFirestoreError(err, "memuat percakapan")}</div>`;
  });

  sendBtn.addEventListener("click", sendMessage);
  chatInput.addEventListener("keydown", (e) => { if (e.key === "Enter") sendMessage(); });

  // ---- search bar: cari pengguna buat mulai chat baru ----
  userSearch.addEventListener("input", () => {
    const term = userSearch.value.trim().toLowerCase();
    if (!term) {
      searchResults.classList.add("hidden");
      searchResults.innerHTML = "";
      return;
    }
    runUserSearch(term, searchResults, async (uid) => {
      userSearch.value = "";
      searchResults.classList.add("hidden");
      searchResults.innerHTML = "";
      await openConversation(uid);
    });
  });

  // ---- tab switching: Obrolan <-> Teman (sistem yang sudah ada di atas
  // TIDAK berubah sama sekali — ini cuma nambah panel baru di sebelahnya) ----
  tabBtnObrolan.addEventListener("click", () => switchTab("obrolan"));
  tabBtnTeman.addEventListener("click", () => switchTab("teman"));

  // ---- tab Teman: permintaan masuk, daftar teman, cari & tambah teman ----
  loadIncomingRequests();
  loadFriendsList();

  addFriendSearch.addEventListener("input", () => {
    const term = addFriendSearch.value.trim().toLowerCase();
    if (!term) {
      addFriendResults.classList.add("hidden");
      addFriendResults.innerHTML = "";
      return;
    }
    runUserSearch(term, addFriendResults, async (uid, displayName) => {
      addFriendSearch.value = "";
      addFriendResults.classList.add("hidden");
      addFriendResults.innerHTML = "";
      try {
        await sendFriendRequest(me.uid, myProfile.displayName || me.email.split("@")[0], me.email, uid);
        alert(`Permintaan pertemanan terkirim ke ${displayName}.`);
      } catch (e) {
        console.error(e);
        alert("Gagal kirim permintaan, coba lagi.");
      }
    });
  });
});

function switchTab(tab) {
  const isObrolan = tab === "obrolan";
  tabObrolan.classList.toggle("hidden", !isObrolan);
  tabTeman.classList.toggle("hidden", isObrolan);
  tabBtnObrolan.classList.toggle("active", isObrolan);
  tabBtnTeman.classList.toggle("active", !isObrolan);
}

// ---------------------------------------------------------------------
// Tab Teman: permintaan pertemanan masuk
// ---------------------------------------------------------------------
function loadIncomingRequests() {
  const q = query(collection(db, "users", me.uid, "friendRequests"), orderBy("createdAt", "desc"));
  onSnapshot(q, (snap) => {
    const rows = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
    friendReqBadge.textContent = String(rows.length);
    friendReqBadge.classList.toggle("hidden", rows.length === 0);

    if (rows.length === 0) {
      incomingRequests.innerHTML = `<div class="empty-state">Nggak ada permintaan pertemanan masuk.</div>`;
      return;
    }
    incomingRequests.innerHTML = rows.map((r) => `
      <div class="friend-row">
        <div class="friend-row-info">
          ${avatarHtml(r)}
          <span>${escapeHtml(r.fromDisplayName || r.fromEmail)}</span>
        </div>
        <div class="friend-row-actions">
          <button class="btn btn-primary" data-accept="${r.uid}">Terima</button>
          <button class="btn btn-outline" data-decline="${r.uid}">Tolak</button>
        </div>
      </div>
    `).join("");

    incomingRequests.querySelectorAll("[data-accept]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await acceptFriendRequest(me.uid, btn.dataset.accept);
          loadFriendsList();
        } catch (e) {
          console.error(e);
          alert("Gagal menerima permintaan, coba lagi.");
        }
      });
    });
    incomingRequests.querySelectorAll("[data-decline]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await declineFriendRequest(me.uid, btn.dataset.decline);
        } catch (e) {
          console.error(e);
          alert("Gagal menolak permintaan, coba lagi.");
        }
      });
    });
  }, (err) => {
    console.error(err);
    incomingRequests.innerHTML = `<div class="empty-state">${describeFirestoreError(err, "memuat permintaan")}</div>`;
  });
}

// ---------------------------------------------------------------------
// Tab Teman: daftar teman
// ---------------------------------------------------------------------
function loadFriendsList() {
  onSnapshot(collection(db, "users", me.uid, "friends"), async (snap) => {
    if (snap.empty) {
      friendsList.innerHTML = `<div class="empty-state">Belum ada teman. Cari pengguna di kolom atas buat kirim permintaan.</div>`;
      return;
    }
    try {
      const rows = await Promise.all(snap.docs.map(async (d) => {
        const other = await getUserCached(d.id);
        return { uid: d.id, other };
      }));
      friendsList.innerHTML = rows.map((r) => `
        <div class="friend-row">
          <div class="friend-row-info">
            ${avatarHtml(r.other)}
            <a href="profile.html?uid=${r.uid}">${escapeHtml(r.other.displayName || usernameLabel(r.other.email) || "user")}</a>
          </div>
          <div class="friend-row-actions">
            <button class="btn btn-outline" data-chat="${r.uid}">Chat</button>
            <button class="btn btn-outline" data-unfriend="${r.uid}">Hapus</button>
          </div>
        </div>
      `).join("");

      friendsList.querySelectorAll("[data-chat]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          switchTab("obrolan");
          await openConversation(btn.dataset.chat);
        });
      });
      friendsList.querySelectorAll("[data-unfriend]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!confirm("Hapus pertemanan ini?")) return;
          try {
            await removeFriend(me.uid, btn.dataset.unfriend);
          } catch (e) {
            console.error(e);
            alert("Gagal hapus, coba lagi.");
          }
        });
      });
    } catch (e) {
      console.error(e);
      friendsList.innerHTML = `<div class="empty-state">Gagal memuat daftar teman.</div>`;
    }
  }, (err) => {
    console.error(err);
    friendsList.innerHTML = `<div class="empty-state">${describeFirestoreError(err, "memuat daftar teman")}</div>`;
  });
}

// Dipakai bareng oleh search bar "mulai chat baru" (tab Obrolan) dan
// search bar "tambah teman" (tab Teman) — resultsEl beda, onPick beda.
async function runUserSearch(term, resultsEl, onPick) {
  try {
    if (!allUsersCache) {
      // Dimuat sekali (maks 200 user), lalu difilter di client — cukup
      // buat skala komunitas kecil-menengah tanpa perlu index pencarian teks.
      const snap = await getDocs(query(collection(db, "users"), limit(200)));
      allUsersCache = snap.docs
        .filter((d) => d.id !== me.uid)
        .map((d) => ({ uid: d.id, ...d.data() }));
    }
    const matches = allUsersCache.filter((u) => {
      const name = (u.displayName || "").toLowerCase();
      const email = (u.email || "").toLowerCase();
      const username = (u.username || "").toLowerCase();
      return name.includes(term) || username.includes(term) || email.includes(term);
    }).slice(0, 8);

    if (matches.length === 0) {
      resultsEl.innerHTML = `<div class="empty-state">Tidak ada pengguna dengan nama/email itu.</div>`;
    } else {
      resultsEl.innerHTML = matches.map((u) => `
        <div class="search-result-item" data-uid="${u.uid}" data-name="${escapeHtml(u.displayName || usernameLabel(u.email))}">
          ${avatarHtml(u)}
          <span>${escapeHtml(u.displayName || usernameLabel(u.email))}</span>
        </div>
      `).join("");
      resultsEl.querySelectorAll(".search-result-item").forEach((el) => {
        el.addEventListener("click", () => onPick(el.dataset.uid, el.dataset.name));
      });
    }
    resultsEl.classList.remove("hidden");
  } catch (e) {
    console.error(e);
    resultsEl.innerHTML = `<div class="empty-state">Gagal mencari pengguna, coba lagi.</div>`;
    resultsEl.classList.remove("hidden");
  }
}

async function getUserCached(uid) {
  if (userCache.has(uid)) return userCache.get(uid);
  const snap = await getDoc(doc(db, "users", uid));
  const data = snap.exists() ? snap.data() : { displayName: "(user dihapus)", email: "" };
  userCache.set(uid, data);
  return data;
}

function renderConvList(rows) {
  if (rows.length === 0) {
    convList.innerHTML = `<div class="empty-state">Belum ada percakapan. Kirim pesan lewat halaman profil seseorang.</div>`;
    return;
  }
  convList.innerHTML = rows.map((r) => `
    <a class="conv-item ${r.id === activeConvId ? "active" : ""}" data-id="${r.id}" data-uid="${r.otherUid}">
      ${avatarHtml(r.other, "sm")}
      <div class="conv-item-info">
        <div class="conv-item-name">${escapeHtml(r.other.displayName || usernameLabel(r.other.email) || "user")}</div>
        <span class="conv-preview">${escapeHtml(r.lastMessage)}</span>
      </div>
    </a>
  `).join("");
  convList.querySelectorAll(".conv-item").forEach((el) => {
    el.addEventListener("click", () => openConversation(el.dataset.uid, el.dataset.id));
  });
}

async function openConversation(otherUid, knownConvId = null) {
  const convId = knownConvId || conversationId(me.uid, otherUid);
  activeConvId = convId;

  try {
    const ref = doc(db, "conversations", convId);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        participants: [me.uid, otherUid].sort(),
        lastMessage: "",
        updatedAt: serverTimestamp()
      });
    }

    const other = await getUserCached(otherUid);
    chatHeader.innerHTML = `
      <a href="profile.html?uid=${encodeURIComponent(otherUid)}" class="chat-header-identity" title="Lihat profil">
        ${avatarHtml(other, "sm")}
        <span>${escapeHtml(other.displayName || usernameLabel(other.email) || "user")}</span>
      </a>`;
    chatInputRow.classList.remove("hidden");

    if (unsubMessages) unsubMessages();
    const mq = query(collection(db, "conversations", convId, "messages"), orderBy("createdAt", "asc"));
    unsubMessages = onSnapshot(mq, (msnap) => {
      renderMessages(msnap.docs.map((d) => d.data()));
    }, (err) => {
      console.error(err);
      chatMessages.innerHTML = `<div class="empty-state">${describeFirestoreError(err, "memuat pesan")}</div>`;
    });

    convList.querySelectorAll(".conv-item").forEach((el) => {
      el.classList.toggle("active", el.dataset.id === convId);
    });
  } catch (e) {
    console.error(e);
    chatHeader.textContent = "Gagal membuka percakapan, coba lagi.";
  }
}

function renderMessages(msgs) {
  if (msgs.length === 0) {
    chatMessages.innerHTML = `<div class="empty-state">Belum ada pesan. Mulai obrolan!</div>`;
  } else {
    chatMessages.innerHTML = msgs.map((m) => `
      <div class="msg-bubble ${m.senderId === me.uid ? "msg-mine" : "msg-theirs"}">
        ${escapeHtml(m.text)}
      </div>
    `).join("");
  }
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function sendMessage() {
  const text = chatInput.value.trim();
  if (!text || !activeConvId) return;
  chatInput.value = "";
  try {
    await addDoc(collection(db, "conversations", activeConvId, "messages"), {
      senderId: me.uid,
      text,
      createdAt: serverTimestamp()
    });
    await updateDoc(doc(db, "conversations", activeConvId), {
      lastMessage: text,
      updatedAt: serverTimestamp()
    });
  } catch (e) {
    console.error(e);
  }
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s || "";
  return d.innerHTML;
}
