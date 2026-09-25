// ===================================================================
// D' CopynPrint — helper Firestore buat sistem pertemanan ala Discord.
// File ini SENGAJA tidak menyentuh DOM sama sekali, supaya aman
// di-import dari halaman mana pun (profile.js, messages.js) tanpa
// resiko bentrok/crash gara-gara elemen HTML yang beda tiap halaman.
//
// Struktur data:
//   users/{uid}/friendRequests/{fromUid}  — permintaan MASUK yang
//     belum direspon (dokumen ada = ada permintaan pending)
//   users/{uid}/friends/{friendUid}       — pertemanan mutual, dibuat
//     di KEDUA sisi sekaligus saat permintaan diterima
// ===================================================================
import { db } from "./firebase-config.js";
import {
  doc, setDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

export async function sendFriendRequest(meUid, meDisplayName, meEmail, targetUid) {
  await setDoc(doc(db, "users", targetUid, "friendRequests", meUid), {
    fromDisplayName: meDisplayName,
    fromEmail: meEmail,
    createdAt: serverTimestamp()
  });
}

export async function cancelFriendRequest(meUid, targetUid) {
  await deleteDoc(doc(db, "users", targetUid, "friendRequests", meUid));
}

export async function declineFriendRequest(meUid, fromUid) {
  await deleteDoc(doc(db, "users", meUid, "friendRequests", fromUid));
}

export async function acceptFriendRequest(meUid, fromUid) {
  const now = serverTimestamp();
  await Promise.all([
    setDoc(doc(db, "users", meUid, "friends", fromUid), { createdAt: now }),
    setDoc(doc(db, "users", fromUid, "friends", meUid), { createdAt: now }),
    deleteDoc(doc(db, "users", meUid, "friendRequests", fromUid))
  ]);
}

export async function removeFriend(meUid, otherUid) {
  await Promise.all([
    deleteDoc(doc(db, "users", meUid, "friends", otherUid)),
    deleteDoc(doc(db, "users", otherUid, "friends", meUid))
  ]);
}
