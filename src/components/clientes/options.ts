import type { CompanyPorte, TaxRegime } from '@/types/firestore';

export const REGIMES: readonly { value: TaxRegime; label: string; short: string }[] = [
  { value: 'SIMPLES_NACIONAL', label: 'Simples Nacional', short: 'Simples' },
  { value: 'LUCRO_PRESUMIDO', label: 'Lucro Presumido', short: 'Presumido' },
  { value: 'LUCRO_REAL', label: 'Lucro Real', short: 'Real' },
  { value: 'MEI', label: 'MEI', short: 'MEI' },
];

export const regimeLabel = (r: TaxRegime) => REGIMES.find((x) => x.value === r)?.label ?? r;

export const PORTES: readonly CompanyPorte[] = ['MICROENTIDADE', 'PEQUENA_EMPRESA'];
