-- ============================================================
-- WESITE FINANCE — SKEMA LENGKAP (gabungan schema + migrasi logo)
-- Aman dijalankan berkali-kali, termasuk di project yang sudah pernah
-- di-setup sebelumnya (semua pakai IF NOT EXISTS / ON CONFLICT DO NOTHING).
-- Jalankan di: Supabase Dashboard > SQL Editor > New query > Run
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- KLIEN ----------
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company text,
  phone text,
  email text,
  logo text, -- logo klien dalam format base64 data URL
  created_at timestamptz default now()
);
alter table clients add column if not exists logo text;

-- ---------- INVOICE ----------
create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  number text not null,
  client_id uuid references clients(id) on delete set null,
  status text default 'Belum',
  date date,
  due date,
  description text,
  discount numeric default 0,
  tax numeric default 0,
  items jsonb default '[]',
  total numeric default 0,
  created_at timestamptz default now()
);

-- ---------- TANDA TERIMA GAJI ----------
create table if not exists receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_number text,
  employee_name text not null,
  position text,
  period text,
  amount numeric not null default 0,
  date date,
  method text default 'Transfer Bank',
  note text,
  created_at timestamptz default now()
);

-- ---------- TRANSAKSI (Pemasukan & Pengeluaran) ----------
create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('in','out')),
  date date,
  client_id uuid references clients(id) on delete set null,
  invoice_id uuid references invoices(id) on delete cascade,
  receipt_id uuid references receipts(id) on delete cascade,
  category text,
  amount numeric not null default 0,
  note text,
  created_at timestamptz default now()
);

-- ---------- PENGATURAN (satu baris) ----------
create table if not exists app_settings (
  id int primary key default 1,
  company_name text default 'WESITE',
  address text default 'Yogyakarta, Indonesia',
  email text default 'wesite.id@gmail.com',
  wa text default '+62 896 8894 6655',
  logo text -- logo bisnis dalam format base64 data URL
);
alter table app_settings add column if not exists logo text;
insert into app_settings (id) values (1) on conflict (id) do nothing;

-- ============================================================
-- ROW LEVEL SECURITY
-- Kedua akun (yang login lewat Supabase Auth) mendapat akses
-- penuh baca/tulis ke semua data yang sama (workspace bersama).
-- ============================================================
alter table clients enable row level security;
alter table invoices enable row level security;
alter table receipts enable row level security;
alter table transactions enable row level security;
alter table app_settings enable row level security;

drop policy if exists "authenticated full access" on clients;
create policy "authenticated full access" on clients
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "authenticated full access" on invoices;
create policy "authenticated full access" on invoices
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "authenticated full access" on receipts;
create policy "authenticated full access" on receipts
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "authenticated full access" on transactions;
create policy "authenticated full access" on transactions
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "authenticated full access" on app_settings;
create policy "authenticated full access" on app_settings
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ============================================================
-- REALTIME — agar perubahan dari 1 akun langsung muncul di akun lain
-- (aman dijalankan ulang: akan skip kalau tabel sudah terdaftar)
-- ============================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'clients'
  ) then
    alter publication supabase_realtime add table clients;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'invoices'
  ) then
    alter publication supabase_realtime add table invoices;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'receipts'
  ) then
    alter publication supabase_realtime add table receipts;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'transactions'
  ) then
    alter publication supabase_realtime add table transactions;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'app_settings'
  ) then
    alter publication supabase_realtime add table app_settings;
  end if;
end $$;
