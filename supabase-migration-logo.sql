-- ============================================================
-- MIGRASI: tambah dukungan logo (WESITE Finance)
-- Jalankan ini di SQL Editor Supabase kalau project kamu SUDAH
-- pernah menjalankan supabase-schema.sql sebelumnya.
-- Aman dijalankan berkali-kali (IF NOT EXISTS).
-- ============================================================

alter table app_settings add column if not exists logo text;
alter table clients add column if not exists logo text;
