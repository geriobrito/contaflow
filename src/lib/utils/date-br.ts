import { isISODate } from '@/lib/periods';

/** Máscara DD/MM/AAAA enquanto digita. */
export function maskDateBR(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 8);
  if (d.length > 4) return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
  if (d.length > 2) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return d;
}

/** DD/MM/AAAA → YYYY-MM-DD; null se incompleta ou se o dia não existe (31/02). */
export function parseDateBR(value: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  return isISODate(iso) ? iso : null;
}

/** YYYY-MM-DD → DD/MM/AAAA (vazio se não for data). */
export function isoToBR(iso: string | null | undefined): string {
  return iso && isISODate(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '';
}
