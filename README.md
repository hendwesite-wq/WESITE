# WESITE Finance (TypeScript + Vite)

Dashboard invoice & keuangan personal — dibangun dengan TypeScript, Vite, dan Supabase.
Struktur ini siap langsung di-push ke GitHub dan di-deploy ke Vercel; koneksi ke Supabase
diatur lewat **Environment Variables** (tidak perlu edit kode sama sekali).

```
wesite-finance/
├── index.html              ← markup halaman (entry Vite)
├── package.json
├── tsconfig.json
├── vite.config.ts
├── vercel.json
├── .env.example            ← contoh variabel Supabase
├── supabase-schema.sql     ← skema database + keamanan (RLS)
└── src/
    ├── main.ts              ← entry point, daftarkan handler ke window
    ├── app.ts                ← seluruh logika (auth, render, CRUD Supabase)
    ├── state.ts              ← cache data + fetch dari Supabase + realtime
    ├── supabaseClient.ts     ← inisialisasi klien Supabase dari env var
    ├── format.ts             ← formatRp, terbilang, usernameToEmail
    ├── types.ts               ← tipe data (Client, Transaction, Invoice, Receipt, ...)
    ├── vite-env.d.ts          ← deklarasi tipe untuk import.meta.env
    └── style.css              ← seluruh styling (glassmorphism)
```

---

## BAGIAN 1 — Setup Database (Supabase)

1. Buka [supabase.com](https://supabase.com) → **New project**. Simpan password database dan pilih region **Singapore** (tercepat untuk Indonesia).
2. Buka **SQL Editor → New query**, paste seluruh isi `supabase-schema.sql`, klik **Run**.
3. Cek **Table Editor** — harus ada 5 tabel: `clients`, `invoices`, `receipts`, `transactions`, `app_settings`.
4. Buka **Database → Replication**, pastikan kelima tabel berstatus enabled (untuk sinkron real-time antar akun).
5. Buka **Authentication → Users → Add user**, buat 2 akun (centang **Auto Confirm User**):
   - `hend_rian@internal.wesite.id` / password `wesite.cs1001` → login di app pakai `@HEND_RIAN`
   - `[akun-kedua]@internal.wesite.id` / password bebas → login di app pakai `@[AKUN_KEDUA]`
6. Buka **Project Settings → API**, catat **Project URL** dan **anon public key** — dipakai di Bagian 3.

---

## BAGIAN 2 — Upload ke GitHub

```bash
cd wesite-finance
git init
git add .
git commit -m "Initial commit - WESITE Finance (TypeScript)"
git branch -M main
git remote add origin https://github.com/USERNAME-KAMU/wesite-finance.git
git push -u origin main
```

`node_modules`, `dist`, dan `.env` sudah otomatis diabaikan lewat `.gitignore` — jangan pernah commit file `.env` yang berisi kunci asli.

*(Kalau lebih suka tanpa terminal, bisa juga upload manual lewat tombol "Add file → Upload files" di halaman repo GitHub.)*

---

## BAGIAN 3 — Deploy ke Vercel & Hubungkan Supabase

1. Buka [vercel.com](https://vercel.com) → **Continue with GitHub**.
2. **Add New → Project → Import** repo `wesite-finance` kamu.
3. Vercel otomatis mendeteksi ini sebagai project **Vite** — biarkan Build Command (`vite build`) dan Output Directory (`dist`) default, tidak perlu diubah.
4. **Sebelum klik Deploy**, buka bagian **Environment Variables**, tambahkan dua baris:

   | Name | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | `https://xxxxxxxx.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | `eyJhbGciOi....` (anon public key kamu) |

5. Klik **Deploy**. Tunggu ± 1 menit → selesai, dapat URL live seperti `wesite-finance.vercel.app`.

> Kalau nanti ganti project Supabase atau kunci berubah, cukup update di **Project Settings → Environment Variables** di Vercel lalu **Redeploy** — tidak perlu sentuh kode.

### Coba jalankan di komputer sendiri (opsional)
```bash
npm install
cp .env.example .env      # lalu isi VITE_SUPABASE_URL & VITE_SUPABASE_ANON_KEY
npm run dev                # buka http://localhost:5173
```

---

## BAGIAN 4 — Uji Coba

1. Buka URL Vercel kamu → login `@HEND_RIAN` / `wesite.cs1001`.
2. Tambahkan klien, transaksi, invoice, dan tanda terima gaji.
3. Refresh halaman — data harus tetap ada (tersimpan di Supabase).
4. Buka di device/browser lain, login akun kedua — data yang sama harus muncul dan tersinkron otomatis (real-time) tanpa refresh.
5. Coba **Preview & Print PDF** di Invoice / Tanda Terima — dokumen harus langsung penuh di halaman pertama.

---

## Troubleshooting

| Masalah | Penyebab umum | Solusi |
|---|---|---|
| "Supabase belum dikonfigurasi" di layar login | Env var belum diisi di Vercel / `.env` lokal | Cek Bagian 3 langkah 4, lalu Redeploy |
| "Username atau password salah" terus | Email di Supabase Auth tidak cocok pola `username@internal.wesite.id` | Cek ulang di Authentication → Users |
| Build gagal di Vercel | Biasanya karena file ter-skip / typo path import | Cek log build di tab Deployments, pastikan semua file di `src/` ter-push ke GitHub |
| Data tidak sinkron ke akun lain | Replication belum aktif | Database → Replication, aktifkan tabel yang belum enabled |

---

## Tentang keketatan TypeScript

`tsconfig.json` sengaja diatur tidak terlalu ketat (`strict: false`) supaya proses build di Vercel tidak gagal karena isu tipe kecil — Vite memakai esbuild untuk build produksi, bukan `tsc`, jadi build tetap jalan walau ada beberapa `any` longgar. Kalau suatu saat ingin type-checking penuh, jalankan:
```bash
npm run typecheck
```
