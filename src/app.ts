import { Chart } from 'chart.js/auto';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { supabase } from './supabaseClient';
import { formatRp, terbilang, usernameToEmail } from './format';
import {
  clients, transactions, invoices, receipts, settings,
  clientById, fetchAll, setupRealtime
} from './state';
import type { Invoice, InvoiceItem, Receipt, Transaction } from './types';

/** Helper singkat & aman-tipe untuk document.getElementById */
function $<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

/** Ubah file yang dipilih user jadi base64 data URL, siap disimpan ke Supabase. */
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Isi elemen logo-slot dengan gambar (data URL) kalau ada, atau badge inisial kalau tidak ada. */
function renderLogoSlot(slotId: string, dataUrl: string | null | undefined, initials: string): void {
  const slot = document.getElementById(slotId);
  if (!slot) return;
  if (dataUrl) {
    slot.innerHTML = `<img src="${dataUrl}" alt="logo">`;
  } else {
    slot.innerHTML = `<span class="logo-fallback">${initials}</span>`;
  }
}

/**
 * Tampilkan pesan error Supabase secara jelas ke pengguna, alih-alih diam-diam
 * gagal seolah berhasil. Kembalikan true kalau ADA error (supaya pemanggil bisa
 * langsung `return` dan tidak melanjutkan seperti proses sukses).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function reportSupabaseError(error: any, context: string): boolean {
  if (!error) return false;
  console.error(`[${context}]`, error);
  const hint = /column .* does not exist/i.test(error.message || '')
    ? '\n\nSepertinya skema database belum diperbarui — jalankan supabase-migration-logo.sql (atau supabase-schema.sql) di SQL Editor Supabase, lalu coba lagi.'
    : '';
  alert(`Gagal menyimpan (${context}): ${error.message || 'terjadi kesalahan tidak dikenal'}${hint}`);
  return true;
}

/* ============================================================
   AUTH
   ============================================================ */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let currentUser: any = null;

export async function handleLogin(e: Event): Promise<void> {
  e.preventDefault();
  const err = $('loginError');
  const btn = $<HTMLButtonElement>('loginBtn');
  if (!supabase) {
    err.textContent = 'Supabase belum dikonfigurasi. Isi VITE_SUPABASE_URL & VITE_SUPABASE_ANON_KEY di file .env.';
    err.classList.add('show');
    return;
  }
  const email = usernameToEmail($<HTMLInputElement>('loginUser').value);
  const password = $<HTMLInputElement>('loginPass').value;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memeriksa...';
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  btn.disabled = false;
  btn.innerHTML = '<i class="fa-solid fa-right-to-bracket"></i> Masuk';
  if (error) {
    err.textContent = 'Username atau password salah.';
    err.classList.add('show');
    return;
  }
  err.classList.remove('show');
}

export async function handleLogout(): Promise<void> {
  await flushPendingAutosaves();
  if (supabase) await supabase.auth.signOut();
  showLogin();
}

function showLogin(): void {
  $('app').classList.remove('active');
  $('loginScreen').style.display = 'flex';
  $<HTMLInputElement>('loginPass').value = '';
}

export function initAuthListener(): void {
  if (supabase) {
    supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        currentUser = session.user;
        bootApp();
      } else if (event === 'SIGNED_OUT') {
        showLogin();
      }
    });
  } else {
    const err = $('loginError');
    err.textContent = 'Supabase belum dikonfigurasi — isi VITE_SUPABASE_URL & VITE_SUPABASE_ANON_KEY (lihat README.md).';
    err.classList.add('show');
  }

  // Pengaman tambahan: kalau tab ditutup/dipindah (misalnya buka app lain di HP)
  // sebelum jeda auto-save (±1 detik) selesai, simpan segera saat itu juga.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPendingAutosaves();
  });
  window.addEventListener('pagehide', () => { flushPendingAutosaves(); });
}

async function refreshAndRender(): Promise<void> {
  await fetchAll();
  populateClientSelects();
  renderDashboard();
  renderTransactions();
  renderClients();
  renderInvoiceList();
  renderReceiptList();
}

/* ============================================================
   NAV / VIEWS
   ============================================================ */
const VIEW_TITLES: Record<string, string> = {
  dashboard: 'Dashboard',
  transactions: 'Pemasukan & Pengeluaran',
  clients: 'Klien',
  invoices: 'Invoice',
  receipts: 'Tanda Terima Gaji',
  settings: 'Pengaturan'
};

export async function switchView(view: string): Promise<void> {
  await flushPendingAutosaves();
  document.querySelectorAll('.app-view').forEach((v) => v.classList.remove('active'));
  $('view-' + view).classList.add('active');
  document.querySelectorAll('.nav-item, .tab-item').forEach((n) => {
    n.classList.toggle('active', (n as HTMLElement).dataset.view === view);
  });
  const topbarTitle = document.getElementById('mobileTopbarTitle');
  if (topbarTitle) topbarTitle.textContent = VIEW_TITLES[view] || 'WESITE Finance';
  closeMoreMenu();
  if (view === 'dashboard') renderDashboard();
  if (view === 'transactions') { populateClientSelects(); renderTransactions(); }
  if (view === 'clients') renderClients();
  if (view === 'invoices') { populateClientSelects(); showInvoiceList(); }
  if (view === 'receipts') showReceiptList();
  if (view === 'settings') loadSettingsForm();
}

export function toggleMoreMenu(): void {
  const sheet = document.getElementById('mobileMoreSheet');
  if (sheet) sheet.classList.toggle('open');
}
function closeMoreMenu(): void {
  const sheet = document.getElementById('mobileMoreSheet');
  if (sheet) sheet.classList.remove('open');
}

async function bootApp(): Promise<void> {
  $('loginScreen').style.display = 'none';
  $('app').classList.add('active');

  const email: string = currentUser?.email || '';
  const name = email.split('@')[0].replace(/\./g, ' ');
  const displayName = name.charAt(0).toUpperCase() + name.slice(1);
  const displayHandle = '@' + email.split('@')[0].toUpperCase();
  const initials = name.slice(0, 2).toUpperCase();

  $('userDisplayName').textContent = displayName;
  $('userDisplayEmail').textContent = displayHandle;
  $('userAvatarInitials').textContent = initials;
  const mName = document.getElementById('userDisplayNameMobile');
  const mEmail = document.getElementById('userDisplayEmailMobile');
  const mAvatar = document.getElementById('userAvatarInitialsMobile');
  if (mName) mName.textContent = displayName;
  if (mEmail) mEmail.textContent = displayHandle;
  if (mAvatar) mAvatar.textContent = initials;

  await fetchAll();
  populateClientSelects();
  renderDashboard();
  renderTransactions();
  renderClients();
  showInvoiceList();
  showReceiptList();
  loadSettingsForm();
  setupRealtime(() => { refreshAndRender(); });
}

/* ============================================================
   DASHBOARD
   ============================================================ */
let cashflowChartInstance: Chart | null = null;
let expensePieInstance: Chart | null = null;

function renderDashboard(): void {
  let totalIn = 0;
  let totalOut = 0;
  transactions.forEach((t) => { if (t.type === 'in') totalIn += Number(t.amount); else totalOut += Number(t.amount); });
  $('stat-in').textContent = formatRp(totalIn);
  $('stat-out').textContent = formatRp(totalOut);
  $('stat-balance').textContent = formatRp(totalIn - totalOut);
  $('stat-clients').textContent = String(clients.length);

  const tbody = $('recent-tx-body');
  tbody.innerHTML = '';
  const recent = [...transactions].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 6);
  $('recent-tx-empty').style.display = recent.length ? 'none' : 'block';
  recent.forEach((t) => {
    const c = clientById(t.client_id);
    tbody.insertAdjacentHTML('beforeend', `<tr>
      <td>${t.date || '-'}</td>
      <td>${c ? c.name : '-'}</td>
      <td>${t.category || '-'}</td>
      <td><span class="type-badge ${t.type === 'in' ? 'type-in' : 'type-out'}"><i class="fa-solid fa-${t.type === 'in' ? 'arrow-down' : 'arrow-up'}"></i> ${t.type === 'in' ? 'Masuk' : 'Keluar'}</span></td>
      <td style="text-align:right;font-weight:600;">${formatRp(t.amount)}</td>
    </tr>`);
  });

  renderCashflowChart();
  renderExpensePie();
}

function last6Months(): { key: string; label: string }[] {
  const arr: { key: string; label: string }[] = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    arr.push({
      key: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'),
      label: d.toLocaleDateString('id-ID', { month: 'short', year: '2-digit' })
    });
  }
  return arr;
}

function renderCashflowChart(): void {
  const months = last6Months();
  const inData = months.map((m) => transactions.filter((t) => t.type === 'in' && (t.date || '').startsWith(m.key)).reduce((a, c) => a + Number(c.amount), 0));
  const outData = months.map((m) => transactions.filter((t) => t.type === 'out' && (t.date || '').startsWith(m.key)).reduce((a, c) => a + Number(c.amount), 0));

  const ctx = $<HTMLCanvasElement>('cashflowChart');
  if (cashflowChartInstance) cashflowChartInstance.destroy();
  cashflowChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: months.map((m) => m.label),
      datasets: [
        { label: 'Pemasukan', data: inData, backgroundColor: '#34D399', borderRadius: 6, maxBarThickness: 34 },
        { label: 'Pengeluaran', data: outData, backgroundColor: '#F87171', borderRadius: 6, maxBarThickness: 34 }
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: '#8FA0BE', font: { size: 11 } } } },
      scales: {
        x: { ticks: { color: '#8FA0BE' }, grid: { color: 'rgba(255,255,255,.06)' } },
        y: { ticks: { color: '#8FA0BE', callback: (v) => (Number(v) / 1000) + 'k' }, grid: { color: 'rgba(255,255,255,.06)' } }
      }
    }
  });
}

function renderExpensePie(): void {
  const cats: Record<string, number> = {};
  transactions.filter((t) => t.type === 'out').forEach((t) => {
    const k = t.category || 'Lainnya';
    cats[k] = (cats[k] || 0) + Number(t.amount);
  });
  const labels = Object.keys(cats);
  const data = Object.values(cats);
  const palette = ['#2C4F7C', '#D9A441', '#F87171', '#34D399', '#38BDF8', '#64748B', '#A78BFA'];

  const ctx = $<HTMLCanvasElement>('expensePieChart');
  if (expensePieInstance) expensePieInstance.destroy();
  if (!labels.length) {
    expensePieInstance = new Chart(ctx, {
      type: 'doughnut',
      data: { labels: ['Belum ada data'], datasets: [{ data: [1], backgroundColor: ['rgba(255,255,255,.08)'] }] },
      options: { plugins: { legend: { labels: { color: '#8FA0BE' } } } }
    });
    return;
  }
  expensePieInstance = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: palette, borderColor: '#0A1220', borderWidth: 2 }] },
    options: { plugins: { legend: { position: 'bottom', labels: { color: '#8FA0BE', font: { size: 11 }, boxWidth: 12 } } } }
  });
}

/* ============================================================
   TRANSACTIONS
   ============================================================ */
function populateClientSelects(): void {
  const opts = clients.map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
  const txSel = document.getElementById('tx-client'); if (txSel) txSel.innerHTML = '<option value="">- Tanpa Klien -</option>' + opts;
  const filterSel = document.getElementById('tx-filter-client'); if (filterSel) filterSel.innerHTML = '<option value="">Semua Klien</option>' + opts;
  const invSel = document.getElementById('inv-client'); if (invSel) invSel.innerHTML = '<option value="">- Pilih Klien -</option>' + opts;
}

export function openTxForm(): void {
  $('tx-form-card').style.display = 'block';
  $('tx-form-title').textContent = 'Tambah Transaksi';
  $<HTMLInputElement>('tx-edit-id').value = '';
  $<HTMLSelectElement>('tx-type').value = 'in';
  $<HTMLInputElement>('tx-date').value = new Date().toISOString().slice(0, 10);
  $<HTMLSelectElement>('tx-client').value = '';
  $<HTMLInputElement>('tx-category').value = '';
  $<HTMLInputElement>('tx-amount').value = '';
  $<HTMLInputElement>('tx-note').value = '';
}
export function closeTxForm(): void { $('tx-form-card').style.display = 'none'; }

export async function saveTransaction(): Promise<void> {
  if (!supabase) return;
  const amount = parseFloat($<HTMLInputElement>('tx-amount').value);
  if (!amount || amount <= 0) { alert('Masukkan nominal yang valid.'); return; }
  const editId = $<HTMLInputElement>('tx-edit-id').value;
  const payload = {
    type: $<HTMLSelectElement>('tx-type').value,
    date: $<HTMLInputElement>('tx-date').value || new Date().toISOString().slice(0, 10),
    client_id: $<HTMLSelectElement>('tx-client').value || null,
    category: $<HTMLInputElement>('tx-category').value.trim(),
    amount,
    note: $<HTMLInputElement>('tx-note').value.trim()
  };
  if (editId) {
    const { error } = await supabase.from('transactions').update(payload).eq('id', editId);
    if (reportSupabaseError(error, 'Simpan Transaksi')) return;
  } else {
    const { error } = await supabase.from('transactions').insert(payload);
    if (reportSupabaseError(error, 'Simpan Transaksi')) return;
  }
  await refreshAndRender();
  closeTxForm();
}

export function editTransaction(id: string): void {
  const t = transactions.find((x) => x.id === id);
  if (!t) return;
  openTxForm();
  $('tx-form-title').textContent = 'Edit Transaksi';
  $<HTMLInputElement>('tx-edit-id').value = t.id;
  $<HTMLSelectElement>('tx-type').value = t.type;
  $<HTMLInputElement>('tx-date').value = t.date;
  $<HTMLSelectElement>('tx-client').value = t.client_id || '';
  $<HTMLInputElement>('tx-category').value = t.category || '';
  $<HTMLInputElement>('tx-amount').value = String(t.amount);
  $<HTMLInputElement>('tx-note').value = t.note || '';
}

export async function deleteTransaction(id: string): Promise<void> {
  if (!supabase || !confirm('Hapus transaksi ini?')) return;
  await supabase.from('transactions').delete().eq('id', id);
  await refreshAndRender();
}

function renderTransactions(): void {
  const q = ($<HTMLInputElement>('tx-filter-search').value || '').toLowerCase();
  const type = $<HTMLSelectElement>('tx-filter-type').value;
  const cid = $<HTMLSelectElement>('tx-filter-client').value;

  let list = [...transactions].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  list = list.filter((t) => {
    const c = clientById(t.client_id);
    const matchQ = !q || (c && c.name.toLowerCase().includes(q)) || (t.category || '').toLowerCase().includes(q);
    return matchQ && (!type || t.type === type) && (!cid || t.client_id === cid);
  });

  const tbody = $('tx-table-body'); tbody.innerHTML = '';
  $('tx-empty').style.display = list.length ? 'none' : 'block';
  list.forEach((t: Transaction) => {
    const c = clientById(t.client_id);
    tbody.insertAdjacentHTML('beforeend', `<tr>
      <td>${t.date}</td>
      <td>${c ? c.name : '<span style="color:var(--text-muted)">-</span>'}</td>
      <td>${t.category || '-'}</td>
      <td><span class="type-badge ${t.type === 'in' ? 'type-in' : 'type-out'}"><i class="fa-solid fa-${t.type === 'in' ? 'arrow-down' : 'arrow-up'}"></i> ${t.type === 'in' ? 'Masuk' : 'Keluar'}</span></td>
      <td style="text-align:right;font-weight:600;">${formatRp(t.amount)}</td>
      <td style="text-align:right;">
        <button class="btn btn-secondary btn-sm" onclick="editTransaction('${t.id}')"><i class="fa-solid fa-pen"></i></button>
        <button class="btn btn-danger btn-sm" onclick="deleteTransaction('${t.id}')"><i class="fa-solid fa-trash"></i></button>
      </td>
    </tr>`);
  });
}
export { renderTransactions };

/* ============================================================
   CLIENTS
   ============================================================ */
export function openClientForm(): void {
  $('client-form-card').style.display = 'block';
  $('client-form-title').textContent = 'Tambah Klien';
  $<HTMLInputElement>('client-edit-id').value = '';
  $<HTMLInputElement>('client-name').value = '';
  $<HTMLInputElement>('client-company').value = '';
  $<HTMLInputElement>('client-phone').value = '';
  $<HTMLInputElement>('client-email').value = '';
  $<HTMLInputElement>('client-logo-data').value = '';
  $<HTMLInputElement>('client-logo-input').value = '';
  renderLogoSlot('client-logo-preview', null, 'K');
}
export function closeClientForm(): void { $('client-form-card').style.display = 'none'; }

export async function onClientLogoChange(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files && input.files[0];
  if (!file) return;
  const dataUrl = await readFileAsDataUrl(file);
  $<HTMLInputElement>('client-logo-data').value = dataUrl;
  renderLogoSlot('client-logo-preview', dataUrl, 'K');
}
export function clearClientLogo(): void {
  $<HTMLInputElement>('client-logo-data').value = '';
  $<HTMLInputElement>('client-logo-input').value = '';
  renderLogoSlot('client-logo-preview', null, 'K');
}

export async function saveClient(): Promise<void> {
  if (!supabase) return;
  const name = $<HTMLInputElement>('client-name').value.trim();
  if (!name) { alert('Nama klien wajib diisi.'); return; }
  const editId = $<HTMLInputElement>('client-edit-id').value;
  const payload = {
    name,
    company: $<HTMLInputElement>('client-company').value.trim(),
    phone: $<HTMLInputElement>('client-phone').value.trim(),
    email: $<HTMLInputElement>('client-email').value.trim(),
    logo: $<HTMLInputElement>('client-logo-data').value || null
  };
  if (editId) {
    const { error } = await supabase.from('clients').update(payload).eq('id', editId);
    if (reportSupabaseError(error, 'Simpan Klien')) return;
  } else {
    const { error } = await supabase.from('clients').insert(payload);
    if (reportSupabaseError(error, 'Simpan Klien')) return;
  }
  await refreshAndRender();
  closeClientForm();
}

export function editClient(id: string): void {
  const c = clientById(id);
  if (!c) return;
  openClientForm();
  $('client-form-title').textContent = 'Edit Klien';
  $<HTMLInputElement>('client-edit-id').value = c.id;
  $<HTMLInputElement>('client-name').value = c.name;
  $<HTMLInputElement>('client-company').value = c.company || '';
  $<HTMLInputElement>('client-phone').value = c.phone || '';
  $<HTMLInputElement>('client-email').value = c.email || '';
  $<HTMLInputElement>('client-logo-data').value = c.logo || '';
  renderLogoSlot('client-logo-preview', c.logo, c.name.slice(0, 2).toUpperCase());
}

export async function deleteClient(id: string): Promise<void> {
  if (!supabase || !confirm('Hapus klien ini? Transaksi terkait akan tetap ada tanpa klien.')) return;
  await supabase.from('clients').delete().eq('id', id);
  await refreshAndRender();
}

function renderClients(): void {
  const grid = $('client-grid'); grid.innerHTML = '';
  $('client-empty').style.display = clients.length ? 'none' : 'block';
  clients.forEach((c) => {
    const txs = transactions.filter((t) => t.client_id === c.id);
    const totalIn = txs.filter((t) => t.type === 'in').reduce((a, x) => a + Number(x.amount), 0);
    const initials = c.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
    grid.insertAdjacentHTML('beforeend', `<div class="client-card glass">
      <div class="ch"><div class="avatar">${initials}</div>
        <div><h3>${c.name}</h3><div class="co">${c.company || '-'}</div></div>
      </div>
      <div style="font-size:11px;color:var(--text-muted);">
        ${c.phone ? '<i class="fa-solid fa-phone" style="width:14px;"></i> ' + c.phone + '<br>' : ''}
        ${c.email ? '<i class="fa-solid fa-envelope" style="width:14px;"></i> ' + c.email : ''}
      </div>
      <div class="stats">
        <div>Transaksi<strong>${txs.length}</strong></div>
        <div>Total Pemasukan<strong>${formatRp(totalIn)}</strong></div>
      </div>
      <div class="actions">
        <button class="btn btn-secondary btn-sm" style="flex:1;" onclick="editClient('${c.id}')"><i class="fa-solid fa-pen"></i> Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteClient('${c.id}')"><i class="fa-solid fa-trash"></i></button>
      </div>
    </div>`);
  });
}
export { renderClients };

/* ============================================================
   INVOICES
   ============================================================ */
export function showInvoiceList(): void {
  $('invoice-list-wrap').style.display = 'block';
  $('invoice-editor-wrap').style.display = 'none';
  renderInvoiceList();
}

function renderInvoiceList(): void {
  const q = ($<HTMLInputElement>('inv-filter-search').value || '').toLowerCase();
  const st = $<HTMLSelectElement>('inv-filter-status').value;
  let list = [...invoices].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  list = list.filter((i) => {
    const c = clientById(i.client_id);
    const matchQ = !q || i.number.toLowerCase().includes(q) || (c ? c.name.toLowerCase().includes(q) : false);
    return matchQ && (!st || i.status === st);
  });
  const tbody = $('inv-table-body'); tbody.innerHTML = '';
  $('inv-empty').style.display = list.length ? 'none' : 'block';
  list.forEach((i: Invoice) => {
    const c = clientById(i.client_id);
    const stClass = i.status === 'Lunas' ? 'st-lunas' : (i.status === 'Belum' ? 'st-belum' : 'st-draft');
    const stLabel = i.status === 'Lunas' ? 'Lunas' : (i.status === 'Belum' ? 'Belum Dibayar' : 'Draft');
    tbody.insertAdjacentHTML('beforeend', `<tr>
      <td><strong>${i.number}</strong></td>
      <td>${c ? c.name : '-'}</td>
      <td>${i.date || '-'}</td>
      <td style="text-align:right;font-weight:600;">${formatRp(i.total)}</td>
      <td><span class="status-pill ${stClass}">${stLabel}</span></td>
      <td style="text-align:right;">
        <button class="btn btn-secondary btn-sm" onclick="editInvoice('${i.id}')"><i class="fa-solid fa-pen"></i></button>
        <button class="btn btn-danger btn-sm" onclick="deleteInvoice('${i.id}')"><i class="fa-solid fa-trash"></i></button>
      </td>
    </tr>`);
  });
}
export { renderInvoiceList };

export function newInvoice(): void {
  $('invoice-list-wrap').style.display = 'none';
  $('invoice-editor-wrap').style.display = 'block';
  if (invoiceAutosaveTimer) { window.clearTimeout(invoiceAutosaveTimer); invoiceAutosaveTimer = undefined; }
  setAutosaveStatus('inv-autosave-status', '');
  $<HTMLInputElement>('inv-edit-id').value = '';
  $<HTMLInputElement>('inv-number').value = 'WST-INV-' + new Date().getFullYear() + '-' + String(invoices.length + 1).padStart(4, '0');
  $<HTMLSelectElement>('inv-status').value = 'Belum';
  $<HTMLInputElement>('inv-date').value = new Date().toISOString().slice(0, 10);
  $<HTMLInputElement>('inv-due').value = '';
  $<HTMLSelectElement>('inv-client').value = '';
  $<HTMLInputElement>('inv-desc').value = '';
  $<HTMLInputElement>('inv-discount').value = '0';
  $<HTMLInputElement>('inv-tax').value = '0';
  $('inv-items-body').innerHTML = '';
  addInvoiceItemRow();
  updateInvoicePreview();
}

export async function closeInvoiceEditor(): Promise<void> { await flushPendingAutosaves(); showInvoiceList(); }

export function addInvoiceItemRow(service = '', qty = 1, price = 0): void {
  const row = document.createElement('tr');
  row.className = 'inv-item-row';
  row.innerHTML = `
    <td><input type="text" class="item-service" placeholder="Nama layanan" value="${service}" oninput="updateInvoicePreview()"></td>
    <td><input type="number" class="item-qty" value="${qty}" min="1" oninput="updateInvoicePreview()"></td>
    <td><input type="number" class="item-price" value="${price}" min="0" oninput="updateInvoicePreview()"></td>
    <td><button class="btn btn-danger btn-sm" onclick="this.closest('tr').remove(); updateInvoicePreview();"><i class="fa-solid fa-xmark"></i></button></td>`;
  $('inv-items-body').appendChild(row);
  updateInvoicePreview();
}

/** Hitung total invoice dari form saat ini, tanpa menyentuh DOM preview (dipakai saat autosave). */
function computeInvoiceGrandTotal(): number {
  let subtotal = 0;
  document.querySelectorAll<HTMLTableRowElement>('.inv-item-row').forEach((row) => {
    const q = parseInt((row.querySelector('.item-qty') as HTMLInputElement).value) || 0;
    const p = parseFloat((row.querySelector('.item-price') as HTMLInputElement).value) || 0;
    subtotal += q * p;
  });
  const disc = parseFloat($<HTMLInputElement>('inv-discount').value) || 0;
  const tax = parseFloat($<HTMLInputElement>('inv-tax').value) || 0;
  const dAmt = subtotal * (disc / 100);
  const tAmt = (subtotal - dAmt) * (tax / 100);
  return (subtotal - dAmt) + tAmt;
}

export function updateInvoicePreview(): number {
  $('comp-name-fill').textContent = settings.company_name;
  $('comp-contact-fill').textContent = `${settings.email} | ${settings.wa}`;
  renderLogoSlot('prev-logo-slot', settings.logo, (settings.company_name || 'WS').slice(0, 2).toUpperCase());

  const status = $<HTMLSelectElement>('inv-status').value;
  const doc = $('invoiceDocToPrint');
  doc.className = 'invoice-document status-' + status;
  const stamp = $('prev-status-stamp');
  stamp.className = 'status-stamp stamp-' + status;
  stamp.textContent = status === 'Lunas' ? 'Lunas' : (status === 'Belum' ? 'Belum Dibayar' : 'Draft');

  $('prev-inv-number').textContent = $<HTMLInputElement>('inv-number').value || '-';
  $('prev-inv-date').textContent = $<HTMLInputElement>('inv-date').value || '-';
  $('prev-inv-due').textContent = $<HTMLInputElement>('inv-due').value || '-';
  $('prev-desc').textContent = $<HTMLInputElement>('inv-desc').value || '';

  const c = clientById($<HTMLSelectElement>('inv-client').value);
  $('prev-client-name').textContent = c ? c.name : 'Nama Klien';
  $('prev-client-company').textContent = c ? (c.company || '') : '';
  $('prev-client-contact').textContent = c ? [c.phone, c.email].filter(Boolean).join(' | ') : '';
  const clientLogoSlot = $('prev-client-logo-slot');
  if (c && c.logo) {
    clientLogoSlot.style.display = 'flex';
    renderLogoSlot('prev-client-logo-slot', c.logo, c.name.slice(0, 2).toUpperCase());
  } else {
    clientLogoSlot.style.display = 'none';
  }

  let subtotal = 0;
  const tbody = $('prev-items-body'); tbody.innerHTML = '';
  document.querySelectorAll<HTMLTableRowElement>('.inv-item-row').forEach((row) => {
    const s = (row.querySelector('.item-service') as HTMLInputElement).value || 'Layanan';
    const q = parseInt((row.querySelector('.item-qty') as HTMLInputElement).value) || 0;
    const p = parseFloat((row.querySelector('.item-price') as HTMLInputElement).value) || 0;
    const tot = q * p; subtotal += tot;
    tbody.insertAdjacentHTML('beforeend', `<tr><td>${s}</td><td style="text-align:center;">${q}</td><td style="text-align:right;">${formatRp(p)}</td><td style="text-align:right;">${formatRp(tot)}</td></tr>`);
  });

  const disc = parseFloat($<HTMLInputElement>('inv-discount').value) || 0;
  const tax = parseFloat($<HTMLInputElement>('inv-tax').value) || 0;
  const dAmt = subtotal * (disc / 100);
  const tAmt = (subtotal - dAmt) * (tax / 100);
  const grand = (subtotal - dAmt) + tAmt;

  $('prev-subtotal').textContent = formatRp(subtotal);
  $('prev-discount').textContent = formatRp(dAmt);
  $('prev-tax').textContent = formatRp(tAmt);
  $('prev-grand-total').textContent = formatRp(grand);

  scheduleInvoiceAutosave();
  return grand;
}

/**
 * Inti logika simpan invoice, dipakai baik oleh tombol "Simpan Invoice" (silent:false,
 * menampilkan alert & pindah ke daftar) maupun oleh auto-save senyap (silent:true,
 * berjalan di latar belakang tanpa mengganggu user yang masih mengetik).
 * Mengembalikan true kalau berhasil disimpan.
 */
async function buildAndSaveInvoice(silent: boolean): Promise<boolean> {
  if (!supabase) return false;
  const number = $<HTMLInputElement>('inv-number').value.trim();
  if (!number) { if (!silent) alert('Nomor invoice wajib diisi.'); return false; }
  const clientId = $<HTMLSelectElement>('inv-client').value;
  if (!clientId) { if (!silent) alert('Pilih klien terlebih dahulu.'); return false; }

  const items: InvoiceItem[] = [];
  document.querySelectorAll<HTMLTableRowElement>('.inv-item-row').forEach((row) => {
    items.push({
      service: (row.querySelector('.item-service') as HTMLInputElement).value,
      qty: parseInt((row.querySelector('.item-qty') as HTMLInputElement).value) || 0,
      price: parseFloat((row.querySelector('.item-price') as HTMLInputElement).value) || 0
    });
  });
  const total = computeInvoiceGrandTotal();
  const editId = $<HTMLInputElement>('inv-edit-id').value;
  const status = $<HTMLSelectElement>('inv-status').value;
  const payload = {
    number, client_id: clientId, status,
    date: $<HTMLInputElement>('inv-date').value,
    due: $<HTMLInputElement>('inv-due').value || null,
    description: $<HTMLInputElement>('inv-desc').value,
    discount: parseFloat($<HTMLInputElement>('inv-discount').value) || 0,
    tax: parseFloat($<HTMLInputElement>('inv-tax').value) || 0,
    items, total
  };

  let invoiceRow: Invoice | null = null;
  if (editId) {
    const { data, error } = await supabase.from('invoices').update(payload).eq('id', editId).select().single();
    if (reportSupabaseError(error, silent ? 'Auto-save Invoice' : 'Simpan Invoice')) return false;
    invoiceRow = data as Invoice;
  } else {
    const { data, error } = await supabase.from('invoices').insert(payload).select().single();
    if (reportSupabaseError(error, silent ? 'Auto-save Invoice' : 'Simpan Invoice')) return false;
    invoiceRow = data as Invoice;
    if (invoiceRow) $<HTMLInputElement>('inv-edit-id').value = invoiceRow.id; // supaya auto-save berikutnya UPDATE, bukan INSERT baru
  }
  if (!invoiceRow) return false;

  await supabase.from('transactions').delete().eq('invoice_id', invoiceRow.id);
  if (status === 'Lunas') {
    await supabase.from('transactions').insert({
      type: 'in', date: invoiceRow.date || new Date().toISOString().slice(0, 10),
      client_id: invoiceRow.client_id, invoice_id: invoiceRow.id,
      category: 'Invoice ' + invoiceRow.number, amount: invoiceRow.total,
      note: 'Otomatis dari invoice ' + invoiceRow.number
    });
  }
  return true;
}

let invoiceAutosaveTimer: number | undefined;
function scheduleInvoiceAutosave(): void {
  if (invoiceAutosaveTimer) window.clearTimeout(invoiceAutosaveTimer);
  setAutosaveStatus('inv-autosave-status', 'Menyimpan draf...');
  invoiceAutosaveTimer = window.setTimeout(async () => {
    invoiceAutosaveTimer = undefined;
    const ok = await buildAndSaveInvoice(true);
    setAutosaveStatus('inv-autosave-status', ok ? ('Tersimpan otomatis \u00B7 ' + nowTime()) : '');
    if (ok) await fetchAll(); // sinkronkan cache lokal, tanpa render ulang form yang sedang diisi
  }, 1100);
}

/** Kalau ada auto-save yang masih tertunda, simpan segera (dipanggil sebelum pindah halaman). */
async function flushPendingAutosaves(): Promise<void> {
  if (invoiceAutosaveTimer) {
    window.clearTimeout(invoiceAutosaveTimer);
    invoiceAutosaveTimer = undefined;
    await buildAndSaveInvoice(true);
  }
  if (receiptAutosaveTimer) {
    window.clearTimeout(receiptAutosaveTimer);
    receiptAutosaveTimer = undefined;
    await buildAndSaveReceipt(true);
  }
  await fetchAll();
}

function setAutosaveStatus(elId: string, text: string): void {
  const el = document.getElementById(elId);
  if (el) el.textContent = text;
}
function nowTime(): string {
  return new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

export async function saveInvoice(): Promise<void> {
  if (invoiceAutosaveTimer) { window.clearTimeout(invoiceAutosaveTimer); invoiceAutosaveTimer = undefined; }
  const ok = await buildAndSaveInvoice(false);
  if (!ok) return;
  await refreshAndRender();
  showInvoiceList();
}

export function editInvoice(id: string): void {
  const inv = invoices.find((i) => i.id === id);
  if (!inv) return;
  $('invoice-list-wrap').style.display = 'none';
  $('invoice-editor-wrap').style.display = 'block';
  if (invoiceAutosaveTimer) { window.clearTimeout(invoiceAutosaveTimer); invoiceAutosaveTimer = undefined; }
  setAutosaveStatus('inv-autosave-status', '');
  $<HTMLInputElement>('inv-edit-id').value = inv.id;
  $<HTMLInputElement>('inv-number').value = inv.number;
  $<HTMLSelectElement>('inv-status').value = inv.status;
  $<HTMLInputElement>('inv-date').value = inv.date || '';
  $<HTMLInputElement>('inv-due').value = inv.due || '';
  $<HTMLSelectElement>('inv-client').value = inv.client_id || '';
  $<HTMLInputElement>('inv-desc').value = inv.description || '';
  $<HTMLInputElement>('inv-discount').value = String(inv.discount || 0);
  $<HTMLInputElement>('inv-tax').value = String(inv.tax || 0);
  $('inv-items-body').innerHTML = '';
  (inv.items || []).forEach((it) => addInvoiceItemRow(it.service, it.qty, it.price));
  updateInvoicePreview();
}

export async function deleteInvoice(id: string): Promise<void> {
  if (!supabase || !confirm('Hapus invoice ini? Transaksi pemasukan terkait juga akan terhapus.')) return;
  await supabase.from('invoices').delete().eq('id', id);
  await refreshAndRender();
}

/* ============================================================
   RECEIPTS — TANDA TERIMA GAJI
   ============================================================ */
export function showReceiptList(): void {
  $('receipt-list-wrap').style.display = 'block';
  $('receipt-editor-wrap').style.display = 'none';
  renderReceiptList();
}

function renderReceiptList(): void {
  const q = ($<HTMLInputElement>('rcpt-filter-search').value || '').toLowerCase();
  const list = [...receipts]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .filter((r) => !q || r.employee_name.toLowerCase().includes(q));
  const tbody = $('rcpt-table-body'); tbody.innerHTML = '';
  $('rcpt-empty').style.display = list.length ? 'none' : 'block';
  list.forEach((r: Receipt) => {
    tbody.insertAdjacentHTML('beforeend', `<tr>
      <td><strong>${r.receipt_number || '-'}</strong></td>
      <td>${r.employee_name}</td>
      <td>${r.period || '-'}</td>
      <td>${r.date || '-'}</td>
      <td style="text-align:right;font-weight:600;">${formatRp(r.amount)}</td>
      <td style="text-align:right;">
        <button class="btn btn-secondary btn-sm" onclick="editReceipt('${r.id}')"><i class="fa-solid fa-pen"></i></button>
        <button class="btn btn-danger btn-sm" onclick="deleteReceipt('${r.id}')"><i class="fa-solid fa-trash"></i></button>
      </td>
    </tr>`);
  });
}
export { renderReceiptList };

export function newReceipt(): void {
  $('receipt-list-wrap').style.display = 'none';
  $('receipt-editor-wrap').style.display = 'block';
  if (receiptAutosaveTimer) { window.clearTimeout(receiptAutosaveTimer); receiptAutosaveTimer = undefined; }
  setAutosaveStatus('rcpt-autosave-status', '');
  $<HTMLInputElement>('rcpt-edit-id').value = '';
  $<HTMLInputElement>('rcpt-number').value = 'WST-KWT-' + new Date().getFullYear() + '-' + String(receipts.length + 1).padStart(4, '0');
  $<HTMLInputElement>('rcpt-date').value = new Date().toISOString().slice(0, 10);
  $<HTMLInputElement>('rcpt-employee').value = '';
  $<HTMLInputElement>('rcpt-position').value = '';
  $<HTMLInputElement>('rcpt-period').value = '';
  $<HTMLSelectElement>('rcpt-method').value = 'Transfer Bank';
  $<HTMLInputElement>('rcpt-amount').value = '';
  $<HTMLInputElement>('rcpt-note').value = '';
  updateReceiptPreview();
}

export async function closeReceiptEditor(): Promise<void> { await flushPendingAutosaves(); showReceiptList(); }

export function updateReceiptPreview(): void {
  renderLogoSlot('rprev-logo-slot', settings.logo, (settings.company_name || 'WS').slice(0, 2).toUpperCase());
  $('rprev-number').textContent = $<HTMLInputElement>('rcpt-number').value || '-';
  $('rprev-date').textContent = $<HTMLInputElement>('rcpt-date').value || '-';
  $('rprev-period').textContent = $<HTMLInputElement>('rcpt-period').value || '-';
  const emp = $<HTMLInputElement>('rcpt-employee').value || '-';
  $('rprev-employee').textContent = emp;
  $('rprev-position').textContent = $<HTMLInputElement>('rcpt-position').value || '-';
  $('rprev-method').textContent = $<HTMLSelectElement>('rcpt-method').value;
  const amount = parseFloat($<HTMLInputElement>('rcpt-amount').value) || 0;
  $('rprev-amount').textContent = formatRp(amount);
  $('rprev-terbilang').textContent = terbilang(amount);
  $('rprev-note').textContent = $<HTMLInputElement>('rcpt-note').value || '';
  scheduleReceiptAutosave();
}

/** Inti logika simpan tanda terima, dipakai tombol simpan (silent:false) maupun auto-save (silent:true). */
async function buildAndSaveReceipt(silent: boolean): Promise<boolean> {
  if (!supabase) return false;
  const employee_name = $<HTMLInputElement>('rcpt-employee').value.trim();
  const amount = parseFloat($<HTMLInputElement>('rcpt-amount').value);
  if (!employee_name) { if (!silent) alert('Nama karyawan wajib diisi.'); return false; }
  if (!amount || amount <= 0) { if (!silent) alert('Masukkan jumlah gaji yang valid.'); return false; }

  const editId = $<HTMLInputElement>('rcpt-edit-id').value;
  const payload = {
    receipt_number: $<HTMLInputElement>('rcpt-number').value.trim(),
    date: $<HTMLInputElement>('rcpt-date').value || new Date().toISOString().slice(0, 10),
    employee_name,
    position: $<HTMLInputElement>('rcpt-position').value.trim(),
    period: $<HTMLInputElement>('rcpt-period').value.trim(),
    method: $<HTMLSelectElement>('rcpt-method').value,
    amount,
    note: $<HTMLInputElement>('rcpt-note').value.trim()
  };

  let receiptRow: Receipt | null = null;
  if (editId) {
    const { data, error } = await supabase.from('receipts').update(payload).eq('id', editId).select().single();
    if (reportSupabaseError(error, silent ? 'Auto-save Tanda Terima' : 'Simpan Tanda Terima')) return false;
    receiptRow = data as Receipt;
  } else {
    const { data, error } = await supabase.from('receipts').insert(payload).select().single();
    if (reportSupabaseError(error, silent ? 'Auto-save Tanda Terima' : 'Simpan Tanda Terima')) return false;
    receiptRow = data as Receipt;
    if (receiptRow) $<HTMLInputElement>('rcpt-edit-id').value = receiptRow.id; // supaya auto-save berikutnya UPDATE
  }
  if (!receiptRow) return false;

  await supabase.from('transactions').delete().eq('receipt_id', receiptRow.id);
  await supabase.from('transactions').insert({
    type: 'out', date: receiptRow.date, receipt_id: receiptRow.id,
    category: 'Gaji - ' + receiptRow.employee_name, amount: receiptRow.amount,
    note: 'Otomatis dari tanda terima ' + (receiptRow.receipt_number || '')
  });
  return true;
}

let receiptAutosaveTimer: number | undefined;
function scheduleReceiptAutosave(): void {
  if (receiptAutosaveTimer) window.clearTimeout(receiptAutosaveTimer);
  setAutosaveStatus('rcpt-autosave-status', 'Menyimpan draf...');
  receiptAutosaveTimer = window.setTimeout(async () => {
    receiptAutosaveTimer = undefined;
    const ok = await buildAndSaveReceipt(true);
    setAutosaveStatus('rcpt-autosave-status', ok ? ('Tersimpan otomatis \u00B7 ' + nowTime()) : '');
    if (ok) await fetchAll();
  }, 1100);
}

export async function saveReceipt(): Promise<void> {
  if (receiptAutosaveTimer) { window.clearTimeout(receiptAutosaveTimer); receiptAutosaveTimer = undefined; }
  const ok = await buildAndSaveReceipt(false);
  if (!ok) return;
  await refreshAndRender();
  showReceiptList();
}

export function editReceipt(id: string): void {
  const r = receipts.find((x) => x.id === id);
  if (!r) return;
  $('receipt-list-wrap').style.display = 'none';
  $('receipt-editor-wrap').style.display = 'block';
  if (receiptAutosaveTimer) { window.clearTimeout(receiptAutosaveTimer); receiptAutosaveTimer = undefined; }
  setAutosaveStatus('rcpt-autosave-status', '');
  $<HTMLInputElement>('rcpt-edit-id').value = r.id;
  $<HTMLInputElement>('rcpt-number').value = r.receipt_number || '';
  $<HTMLInputElement>('rcpt-date').value = r.date || '';
  $<HTMLInputElement>('rcpt-employee').value = r.employee_name;
  $<HTMLInputElement>('rcpt-position').value = r.position || '';
  $<HTMLInputElement>('rcpt-period').value = r.period || '';
  $<HTMLSelectElement>('rcpt-method').value = r.method || 'Transfer Bank';
  $<HTMLInputElement>('rcpt-amount').value = String(r.amount);
  $<HTMLInputElement>('rcpt-note').value = r.note || '';
  updateReceiptPreview();
}

export async function deleteReceipt(id: string): Promise<void> {
  if (!supabase || !confirm('Hapus tanda terima ini? Transaksi pengeluaran terkait juga akan terhapus.')) return;
  await supabase.from('receipts').delete().eq('id', id);
  await refreshAndRender();
}

/* ============================================================
   PRINT — pindahkan dokumen ke #printRoot di level <body>
   agar tidak ada halaman kosong akibat sidebar/grid/sticky.
   ============================================================ */
export function printDocument(elementId: string): void {
  const source = document.getElementById(elementId);
  if (!source) return;
  let root = document.getElementById('printRoot');
  if (root) root.remove();
  root = document.createElement('div');
  root.id = 'printRoot';
  root.appendChild(source.cloneNode(true));
  document.body.appendChild(root);

  const cleanup = () => {
    const r = document.getElementById('printRoot');
    if (r) r.remove();
    window.removeEventListener('afterprint', cleanup);
  };
  // 'afterprint' lebih andal daripada setTimeout — baru bersih-bersih setelah
  // dialog print benar-benar ditutup, bukan tebak-tebakan durasi.
  window.addEventListener('afterprint', cleanup);
  window.print();
  // fallback kalau browser tidak memicu 'afterprint' (beberapa webview mobile)
  setTimeout(cleanup, 4000);
}

/**
 * Download dokumen sebagai file PDF sungguhan (bukan lewat dialog print browser).
 * Dipakai supaya hasil selalu bisa diunduh langsung, termasuk di HP/webview
 * yang seringkali tidak menampilkan opsi "Save as PDF" dengan baik.
 */
/**
 * Download dokumen sebagai file PDF sungguhan (bukan lewat dialog print browser).
 * Pakai jsPDF#html() dengan autoPaging:'text' supaya potongan ke halaman
 * berikutnya jatuh di antara baris/kata, bukan memotong tengah teks atau baris
 * tabel. Konten juga dirender ulang di lebar tetap (bukan lebar layar saat itu)
 * supaya proporsinya selalu konsisten baik dibuat dari HP maupun desktop.
 */
/**
 * Download dokumen sebagai file PDF sungguhan (bukan lewat dialog print browser).
 *
 * Pendekatan: render TIAP BLOK (child langsung dari dokumen — header, alamat,
 * tabel item, total, dst) sebagai screenshot terpisah lewat html2canvas —
 * supaya tampilan PERSIS sama seperti di layar (logo, warna, font semuanya
 * akurat). Lalu blok-blok itu ditempel satu per satu ke halaman PDF, dan
 * kalau sebuah blok tidak muat di sisa halaman, halaman baru dibuka SEBELUM
 * blok itu — jadi potongan halaman selalu jatuh di antar-blok, tidak pernah
 * memotong tengah tabel atau tengah teks.
 *
 * (Catatan: sebelumnya sempat dicoba jsPDF#html() yang me-render ulang CSS
 * dengan mesinnya sendiri — hasilnya berantakan karena tidak paham flexbox/
 * gradient dsb. Screenshot per-blok ini jauh lebih akurat.)
 */
export async function downloadPdf(elementId: string, filenamePrefix: string): Promise<void> {
  const source = document.getElementById(elementId);
  if (!source) return;

  const btns = document.querySelectorAll<HTMLButtonElement>('button');
  btns.forEach((b) => { b.disabled = true; });

  const FIXED_WIDTH_PX = 740; // lebar render tetap, agar hasil selalu proporsional
  const clone = source.cloneNode(true) as HTMLElement;
  clone.style.width = FIXED_WIDTH_PX + 'px';
  clone.style.maxWidth = 'none';
  clone.style.position = 'fixed';
  clone.style.left = '-99999px';
  clone.style.top = '0';
  clone.style.margin = '0';
  clone.style.boxShadow = 'none';
  document.body.appendChild(clone);

  try {
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
    const marginPt = 24;
    const pageWidthPt = pdf.internal.pageSize.getWidth();
    const pageHeightPt = pdf.internal.pageSize.getHeight();
    const contentWidthPt = pageWidthPt - marginPt * 2;
    const usableHeightPt = pageHeightPt - marginPt * 2;

    // Satu faktor skala tunggal untuk SEMUA blok, dihitung dari lebar total
    // wadah (clone), bukan lebar masing-masing blok — supaya proporsi antar
    // blok (yang punya inset/padding berbeda-beda) tetap konsisten dan tidak
    // ada yang "membesar" karena salah dipaksa memenuhi lebar halaman.
    const ptPerPx = contentWidthPt / FIXED_WIDTH_PX;

    const blocks = Array.from(clone.children).filter(
      (el) => el instanceof HTMLElement
    ) as HTMLElement[];
    const targets = blocks.length ? blocks : [clone];

    let cursorY = marginPt;
    let pageHasContent = false;

    for (const block of targets) {
      const canvas = await html2canvas(block, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
      const imgData = canvas.toDataURL('image/png');
      const xPt = marginPt + block.offsetLeft * ptPerPx;
      const imgWidthPt = block.offsetWidth * ptPerPx;
      const imgHeightPt = block.offsetHeight * ptPerPx;

      if (imgHeightPt > usableHeightPt) {
        // Blok ini sendirian lebih tinggi dari satu halaman penuh (mis. tabel
        // item sangat panjang) — potong per-halaman sebagai upaya terakhir.
        if (pageHasContent) { pdf.addPage(); cursorY = marginPt; pageHasContent = false; }
        const pxPerPt = canvas.width / imgWidthPt;
        let renderedPt = 0;
        let lastSliceHeightPt = 0;
        while (renderedPt < imgHeightPt) {
          const sliceHeightPt = Math.min(usableHeightPt, imgHeightPt - renderedPt);
          const sliceCanvas = document.createElement('canvas');
          sliceCanvas.width = canvas.width;
          sliceCanvas.height = Math.round(sliceHeightPt * pxPerPt);
          const ctx = sliceCanvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(canvas, 0, Math.round(renderedPt * pxPerPt), canvas.width, sliceCanvas.height, 0, 0, canvas.width, sliceCanvas.height);
            pdf.addImage(sliceCanvas.toDataURL('image/png'), 'PNG', xPt, marginPt, imgWidthPt, sliceHeightPt);
          }
          renderedPt += sliceHeightPt;
          lastSliceHeightPt = sliceHeightPt;
          if (renderedPt < imgHeightPt) pdf.addPage();
        }
        cursorY = marginPt + lastSliceHeightPt;
        pageHasContent = true;
        continue;
      }

      if (pageHasContent && cursorY + imgHeightPt > marginPt + usableHeightPt) {
        pdf.addPage();
        cursorY = marginPt;
        pageHasContent = false;
      }

      pdf.addImage(imgData, 'PNG', xPt, cursorY, imgWidthPt, imgHeightPt);
      cursorY += imgHeightPt;
      pageHasContent = true;
    }

    const stamp = new Date().toISOString().slice(0, 10);
    pdf.save(`${filenamePrefix}-${stamp}.pdf`);
  } catch (err) {
    console.error(err);
    alert('Gagal membuat PDF. Coba pakai tombol "Print" sebagai alternatif.');
  } finally {
    document.body.removeChild(clone);
    btns.forEach((b) => { b.disabled = false; });
  }
}

/* ============================================================
   SETTINGS
   ============================================================ */
function loadSettingsForm(): void {
  $<HTMLInputElement>('set-company-name').value = settings.company_name;
  $<HTMLInputElement>('set-address').value = settings.address;
  $<HTMLInputElement>('set-email').value = settings.email;
  $<HTMLInputElement>('set-wa').value = settings.wa;
  $<HTMLInputElement>('settings-logo-data').value = settings.logo || '';
  renderLogoSlot('settings-logo-preview', settings.logo, (settings.company_name || 'WS').slice(0, 2).toUpperCase());
}

export async function onSettingsLogoChange(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files && input.files[0];
  if (!file) return;
  const dataUrl = await readFileAsDataUrl(file);
  $<HTMLInputElement>('settings-logo-data').value = dataUrl;
  renderLogoSlot('settings-logo-preview', dataUrl, 'WS');
}
export function clearSettingsLogo(): void {
  $<HTMLInputElement>('settings-logo-data').value = '';
  $<HTMLInputElement>('settings-logo-input').value = '';
  renderLogoSlot('settings-logo-preview', null, 'WS');
}

export async function saveSettings(): Promise<void> {
  if (!supabase) return;
  const payload = {
    id: 1,
    company_name: $<HTMLInputElement>('set-company-name').value.trim() || 'WESITE',
    address: $<HTMLInputElement>('set-address').value.trim(),
    email: $<HTMLInputElement>('set-email').value.trim(),
    wa: $<HTMLInputElement>('set-wa').value.trim(),
    logo: $<HTMLInputElement>('settings-logo-data').value || null
  };
  const { error } = await supabase.from('app_settings').upsert(payload);
  if (reportSupabaseError(error, 'Simpan Pengaturan')) return;
  await refreshAndRender();
  alert('Pengaturan disimpan.');
}

export function exportData(): void {
  const blob = new Blob([JSON.stringify({ transactions, clients, invoices, receipts, settings }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'wesite-finance-backup.json'; a.click();
  URL.revokeObjectURL(url);
}
