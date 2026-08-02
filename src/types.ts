export interface Client {
  id: string;
  name: string;
  company?: string | null;
  phone?: string | null;
  email?: string | null;
  created_at?: string;
}

export type TransactionType = 'in' | 'out';

export interface Transaction {
  id: string;
  type: TransactionType;
  date: string;
  client_id?: string | null;
  invoice_id?: string | null;
  receipt_id?: string | null;
  category?: string | null;
  amount: number;
  note?: string | null;
  created_at?: string;
}

export interface InvoiceItem {
  service: string;
  qty: number;
  price: number;
}

export type InvoiceStatus = 'Lunas' | 'Belum' | 'Draft';

export interface Invoice {
  id: string;
  number: string;
  client_id: string | null;
  status: InvoiceStatus;
  date: string;
  due?: string | null;
  description?: string | null;
  discount: number;
  tax: number;
  items: InvoiceItem[];
  total: number;
  created_at?: string;
}

export interface Receipt {
  id: string;
  receipt_number?: string | null;
  employee_name: string;
  position?: string | null;
  period?: string | null;
  amount: number;
  date: string;
  method?: string | null;
  note?: string | null;
  created_at?: string;
}

export interface AppSettings {
  id?: number;
  company_name: string;
  address: string;
  email: string;
  wa: string;
}
