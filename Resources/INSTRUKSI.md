# Instruksi isi folder Resources/ (diupdate 24 Sep 2026)

File ini daftar LENGKAP semua file gambar yang dipanggil kode web
D' CopynPrint dari folder `Resources/`. Daftarnya sudah dicek ulang
langsung terhadap kode (`HTML/*.html`, `JS/*.js`) — jadi semua yang
tertulis di sini memang dipakai, dan semua yang dipakai kode ada di sini.
Kalau ada file yang hilang, bagian itu di web bakal tampil sebagai
**ikon rusak** (gambar broken) — bukan error yang bikin web crash, cuma
kelihatan jelek aja.

Aturan umum: file **PNG**, background **transparan** (kecuali
`Default-Avatar.png`), sebaiknya **persegi (1:1)**. Ukuran nggak harus
persis 512×512 — yang penting persegi dan nggak buram pas ditampilkan
kecil di UI. Nama file **case-sensitive** — harus persis sama termasuk
huruf besar/kecil dan tanda hubung (`-`).

Semua halaman ada di folder `HTML/`, jadi path yang dipakai kode selalu
`../Resources/Icons/NamaFile.png` (lewat helper `iconImg()` di
`JS/app.js`, atau langsung lewat tag `<img>` di file HTML).

## `Resources/Icons/` — ikon UI (pengganti emoji), 27 file

Semua file di bawah **sudah ada** di folder ini, jadi web nggak bakal
nampilin ikon rusak kalau di-deploy apa adanya. Sebagian sudah ikon final,
sebagian masih placeholder — timpa langsung file-nya (nama & ekstensi
persis sama) kapan pun kamu punya ikon baru.

| Nama file            | Dipakai di mana                                                                 |
|----------------------|----------------------------------------------------------------------------------|
| `Eye.png`            | Tombol tampilkan password (mata terbuka) — `login.html`                         |
| `Eye-Off.png`        | Tombol sembunyikan password (mata tercoret) — `login.html`                      |
| `Upload.png`         | Menu sidebar "Printer"/"Upload" (link ke `home.html`, termasuk tampilan guest)  |
| `Community.png`      | Menu sidebar "Komunitas" & ikon jumlah komentar di kartu postingan (`profile.js`) |
| `Message.png`        | Menu sidebar "Pesan"                                                             |
| `Login.png`          | Link "Masuk / Daftar" di sidebar (tampilan guest, belum login)                  |
| `Support.png`        | Ikon bulat di tombol "Kontak CS" (topbar)                                        |
| `Bell.png`           | Ikon popup "Ada pesanan belum diterima!" (notifikasi operator/developer, `shell.js`) |
| `OPD.png`            | Tombol "Buka Dashboard Operator" di kartu operator (`home.html`)                |
| `Dashboard.png`      | Item "Dashboard Operator" di bubble menu developer                               |
| `Printer.png`        | Item "Printers" di bubble menu developer                                         |
| `Members.png`        | Item "Kelola User" di bubble menu developer & tombol "Kelola Anggota" di channel |
| `Settings.png`       | Tombol bulat bubble menu developer (pojok kanan bawah)                          |
| `Plus.png`           | Tombol "Buat channel" (`community.html`) & tombol "Tambah teman" (profil orang lain) |
| `Check.png`          | Status tombol "Berteman ✓" di profil orang lain                                  |
| `Heart-Filled.png`   | Ikon like yang SUDAH ditekan (kartu postingan)                                   |
| `Heart-Outline.png`  | Ikon like yang BELUM ditekan (kartu postingan)                                   |
| `Image-Add.png`      | Tombol "Tambah gambar" di modal bikin postingan baru (`profile.html`)           |
| `Switch.png`         | Tombol "Switch akun" di Profil → Akun                                            |
| `Logout.png`         | Tombol "Keluar" di Profil → Akun                                                 |
| `Back.png`           | Link "Kembali" di `channel.html`, `job.html`, dan `printer.html`                |
| `Edit.png`           | Tombol "Edit Saluran" di header channel (khusus pemilik channel)                |
| `Trash.png`          | Tombol "Hapus Saluran" di header channel (khusus pemilik channel)               |
| `Reject.png`         | Tombol ikon "Tolak" (Dashboard Operator) & "Batal" pesanan (riwayat customer, `home.js`) |
| `Accept.png`         | Tombol ikon "Terima" pesanan masuk (Dashboard Operator)                          |
| `Print-Start.png`    | Tombol ikon "Mulai print" (Dashboard Operator)                                   |
| `Print-Done.png`     | Tombol ikon "Tandai selesai" (Dashboard Operator)                                |

> **Catatan file kembar:** `Eye.png` dan `Eye-Off.png` isinya masih gambar
> generik bertuliskan "PLACEHOLDER" — persis sama dengan
> `Images/Default-Avatar.png` (file-nya identik). Fungsinya tetap jalan
> (nggak ikon rusak), cuma kelihatan aneh secara visual sampai kamu timpa.
> `Dashboard.png` dan `OPD.png` juga saat ini isinya identik — kalau mau
> dibedakan, timpa salah satunya saja.

## `Resources/Images/` — gambar umum

- `Default-Avatar.png` — foto profil default kalau user belum upload foto
  sendiri (`DEFAULT_AVATAR_PATH` di `JS/app.js`). Dipakai buat avatar
  orang saja, bukan channel: channel yang belum punya foto pakai ikon
  bundar "#" bawaan CSS. Saat ini masih gambar "PLACEHOLDER" (lihat
  catatan di atas).

Nggak ada file lain yang wajib disiapkan di folder ini saat ini.

## Yang BUKAN dari folder Resources/

- **Foto profil, foto channel, gambar postingan, dan file yang diupload
  customer** disimpan di **Cloudinary** (bukan di folder ini, dan bukan
  di repo GitHub) — lihat bagian "Setup Cloudinary" di `README.md`.
- **Peta di Profil** digambar oleh Google Maps JavaScript API (kalau
  `JS/maps-config.js` diisi API key) — tidak butuh file gambar dari sini.

---

Kalau nanti nambah fitur baru yang butuh ikon/gambar baru, tambahkan
barisnya di tabel atas ini juga (jangan cuma di `README.md` utama) —
supaya file ini selalu jadi satu sumber kebenaran (*single source of
truth*) buat semua aset gambar yang wajib disiapkan sebelum web di-deploy
ke publik. Cara cek cepat kalau ragu: cari nama file-nya di seluruh
proyek — kalau nggak ada yang manggil, berarti nggak dipakai; kalau ada
yang manggil tapi filenya nggak ada di folder ini, itu bakal jadi ikon
rusak.
