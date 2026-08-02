export function formatRp(n: number | null | undefined): string {
  return 'Rp ' + (Number(n) || 0).toLocaleString('id-ID');
}

/** Ubah angka menjadi terbilang Bahasa Indonesia, dipakai di kwitansi gaji. */
export function terbilang(n: number): string {
  const num = Math.floor(Math.abs(Number(n) || 0));
  const satuan = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];

  function toWords(value: number): string {
    if (value < 12) return satuan[value];
    if (value < 20) return toWords(value - 10) + ' belas';
    if (value < 100) return toWords(Math.floor(value / 10)) + ' puluh' + (value % 10 ? ' ' + toWords(value % 10) : '');
    if (value < 200) return 'seratus' + (value % 100 ? ' ' + toWords(value % 100) : '');
    if (value < 1000) return toWords(Math.floor(value / 100)) + ' ratus' + (value % 100 ? ' ' + toWords(value % 100) : '');
    if (value < 2000) return 'seribu' + (value % 1000 ? ' ' + toWords(value % 1000) : '');
    if (value < 1000000) return toWords(Math.floor(value / 1000)) + ' ribu' + (value % 1000 ? ' ' + toWords(value % 1000) : '');
    if (value < 1000000000) return toWords(Math.floor(value / 1000000)) + ' juta' + (value % 1000000 ? ' ' + toWords(value % 1000000) : '');
    return toWords(Math.floor(value / 1000000000)) + ' miliar' + (value % 1000000000 ? ' ' + toWords(value % 1000000000) : '');
  }

  if (num === 0) return 'nol rupiah';
  let words = toWords(num).trim().replace(/\s+/g, ' ');
  words = words.charAt(0).toUpperCase() + words.slice(1);
  return words + ' rupiah';
}

/** Ubah username tampilan (mis. @HEND_RIAN) menjadi email internal untuk Supabase Auth. */
export function usernameToEmail(rawUsername: string): string {
  let u = (rawUsername || '').trim().toLowerCase();
  if (u.startsWith('@')) u = u.slice(1);
  return u + '@internal.wesite.id';
}
