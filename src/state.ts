import { supabase } from './supabaseClient';
import type { Client, Transaction, Invoice, Receipt, AppSettings } from './types';

export let clients: Client[] = [];
export let transactions: Transaction[] = [];
export let invoices: Invoice[] = [];
export let receipts: Receipt[] = [];
export let settings: AppSettings = {
  company_name: 'WESITE',
  address: 'Yogyakarta, Indonesia',
  email: 'wesite.id@gmail.com',
  wa: '+62 896 8894 6655',
  logo: null
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export let realtimeChannel: any = null;

export function clientById(id: string | null | undefined): Client | undefined {
  return clients.find((c) => c.id === id);
}

export async function fetchAll(): Promise<void> {
  if (!supabase) return;
  const [cRes, tRes, iRes, rRes, sRes] = await Promise.all([
    supabase.from('clients').select('*').order('created_at', { ascending: false }),
    supabase.from('transactions').select('*').order('date', { ascending: false }),
    supabase.from('invoices').select('*').order('date', { ascending: false }),
    supabase.from('receipts').select('*').order('date', { ascending: false }),
    supabase.from('app_settings').select('*').eq('id', 1).maybeSingle()
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const errors = [cRes.error, tRes.error, iRes.error, rRes.error, sRes.error].filter(Boolean) as any[];
  if (errors.length) {
    // Lempar supaya app.ts bisa menampilkan banner yang jelas ke pengguna,
    // alih-alih diam-diam menampilkan aplikasi kosong tanpa penjelasan
    // (mis. saat project Supabase sedang pause).
    throw new Error(errors.map((e) => e.message).join(' | '));
  }
  clients = (cRes.data as Client[]) || [];
  transactions = (tRes.data as Transaction[]) || [];
  invoices = (iRes.data as Invoice[]) || [];
  receipts = (rRes.data as Receipt[]) || [];
  if (sRes.data) settings = sRes.data as AppSettings;
}

export function setupRealtime(onChange: () => void): void {
  if (!supabase || realtimeChannel) return;
  realtimeChannel = supabase
    .channel('wesite-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'clients' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'receipts' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'app_settings' }, onChange)
    .subscribe();
}

export function teardownRealtime(): void {
  if (supabase && realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
}
