// ===================================================================
// D' CopynPrint — Google Maps config
// Dipakai fitur "Isi otomatis dari Google Maps" di halaman Profil (tombol
// deteksi lokasi + peta preview dengan pin yang bisa digeser).
//
// Cara ambil API key:
//   1. Buka https://console.cloud.google.com/google/maps-apis/credentials
//      (bikin project baru kalau belum punya).
//   2. Di menu "APIs & Services > Library", aktifkan 2 API ini:
//        - Maps JavaScript API
//        - Geocoding API
//   3. Di "Credentials", bikin API key baru, lalu tempel di bawah ini.
//   4. (Disarankan) Batasi API key-nya ("Application restrictions" ->
//      HTTP referrers) ke domain tempat app ini di-hosting, biar key-nya
//      tidak disalahgunakan orang lain.
//
// Google kasih kuota gratis bulanan yang biasanya lebih dari cukup buat
// skala kecil-menengah, tapi tetap wajib aktifin billing di project-nya.
// ===================================================================
export const GOOGLE_MAPS_API_KEY = "GANTI_DENGAN_API_KEY_GOOGLE_MAPS_KAMU";
