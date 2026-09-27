/**
 * Formata um valor numérico para a moeda brasileira Real (BRL)
 */
export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

/**
 * Formata data no padrão brasileiro (DD/MM/AAAA) a partir de string ISO YYYY-MM-DD
 */
export function formatDateBR(dateStr?: string): string {
  if (!dateStr) return '-';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateStr;
}

/**
 * Formata CNPJ (XX.XXX.XXX/XXXX-XX)
 */
export function formatCNPJ(cnpj: string): string {
  const digits = cnpj.replace(/\D/g, '');
  if (digits.length !== 14) return cnpj;
  return digits.replace(
    /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
    '$1.$2.$3/$4-$5'
  );
}

/**
 * Remove caracteres não numéricos
 */
export function cleanDigits(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * Valida CNPJ pelos dígitos verificadores (módulo 11).
 */
export function isValidCNPJ(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 14 || /^(\d)\1{13}$/.test(digits)) return false;
  const calc = (length: number): number => {
    let sum = 0;
    let weight = length - 7;
    for (let i = 0; i < length; i++) {
      sum += Number(digits[i]) * weight--;
      if (weight < 2) weight = 9;
    }
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return calc(12) === Number(digits[12]) && calc(13) === Number(digits[13]);
}

/**
 * Máscara progressiva de CNPJ enquanto o usuário digita.
 */
export function maskCNPJ(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

/**
 * Valida CPF pelos dígitos verificadores (módulo 11).
 */
export function isValidCPF(value: string): boolean {
  const d = value.replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const check = (len: number): number => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return check(9) === Number(d[9]) && check(10) === Number(d[10]);
}

/** Máscara progressiva de CPF (000.000.000-00). */
export function maskCPF(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1-$2');
}

/**
 * Registro no CRC: UF + número, com categoria opcional (ex.: "SP-123456/O-5", "RJ 098765").
 * Retorna a forma normalizada ou null se inválido.
 */
export function normalizeCRC(value: string): string | null {
  const m = value
    .trim()
    .toUpperCase()
    .match(/^([A-Z]{2})\s*[-/ ]?\s*(\d{3,7})(?:\s*\/\s*([OPST]))?(?:\s*-\s*(\d))?$/);
  if (!m) return null;
  const [, uf, num, cat, dv] = m;
  return `${uf}-${num}${cat ? `/${cat}` : ''}${dv ? `-${dv}` : ''}`;
}
