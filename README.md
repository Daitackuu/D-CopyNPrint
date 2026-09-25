# D' CopynPrint

Web upload-untuk-print: customer upload file (PDF/Word/gambar), file langsung
dikirim ke akun operator print yang sedang online — tanpa perlu ke toko print.
Ada juga profil, komunitas (channel), dan pesan/pertemanan ala Discord.

> **Terakhir diupdate:** 24 September 2026 (lihat "Riwayat perubahan" di
> paling bawah). Daftar ikon/gambar yang wajib ada ada di
> [`Resources/INSTRUKSI.md`](Resources/INSTRUKSI.md).

## Teknologi & tempat data disimpan

| Apa                                   | Disimpan/dijalankan di                                   |
|----------------------------------------|-----------------------------------------------------------|
| Login (username + password)            | Firebase Authentication (Email/Password)                 |
| Data (user, pesanan, channel, chat)    | Cloud Firestore                                          |
| File upload customer, foto profil/channel, gambar postingan | **Cloudinary** (bukan Firebase Storage) |
| Daftar Provinsi & Kota/Kabupaten       | API statis publik **emsifa v2** (`www.emsifa.com/api-wilayah-indonesia/v2/`), cadangan API versi lamanya di domain yang sama — tanpa key |
| Tombol "Isi otomatis dari Google Maps" + peta | Google Maps JavaScript API + Geocoding API (opsional, butuh API key) |
| Hosting                                | GitHub Pages saat ini (`https://daitackuu.github.io/D-CopyNPrint/`); Firebase Hosting bisa jadi alternatif |

Web ini **murni client-side** (HTML + CSS + JavaScript module, tanpa server
sendiri dan tanpa build step) — jadi semua "logika keamanan" sebenarnya ada di
`firestore.rules`, bukan di JavaScript.

## Struktur folder

```
D-CopyNPrint/
├── index.html            → langsung redirect ke HTML/home.html
├── HTML/                 → semua halaman (lihat tabel di bawah)
├── CSS/style.css         → satu file CSS buat semua halaman
├── JS/                   → satu file JS per halaman + helper bersama
│   ├── app.js            → helper bersama: auth guard, username, kode pesanan, ikon, error Firestore, popup alasan
│   ├── shell.js          → sidebar, topbar, bubble menu developer, popup notif pesanan, modal Kontak CS
│   ├── cloudinary.js     → helper upload ke Cloudinary (profil/channel/postingan)
│   ├── *-config.js       → firebase, cloudinary, maps, support (nomor WA CS) — WAJIB diisi
│   └── home.js, printer.js, job.js, profile.js, community.js, channel.js,
│       messages.js, friends.js, users.js, printers.js
├── JSON/firestore.indexes.json → composite index Firestore
├── firestore.rules       → aturan keamanan Firestore (WAJIB di-publish)
├── Resources/            → Icons/ (27 PNG), Images/Default-Avatar.png, INSTRUKSI.md
├── sitemap.xml, robots.txt
└── README.md
```

### Halaman

| Halaman             | Isi                                                                    | Ditujukan untuk |
|---------------------|-------------------------------------------------------------------------|-----------------------|
| `login.html`        | Masuk / Daftar (username + password, kolom Kode Web ID saat Daftar)   | Semua                 |
| `home.html`         | Upload file + riwayat print customer (menu sidebar "Printer")          | Semua bisa lihat; **login baru diwajibkan saat mau upload** |
| `job.html?id=…`     | Detail Pesanan (kode pesanan, info file, bio pihak lawan, batalkan)    | Customer & operator pesanan itu |
| `printer.html`      | Dashboard Operator (toggle online, pesanan masuk, antrean, pendapatan) | Operator (`printer`) & developer |
| `profile.html`      | Profil sendiri (edit, lokasi, akun, riwayat) / profil orang lain (`?uid=…`) | Login |
| `community.html`    | Daftar channel + cari + buat channel                                    | Login |
| `channel.html?id=…` | Ruang obrolan publik satu channel (+ Edit/Kelola Anggota/Hapus untuk pemilik) | Login |
| `messages.html`     | Tab **Obrolan** (DM real-time) & tab **Teman** (permintaan pertemanan) | Login |
| `users.html`        | Kelola User (ubah role, Ban/Buka blokir, Hapus)                        | Developer |
| `printers.html`     | Daftar operator + status online/offline                                 | Developer |

> Halaman `printer`, `users`, dan `printers` hanya *ditujukan* untuk role
> tertentu (menunya cuma ditampilkan ke role itu), tapi yang benar-benar
> membatasi akses data adalah `firestore.rules` — bukan JavaScript halamannya.
> Makanya rules wajib selalu di-publish (lihat Setup 1).

## Cara kerja singkat

1. Buka web → `index.html` → `home.html`. Siapa pun boleh lihat halamannya;
   login baru diminta saat mau upload.
2. Customer klik panah di tombol upload buat pilih tipe file (PDF / Word /
   gambar). Dropdown **ukuran kertas** (A4/A5/A3/F4/Letter/Custom) baru muncul
   setelah tipe dipilih. Kalau tombol utama dipencet sebelum pilih tipe, muncul
   popup **Batal / Pilih tipe**.
3. File naik ke **Cloudinary**, lalu dibuat dokumen di Firestore
   (`printJobs`) dengan **kode pesanan acak** (mis. `CP-A3K9X2`). Customer
   **wajib sudah mengisi lokasi lengkap** (Provinsi, Kota/Kabupaten,
   Kecamatan, Kelurahan/Desa) di Profil — kalau belum, upload ditolak dengan
   pesan. Sistem memilih satu operator yang sedang `online` **DAN wilayahnya
   sama persis** dengan customer (keempat tingkat sama) secara acak:
   - Ada operator online di wilayah itu → status `pending` (menunggu operator
     konfirmasi).
   - Tidak ada → status `waiting`; dilempar otomatis ke operator pertama
     **di wilayah yang sama** yang online berikutnya (diklaim lewat
     transaction di `printer.js`). Operator di wilayah lain tidak melihatnya.
4. Operator (`printer.html`) lihat **Pesanan masuk** → **Terima** (isi harga →
   `queued`) atau **Tolak** (pilih alasan → order dilempar ke operator LAIN di
   wilayah yang sama yang belum menolak: langsung `pending` kalau ada yang
   online, `waiting` kalau semuanya offline. Kalau SEMUA operator di wilayah itu
   sudah menolak, status jadi `rejected` dan order tidak bisa diterima siapa
   pun; customer tetap bisa membatalkan selama masih `waiting`/`pending`). Lalu **Mulai print** (`printing`, otomatis download file) →
   **Tandai selesai** (`done`).
5. Customer bisa **Batal** selama pesanan masih `waiting`/`pending` (pilih
   alasan); status jadi `cancelled`.
6. Operator & developer dapat **popup "Ada pesanan belum diterima!"** di
   halaman mana pun (dengan tombol *Lihat pesanan* dan *Ingatkan aku nanti*).
7. Developer punya **bubble menu** bulat di pojok kanan bawah (Kelola User,
   Printers, Dashboard Operator) — cuma muncul kalau role `developer`.

### Status pesanan (`printJobs.status`)

| Status      | Arti                                                        | Label di UI |
|-------------|--------------------------------------------------------------|-------------|
| `waiting`   | Belum ada operator online / baru ditolak operator            | Menunggu operator |
| `pending`   | Sudah ditugaskan ke satu operator, menunggu dia Terima/Tolak | Menunggu konfirmasi operator |
| `queued`    | Diterima operator, harga sudah diisi                         | Antre |
| `printing`  | Sedang dicetak                                               | Diprint |
| `done`      | Selesai                                                      | Selesai |
| `cancelled` | Dibatalkan customer (sebelum diterima)                       | Dibatalkan |
| `rejected`  | SEMUA operator di wilayah customer sudah menolak (final, tidak bisa diterima lagi) | Ditolak semua operator |

## Akun & login

- Login pakai **username + password** saja. Di balik layar username diubah
  jadi email palsu `username@dcoprint.local` karena Firebase Auth butuh
  email (`JS/app.js` → `usernameToEmail`). Username: 3–20 karakter, huruf
  kecil/angka/titik/underscore. Username yang sudah dipakai otomatis
  ditolak Firebase.
- Saat **Daftar** ada kolom **Email** (email asli, opsional/kontak — disimpan
  di `contactEmail`, TIDAK dipakai buat login) dan **Kode Web ID**.
- Enter di form Masuk/Daftar langsung submit.
- Akun yang di-**ban** developer otomatis di-logout dan diarahkan ke
  `login.html?banned=1` (muncul pesan diblokir).
- Tombol **Switch akun** di Profil → Akun cuma muncul kalau di browser itu
  pernah login/daftar lebih dari 1 username (daftar username disimpan di
  `localStorage`, tanpa password).

### Kode Web ID (cara cepat bikin akun developer/operator)

| Kode diisi     | Role yang didapat |
|----------------|--------------------|
| `CENSORED`     | `developer`        |
| `CENSORED`     | `printer`          |
| `(dikosongkan)`| `customer` (default) |

⚠️ **Soal keamanan:** kode ini ada di kode sumber yang bisa dibuka siapa saja
(`JS/app.js`, fungsi `roleFromWebID`). Siapa pun yang tahu `DP-DEV` bisa daftar
jadi developer penuh. Cocok buat bikin akun developer pertama dengan cepat,
**tapi sebelum web dipromosikan ke publik, ganti kodenya** jadi rahasia yang
cuma kamu tahu, atau hapus jalur ini dan ubah field `role` manual lewat
Firebase Console → Firestore → koleksi `users`.

⚠️ **Kode Web ID cuma jalan saat *Daftar akun baru*, bukan saat Masuk.** Role
ditentukan sekali di `ensureUserDoc()` pas dokumen `users/{uid}` pertama kali
dibuat. Kalau akunnya sudah ada (atau dokumennya sempat dihapus lewat Kelola
User lalu login lagi → dibuat ulang sebagai `customer`), mengisi kode di
mode Masuk tidak mengubah apa-apa. Solusi: daftar pakai username baru + kode,
atau ubah field `role` manual di Firestore Console.

## Fitur per halaman

### Navigasi (sidebar kiri ala Discord)
Dibangun `JS/shell.js` (`initShell()`), dipakai semua halaman setelah `home`.
Isi: **Printer** (`home.html`; label "Upload" berubah jadi "Printer" untuk
akun operator), **Komunitas**, **Pesan**. Paling bawah: panel user (foto +
username + role) → klik ke Profil. Guest cuma lihat **Printer** dan
**Masuk / Daftar**. Di layar kecil sidebar jadi drawer. Bar atas berisi
tombol **Kontak CS**. Link "Dashboard Operator" sengaja **tidak** ada di
sidebar: operator masuk lewat kartu "Kamu login sebagai Operator Print" di
`home.html` (tombol *Buka Dashboard Operator*), developer lewat bubble menu.

### Upload & riwayat (`home.html`)
Riwayat print customer menampilkan kode pesanan, tanggal, ukuran kertas,
harga (kalau sudah ada), status, tombol **Detail Info**, dan tombol **Batal**
(cuma saat `waiting`/`pending`).

### Dashboard Operator (`printer.html`)
Toggle **online/offline**; **Pesanan masuk** (Terima + isi harga / Tolak +
alasan); **File untuk diprint** (Mulai print → Tandai selesai); **Buka file**
(preview di tab baru) dan **Simpan file** (download dengan nama asli lewat
flag `fl_attachment` Cloudinary — baru muncul setelah *Mulai print*);
**Notif WA** manual ke customer (buka `wa.me` dengan pesan terisi, kalau
customer sudah isi No. WhatsApp). Ini bukan WhatsApp Business API.

### Detail Pesanan (`job.html`)
Menampilkan kode pesanan (bisa disalin), nama/ukuran file, tanggal (upload,
diterima, mulai print, selesai — yang belum terjadi disembunyikan), harga,
alasan batal/tolak kalau ada, dan **kartu bio pihak lawan**: customer lihat
bio operator (foto, nama, bio, link chat WhatsApp, kalau sudah diisi),
operator lihat bio customer. Kalau belum ada operator yang menerima, tampil
"Belum ada yang mau menerima dokumen kamu untuk diprint."

### Profil (`profile.html`)
- Edit **nama tampilan**, **bio**, **foto profil** (klik avatar).
- **No. WhatsApp** — opsional, **WAJIB untuk role `printer`** (label berubah
  jadi "wajib diisi"; Simpan ditolak kalau kosong), karena customer
  menghubungi operator lewat nomor ini.
- **Lokasi** — opsional saat mengisi profil, tapi **wajib lengkap (4 tingkat)
  untuk role `printer`** (Simpan ditolak kalau ada yang kosong) dan wajib
  lengkap untuk customer sebelum bisa upload pesanan. Lihat bagian khusus di
  bawah.
- Postingan gaya IG (teks/gambar, tombol **+**, like, komentar),
  follow/unfollow, tombol **Tambah teman**.
- **Riwayat & Pendapatan**: customer lihat riwayat upload; operator lihat
  riwayat job + total pendapatan (jumlah `price` semua job `done`).
- **Akun**: Switch akun & Keluar.

### Komunitas & Channel
Siapa pun yang login boleh **Buat channel** (nama + deskripsi). Pemilik bisa
**Edit Saluran** (nama, deskripsi, foto), **Kelola Anggota** (lihat siapa yang
pernah membuka channel, **Kick** sementara / **Ban** permanen lewat
`bannedUids`), dan **Hapus Saluran**. Klik foto/nama pengirim di chat membuka
profil orang itu. Semua channel publik.

### Pesan (`messages.html`)
Tab **Obrolan**: DM real-time + pencarian pengguna buat mulai chat baru
(pertemanan tidak menghalangi DM). Tab **Teman**: kirim/terima/tolak
permintaan, daftar teman, badge jumlah permintaan masuk.

### Kelola User (`users.html`, developer)
Ubah role lewat dropdown, **Ban / Buka blokir**, dan **Hapus**. Hapus
menghapus dokumen di Firestore, **bukan** akun Firebase Auth-nya (tidak bisa
dari client) — kalau orangnya login lagi, dokumennya dibuat ulang sebagai
`customer`. Ini bukan bug role "ke-reset".

### Kontak CS
Tombol **Kontak CS** membuka modal formulir (username, email, keluhan) —
otomatis terisi dari profil kalau login — lalu kirim ke WhatsApp. Nomor
tujuan diatur di `JS/support-config.js` (`SUPPORT_WA_NUMBER`, format
internasional tanpa `+`, dan `SUPPORT_WA_MESSAGE`).

## Form lokasi di Profil (Provinsi, Kota/Kabupaten, Kecamatan, Kelurahan/Desa, Kode Pos)

Lima field, ditambah satu kolom opsional buat detail alamat lengkap.

1. **Provinsi** — dropdown daftar provinsi Indonesia.
2. **Kota / Kabupaten** — terkunci ("Pilih provinsi dulu") sampai provinsi
   dipilih, lalu berisi kota/kabupaten provinsi itu.
3. **Kecamatan** — terkunci sampai kota/kabupaten dipilih, lalu berisi
   kecamatan di kota/kabupaten itu.
4. **Kelurahan / Desa** — terkunci sampai kecamatan dipilih, lalu berisi
   kelurahan/desa di kecamatan itu.
5. **Kode Pos** — isian teks manual.
6. **Detail alamat: jalan, nomor rumah, RT/RW, patokan (opsional)** — field
   `location.streetDetail`, kotaknya disembunyikan di balik tombol accordion
   (buka/tutup) persis seperti kolom **Kode Web ID** di halaman Masuk/Daftar
   — teks tombolnya "(opsional)", diklik dulu baru kolom isiannya muncul.
   Ditampilkan di form Edit profil buat **semua role** (customer, operator
   print, developer), bukan cuma operator. Kalau sebelumnya sudah pernah
   diisi, kolomnya otomatis kebuka lagi pas halaman Profil dibuka (bukan
   ketutup) biar isinya kelihatan. Field ini murni buat catatan pribadi user
   sendiri — **tidak** ikut ditampilkan di profil publik (yang dilihat orang
   lain) atau disalin ke dokumen pesanan (`customerLocation`); yang dipakai
   buat pencocokan customer↔operator maupun ditampilkan ke operator di
   `job.html`/`printer.html` tetap cuma 4 tingkat wilayah (Provinsi →
   Kelurahan/Desa).
7. Tombol **"Isi otomatis dari Google Maps"** — deteksi lokasi + peta preview
   dengan pin yang bisa digeser; hasilnya dicocokkan ke keempat dropdown
   (Provinsi → Kelurahan/Desa, awalan "Kecamatan"/"Kelurahan"/"Desa" tidak
   mempengaruhi pencocokan) dan mengisi Kode Pos. Mengganti pilihan di satu
   tingkat otomatis mengosongkan & memuat ulang tingkat di bawahnya.

Endpoint data wilayah (semua dari emsifa, dengan cadangan API lama):
`/provinces.json`, `/regencies/{province_id}.json`,
`/districts/{regency_id}.json`, `/villages/{district_id}.json`.

**Aturan kotak "Tulis nama … kamu" (isi sendiri):** kotak teks itu **tersembunyi
secara default** dan **hanya muncul kalau kamu memilih "Tidak ada di daftar (tulis sendiri)"
di dropdown-nya** (masing-masing untuk tiap tingkat). Kalau dropdown diganti
ke pilihan lain, kotaknya hilang lagi dan isinya dikosongkan. Detail
perilakunya:

- Pilih tingkat biasa → dropdown tingkat di bawahnya berisi daftarnya +
  opsi "Tidak ada di daftar (tulis sendiri)".
- Pilih **"Tidak ada di daftar (tulis sendiri)"** di suatu tingkat → kotaknya muncul;
  dropdown tingkat di bawahnya tetap aktif tapi isinya cuma "Pilih …" +
  "Tidak ada di daftar (tulis sendiri)" (nggak ada daftar buat wilayah buatan sendiri).
- **Data tersimpan atau hasil deteksi Google Maps yang namanya nggak ada di
  daftar resmi** → kotak tulis sendiri TIDAK dibuka otomatis. Dropdown tetap
  di "Pilih …", muncul pesan yang menyebut nama tadi, dan tingkat di
  bawahnya dikunci sampai user memilih sendiri "Tidak ada di daftar (tulis
  sendiri)" lalu mengetik namanya.
- Kalau daftar wilayah gagal dimuat (internet mati / CDN diblok), tingkat
  yang gagal memuat menampilkan pesan error dan tetap bisa diisi lewat
  "Tidak ada di daftar (tulis sendiri)". Fetch dibatasi 6 detik per sumber (API v2 dulu,
  lalu API versi lama sebagai cadangan).

### Aturan pencocokan wilayah customer ↔ operator

Order **hanya** sampai ke dashboard operator yang **Provinsi, Kota/Kabupaten,
Kecamatan, dan Kelurahan/Desa-nya sama semua** dengan customer.

- Tiap user yang menyimpan profil mendapat field `regionKey` — gabungan
  keempat tingkat yang sudah dinormalisasi, mis.
  `jawa timur|kota malang|klojen|kauman` (huruf kecil, spasi dirapikan,
  awalan Kecamatan/Kelurahan/Desa dibuang, "Daerah Khusus Ibukota Jakarta" =
  "DKI Jakarta"). Kalau ada tingkat yang kosong, `regionKey` = `""` dan
  user itu tidak cocok dengan siapa pun.
- Saat upload, pesanan menyimpan `regionKey` + `customerLocation`
  (provinsi/kota/kecamatan/kelurahan, tanpa koordinat). Operator dipilih
  dengan query `role == printer`, `online == true`, `regionKey == …`.
- Job `waiting` cuma bisa dibaca & diklaim operator dengan `regionKey` yang
  sama (dijaga `firestore.rules`, bukan cuma JavaScript). Pesanan baru juga
  ditolak rules kalau `regionKey`-nya tidak sama dengan profil pembuatnya
  atau operator yang dituju wilayahnya beda.
- Dashboard operator: "Pesanan masuk" dan popup notifikasi hanya
  menampilkan order pending dengan `regionKey` yang sama dengan operator
  sekarang. Kalau operator pindah wilayah, order pending wilayah lama
  dilepas balik ke `waiting` otomatis. Order yang sudah diterima
  (`queued`/`printing`/`done`) tidak diganggu. Order lama tanpa `regionKey`
  (dibuat sebelum fitur ini) dibiarkan apa adanya.
- Mau dilonggarkan (mis. cukup sampai kecamatan)? Kurangi isi
  `REGION_LEVELS` di `JS/app.js`, lalu semua user perlu simpan ulang profil
  supaya `regionKey`-nya dihitung ulang.

Field yang tersimpan di `users/{uid}.location`: `province`, `city`,
`district` (kecamatan), `village` (kelurahan/desa), `postalCode`, `lat`,
`lng`, ditambah `users/{uid}.regionKey` (lihat aturan pencocokan di atas). (Field lama `street`/`houseNumber`/`rtRw`/
`landmark` kalau masih ada di data lama tidak ditampilkan lagi dan tidak ikut
tersimpan ulang saat klik Simpan.)

---

# Setup

## 1. Setup Firebase (Auth + Firestore saja — TANPA Storage/kartu)

1. Buka https://console.firebase.google.com → **Add project**.
2. **Build → Authentication → Get started** → aktifkan **Email/Password**.
3. **Build → Firestore Database → Create database** (mode production).
4. **Project settings → General → Your apps → Web (`</>`)**, daftarkan app,
   copy object `firebaseConfig`.
5. Tempel ke `JS/firebase-config.js`, ganti semua nilai `"GANTI_..."`.
6. Publish rules: copy isi `firestore.rules` ke tab **Rules** di Firestore
   Console → **Publish**. **Ulangi setiap `firestore.rules` berubah.**
7. Buat composite index dari `JSON/firestore.indexes.json` (lihat
   "Troubleshooting" — cara paling gampang: klik link di pesan error).

Firebase **Storage tidak dipakai** — file upload pakai Cloudinary, jadi tidak
perlu plan Blaze/kartu.

> Repo ini **tidak menyertakan `firebase.json`**. Kalau mau deploy rules/index
> lewat CLI: `firebase init firestore`, arahkan rules ke `firestore.rules` dan
> indexes ke `JSON/firestore.indexes.json`, lalu
> `firebase deploy --only firestore:rules,firestore:indexes`.

## 2. Setup Cloudinary (gratis, tanpa kartu)

1. Daftar di https://cloudinary.com/users/register/free.
2. Di **Dashboard** copy **Cloud name**.
3. **Settings → Upload → Upload presets → Add upload preset**: **Signing mode
   = Unsigned** (wajib), folder opsional (mis. `dcopynprint-jobs`), simpan,
   copy nama preset.
4. Isi `JS/cloudinary-config.js`: `GANTI_CLOUD_NAME_KAMU` dan
   `GANTI_UPLOAD_PRESET_KAMU`.
5. Kalau `.doc`/`.docx` gagal upload, cek **Allowed formats** di preset —
   kosongkan (semua format) atau isi `doc,docx,pdf,png,jpg,jpeg`.

## 3. Setup Google Maps (opsional — cuma buat tombol "Isi otomatis")

Tanpa ini, form lokasi tetap bisa dipakai penuh secara manual (dropdown
Provinsi/Kota tidak butuh Google sama sekali) — yang mati cuma tombol deteksi
& peta preview.

1. https://console.cloud.google.com/google/maps-apis/credentials (bikin
   project, **aktifkan billing** — ada kuota gratis bulanan).
2. **APIs & Services → Library**: aktifkan **Maps JavaScript API** dan
   **Geocoding API**.
3. **Credentials → Create credentials → API key**.
4. Isi `JS/maps-config.js` (`GOOGLE_MAPS_API_KEY`).
5. (Disarankan) **Application restrictions → HTTP referrers** ke domain
   hosting kamu, mis. `daitackuu.github.io/*`. Kalau kamu tes lokal pakai
   Live Server, tambahkan juga `127.0.0.1:5500/*` dan `localhost:5500/*` —
   kalau tidak, di localhost akan muncul kotak abu-abu "Ups! Ada sesuatu yang
   salah".

Script Google Maps baru dimuat pas dibutuhkan (tombol diklik, atau profil
sudah punya titik tersimpan). Kalau API key bermasalah, halaman menampilkan
pesan jelas (hook `gm_authFailure`) — **itu masalah setup key di Google Cloud,
bukan bug kode**: cek key, dua API aktif, billing aktif, dan domain sudah
masuk daftar referrer.

## 4. Push ke GitHub

**Pertama kali (repo masih kosong):**
```bash
cd D-CopyNPrint
git init
git add .
git commit -m "D' CopynPrint: initial version"
git branch -M main
git remote add origin https://github.com/Daitackuu/D-CopyNPrint.git
git push -u origin main
```

**Update dari folder/zip baru (repo sudah pernah di-push):**
1. Copy semua isi folder baru, paste ke folder lama, pilih **Replace**.
   **Jangan hapus/sentuh folder `.git`** di folder lama (tersembunyi; berisi
   riwayat commit + koneksi ke GitHub).
2. Buka **Git Bash** di folder lama (klik kanan → *Git Bash Here*, atau `cd`
   ke path-nya).
3. (Opsional) `git status` buat cek file yang berubah.
4. ```bash
   git add .
   git commit -m "Update: kotak isi sendiri di form lokasi cuma muncul kalau dipilih"
   git push
   ```
   `origin` & branch `main` sudah ke-set dari push pertama, jadi `git push`
   polos cukup. Kalau belum pernah di-set, jalankan dulu
   `git remote add origin https://github.com/Daitackuu/D-CopyNPrint.git` lalu
   `git push -u origin main`.

Setelah deploy, **hard refresh (Ctrl+Shift+R)** supaya browser tidak memakai
file JS/CSS lama dari cache.

## 5. Hosting

**Yang dipakai sekarang: GitHub Pages** — repo **Settings → Pages**, branch
`main`, root folder. Alamat: `https://daitackuu.github.io/D-CopyNPrint/`
(`index.html` di root redirect ke `HTML/home.html`; semua path di kode relatif,
jadi aman walau di subfolder).

**Alternatif: Firebase Hosting**
```bash
firebase init hosting   # public directory: "." (folder ini)
firebase deploy --only hosting
```
Hasilnya `https://NAMA-PROJECT.web.app`.

## 6. Google Search Console (opsional)

1. https://search.google.com/search-console → tambah property (URL web kamu).
2. Verifikasi kepemilikan (URL prefix + HTML tag, atau meta tag di `<head>`).
3. Ganti `GANTI-DOMAIN-KAMU` di `sitemap.xml` dan `robots.txt` dengan domain
   aslimu (sekarang **masih placeholder**), lalu submit `sitemap.xml`.
   `robots.txt` sudah memblokir `printer.html`, `users.html`, `printers.html`.

---

# Referensi

## Struktur data Firestore

```
users/{uid}
  username, email (email palsu username@dcoprint.local buat Firebase Auth),
  contactEmail (email asli buat kontak), displayName, bio, photoURL,
  role ("customer"|"printer"|"developer"), online (bool; operator mengatur
  lewat toggle di printer.html), banned (bool), waNumber (opsional; wajib
  buat printer), location {province, city, district, village, postalCode, lat, lng},
  regionKey (kunci wilayah ternormalisasi; "" kalau belum lengkap), createdAt
users/{uid}/followers/{followerUid}   — yang mengikuti user ini
users/{uid}/following/{followingUid}  — yang diikuti user ini
users/{uid}/friendRequests/{fromUid}  — permintaan pertemanan MASUK:
  fromDisplayName, fromEmail, createdAt
users/{uid}/friends/{friendUid}       — pertemanan mutual (dibuat di kedua sisi)

printJobs/{jobId}
  customerId, customerEmail, customerWaNumber, printerId, printerEmail,
  regionKey, customerLocation {province, city, district, village},
  rejectedBy (array uid operator yang sudah menolak), rejectReason,
  code ("CP-XXXXXX"), fileName, fileURL, fileType, fileSize (bytes),
  paperSize, price (rupiah, diisi operator saat Terima),
  status ("waiting"|"pending"|"queued"|"printing"|"done"|"cancelled"|"rejected"),
  createdAt, acceptedAt, printingAt, doneAt,
  cancelReason (kalau dibatalkan customer), rejectReason (alasan penolakan
  operator terakhir)

posts/{postId}                        — postingan PROFIL (gaya IG)
  authorId, authorEmail, authorDisplayName, authorPhotoURL, text,
  imageURL (opsional), createdAt
posts/{postId}/likes/{uid}            — keberadaan dokumen = user nge-like
posts/{postId}/comments/{commentId}   — authorId, authorEmail,
  authorDisplayName, text, createdAt

channels/{channelId}
  name, description, photoURL, creatorId, creatorName,
  bannedUids (array), createdAt
channels/{channelId}/members/{uid}    — dicatat saat membuka channel:
  username, photoURL, joinedAt
channels/{channelId}/messages/{msgId} — senderId, senderName,
  senderPhotoURL, text, createdAt

conversations/{convId}                — id = "{uidKecil}_{uidBesar}"
  participants [uid1, uid2], lastMessage, updatedAt
conversations/{convId}/messages/{msgId} — senderId, text, createdAt
```

Composite index yang dideklarasikan di `JSON/firestore.indexes.json`:
`printJobs` (customerId+createdAt, printerId+createdAt), `conversations`
(participants+updatedAt), `posts` (authorId+createdAt).

## Troubleshooting

**Halaman macet di "Memuat…" / muncul error "izin ditolak"**
`firestore.rules` belum di-*publish* ulang (atau role kamu memang tidak
diizinkan). Semua halaman menangkap error ini lewat `describeFirestoreError()`
dan menampilkan pesan jelas. Publish ulang rules dan refresh.

**Error "query requires an index" (`failed-precondition`)**
Ada composite index yang belum dibuat. `describeFirestoreError()` otomatis
menemukan link Firebase Console dari pesan error dan menampilkannya sebagai
tombol **"klik di sini buat langsung bikin index-nya"** — klik, tunggu status
index "Enabled" (1–2 menit), lalu refresh. Tidak perlu CLI.

**Dropdown Provinsi/Kota "Provinsi (gagal memuat daftar)"**
Buka Console browser (F12 → Console/Network) dan lihat request ke
`www.emsifa.com/api-wilayah-indonesia/v2/provinces.json`. Penyebab yang sudah
pernah terjadi: alamat sumber data lama (jsDelivr `@master/api/` dan
`emsifa.github.io`) sudah tidak berfungsi karena repo emsifa pindah ke v2
(diperbaiki di Fase O). Kalau sekarang masih gagal, cek koneksi internet atau
apakah jaringan memblokir `www.emsifa.com`. Selama itu terjadi, kamu tetap bisa
memilih "Tidak ada di daftar (tulis sendiri)" dan mengetik sendiri.

**Kotak peta abu-abu "Ups! Ada sesuatu yang salah" / pesan Google Maps gagal dimuat**
Masalah API key di Google Cloud — lihat bagian Setup 3.

**File `.doc/.docx` gagal upload** → cek Allowed formats di upload preset
Cloudinary (Setup 2, langkah 5).

**Daftar pakai kode `DP-DEV` tapi jadi customer** → kode cuma jalan di mode
*Daftar* dengan username baru (lihat bagian Kode Web ID).

**Perubahan di GitHub belum kelihatan di web** → tunggu 1–2 menit GitHub Pages
selesai deploy, lalu hard refresh (Ctrl+Shift+R).

## Batasan & catatan pengembangan lanjutan

- Pemilihan operator masih acak di antara yang online. Untuk skala besar,
  pakai Cloud Function yang assign berdasarkan antrean paling sedikit.
- File di Cloudinary tidak otomatis dihapus setelah selesai print.
- Notif WhatsApp manual (klik tombol → `wa.me`). Notifikasi otomatis butuh
  Cloud Function + WhatsApp Business API/provider pihak ketiga.
- Menghapus post tidak menghapus subcollection `likes`/`comments`-nya (butuh
  Cloud Function). Menghapus user tidak menghapus akun Firebase Auth-nya.
- Semua channel publik (belum ada channel privat/invite-only). Pertemanan
  belum menghalangi DM.
- Kode Web ID `DP-DEV`/`DP-PRINTER` bisa dibaca siapa saja — ganti sebelum
  promosi ke publik.
- Detail alamat lengkap (jalan/nomor rumah/RT/RW/patokan) sekarang sudah ada
  kolomnya di Edit profil (opsional, lihat bagian "Form lokasi di Profil" di
  atas), tapi belum ikut disalin ke dokumen pesanan (`customerLocation`) —
  operator yang butuh alamat detail customer tetap harus menghubungi manual
  lewat WhatsApp (`waNumber`).

---

# Riwayat perubahan

- **Sebelum Fase C** — fondasi awal: upload → Cloudinary → `printJobs`, dashboard
  operator, profil/komunitas/DM/pertemanan, login username, Kode Web ID.
- **Fase C** — alur pesanan `waiting → pending → queued → printing → done`,
  harga & pendapatan, `waNumber`, notif WA manual, kartu Riwayat & Pendapatan.
- **Fase D** — semua emoji UI diganti gambar dari `Resources/Icons/`
  (helper `iconImg()`); daftar lengkap di `Resources/INSTRUKSI.md`.
- **Fase E** — fix race condition login (role ke-reset jadi customer), UI ala
  Discord diperbesar, Edit Saluran, klik nama/foto → profil, Kontak CS ambil
  data terbaru, Hapus user dengan error handling, kode pesanan `CP-XXXXXX`.
- **Fase F** — kartu "Buka Dashboard Operator" di `home.html`, Switch akun
  cuma muncul kalau >1 akun, `describeFirestoreError()` + tombol bikin index.
- **Fase G** — link Dashboard Operator dihapus dari sidebar (lewat kartu di
  Upload / bubble menu developer).
- **Fase H** — halaman Detail Pesanan `job.html`.
- **Fase I** — dropdown ukuran kertas, tombol "Simpan file" (`fl_attachment`),
  tombol berbentuk link tidak digarisbawahi lagi.
- **Fase J** — dropdown kertas kecil & muncul setelah pilih tipe, Enter
  submit di semua form, "Simpan file" muncul setelah *Mulai print* (yang
  otomatis download), Detail Info di kedua sisi.
- **Fase K** — form lokasi dirampingkan: Provinsi & Kota/Kabupaten jadi
  dropdown (data wilayah Indonesia), Kode Pos, opsi "Lainnya".
- **Fase L** — No. WhatsApp wajib untuk role `printer`.
- **Fase M** — sumber data wilayah pindah ke jsDelivr; pesan error Google Maps
  (`gm_authFailure`) lebih jelas.
- **Fase N (24 Sep 2026)** — perbaikan form lokasi Profil (`JS/profile.js`):
  - Kotak "Tulis nama provinsi/kota/kabupaten kamu" **hanya muncul kalau
    dropdown-nya dipilih "Tidak ada di daftar (tulis sendiri)"** (label diganti dari "isi
    manual"). Sebelumnya kotak bisa muncul sendiri tanpa dipilih (terutama
    saat daftar wilayah gagal dimuat), dan dropdown kota bisa tampil kosong.
    Sekarang visibilitasnya diatur satu fungsi (`syncCustomInputs()`) yang
    mengikuti nilai dropdown.
  - Fetch daftar wilayah dapat **batas waktu 6 detik + sumber cadangan**, jadi
    dropdown tidak lagi nyangkut selamanya di "Memuat daftar provinsi…".
  - Ganti pilihan provinsi cepat-cepat tidak lagi menimpa hasil lama
    (pengaman `provinceChangeToken`).
  - `README.md` dan `Resources/INSTRUKSI.md` ditulis ulang mengikuti kondisi
    web sekarang (login username, status `pending`/`cancelled`, kode pesanan,
    popup notifikasi, ban user, daftar ikon lengkap 27 file, GitHub Pages).
- **Fase O (24 Sep 2026, siang)** — dropdown Provinsi/Kota tetap "gagal memuat
  daftar" di localhost, penyebabnya ketemu (`JS/profile.js`):
  - **Sumber data lama sudah mati.** Repo `emsifa/api-wilayah-indonesia`
    pindah ke API v2, jadi `cdn.jsdelivr.net/gh/emsifa/...@master/api/` dan
    `emsifa.github.io/api-wilayah-indonesia/api/` (dua-duanya dipakai di Fase M
    & N) tidak lagi bisa dipakai dari browser. Sekarang dipakai
    `https://www.emsifa.com/api-wilayah-indonesia/v2/` (`/provinces.json`,
    `/regencies/{province_id}.json`, format `{ data, meta }`, ID kab/kota
    berformat `35.73`), dengan API versi lama di `.../api/` sebagai cadangan.
    Kode sekarang menerima dua format itu. Daftar provinsi jadi 38 (termasuk
    Papua Selatan/Tengah/Pegunungan/Barat Daya).
  - **Error Google Maps tidak lagi menampilkan kotak abu-abu Google** — kalau
    API key bermasalah, kotak peta disembunyikan dan yang tampil cuma pesan
    error yang jelas.
  - **Script Google Maps sekarang minta hasil berbahasa Indonesia**
    (`&language=id`), supaya nama provinsi/kota hasil "Isi otomatis" (mis.
    "Jawa Timur", "Kota Malang") cocok dengan isi dropdown, bukan versi
    Inggris ("East Java", "Malang City") yang selalu jatuh ke "Lainnya".
- **Fase P (24 Sep 2026)** — order dipisah per wilayah + Kecamatan & Kelurahan:
  - Form lokasi Profil jadi 4 dropdown bertingkat (Provinsi → Kota/Kabupaten →
    Kecamatan → Kelurahan/Desa), bisa diisi otomatis dari Google Maps,
    tetap ada opsi "Tidak ada di daftar (tulis sendiri)" per tingkat.
  - Order hanya masuk ke operator yang keempat tingkat wilayahnya sama dengan
    customer (`regionKey`); wilayah lokasi lengkap jadi wajib untuk operator
    (saat Simpan profil) dan untuk customer (saat upload).
  - `firestore.rules` **wajib di-publish ulang** (aturan baca/klaim job
    `waiting` dan pembuatan job kini memeriksa `regionKey`; field
    `regionKey` ditambahkan ke daftar field profil yang boleh diubah sendiri).
  - Semua user yang sudah punya lokasi lama (tanpa kecamatan/kelurahan) perlu
    membuka Profil → Edit profil → melengkapi lokasi → Simpan.
- **Fase Q (24 Sep 2026)** — alur tolak order: operator yang menolak dicatat di
  `rejectedBy`; order dilempar ke operator lain di wilayah yang sama yang belum
  menolak (`pending` kalau online, `waiting` kalau offline, dan operator yang
  sudah menolak tidak akan mengklaimnya lagi). Kalau semua operator di
  wilayah itu sudah menolak → status baru `rejected` (final). `firestore.rules`
  perlu di-publish ulang lagi.
- **Fase R (24 Sep 2026)** — kolom **Detail alamat: jalan, nomor rumah,
  RT/RW, patokan (opsional)** ditambahkan ke Edit profil (`location.streetDetail`),
  disembunyikan di balik tombol accordion "(opsional)" persis kolom Kode Web
  ID, dan ditampilkan buat semua role (sebelumnya field ini memang belum
  punya halaman sama sekali). `firestore.rules` tidak perlu di-publish ulang
  (field baru ini ikut di dalam objek `location` yang sudah diizinkan).
