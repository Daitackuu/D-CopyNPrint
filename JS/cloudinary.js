// ===================================================================
// D' CopynPrint — helper upload file ke Cloudinary (dipakai bareng oleh
// beberapa halaman: home.js sudah punya versinya sendiri untuk upload
// print job; ini dipakai buat foto profil & gambar postingan).
// ===================================================================
import { CLOUDINARY_CLOUD_NAME, CLOUDINARY_UPLOAD_PRESET } from "./cloudinary-config.js";

export function uploadToCloudinary(file, onProgress) {
  return new Promise((resolve, reject) => {
    const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`;
    const form = new FormData();
    form.append("file", file);
    form.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    if (onProgress) {
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) onProgress((e.loaded / e.total) * 100);
      });
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const data = JSON.parse(xhr.responseText);
        resolve(data.secure_url);
      } else {
        reject(new Error("Upload gagal: " + xhr.status));
      }
    };
    xhr.onerror = () => reject(new Error("Koneksi upload gagal"));
    xhr.send(form);
  });
}
