// ===================================================================
// D' CopynPrint — Firebase init
// Ganti object di bawah ini dengan config project Firebase kamu sendiri.
// Cara ambil: Firebase Console → Project Settings → General →
// "Your apps" → Web app → SDK setup and configuration.
// ===================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
// Catatan: Firebase Storage TIDAK dipakai lagi — file penyimpanan file
// upload sekarang pakai Cloudinary (gratis, tanpa kartu). Lihat
// js/cloudinary-config.js.

const firebaseConfig = {
  apiKey: "AIzaSyBN1pXsXb-tEXlWSqn8mcvkk4nCwzLwU88",
  authDomain: "d-coprint.firebaseapp.com",
  projectId: "d-coprint",
  messagingSenderId: "289991968212",
  appId: "1:289991968212:web:89ed50c415cb9311520241"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
