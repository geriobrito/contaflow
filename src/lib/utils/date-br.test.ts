import { describe, expect, it } from 'vitest';
import { isoToBR, maskDateBR, parseDateBR } from '@/lib/utils/date-br';

describe('datas DD/MM/AAAA', () => {
  it('máscara enquanto digita', () => {
    expect(maskDateBR('1')).toBe('1');
    expect(maskDateBR('150')).toBe('15/0');
    expect(maskDateBR('15032019')).toBe('15/03/2019');
    expect(maskDateBR('15/03/2019999')).toBe('15/03/2019');
  });
  it('converte e valida', () => {
    expect(parseDateBR('15/03/2019')).toBe('2019-03-15');
    expect(parseDateBR('31/02/2019')).toBeNull();
    expect(parseDateBR('15/03/19')).toBeNull();
    expect(isoToBR('2019-03-15')).toBe('15/03/2019');
    expect(isoToBR(undefined)).toBe('');
  });
});
