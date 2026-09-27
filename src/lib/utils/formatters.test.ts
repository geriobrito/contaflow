import { describe, expect, it } from 'vitest';
import { isValidCNPJ, isValidCPF, maskCNPJ, maskCPF, normalizeCRC } from '@/lib/utils/formatters';

describe('documentos', () => {
  it('CPF: dígitos verificadores, sequências repetidas e máscara', () => {
    expect(isValidCPF('529.982.247-25')).toBe(true);
    expect(isValidCPF('52998224724')).toBe(false);
    expect(isValidCPF('111.111.111-11')).toBe(false);
    expect(isValidCPF('123')).toBe(false);
    expect(maskCPF('52998224725')).toBe('529.982.247-25');
    expect(maskCPF('5299')).toBe('529.9');
  });

  it('CNPJ: dígitos verificadores e máscara', () => {
    expect(isValidCNPJ('11.222.333/0001-81')).toBe(true);
    expect(isValidCNPJ('11.222.333/0001-82')).toBe(false);
    expect(maskCNPJ('11222333000181')).toBe('11.222.333/0001-81');
  });

  it('CRC: UF + número, categoria e dígito opcionais', () => {
    expect(normalizeCRC('sp-123456/o-5')).toBe('SP-123456/O-5');
    expect(normalizeCRC('RJ 098765')).toBe('RJ-098765');
    expect(normalizeCRC('MG123456')).toBe('MG-123456');
    expect(normalizeCRC('123456')).toBeNull();
    expect(normalizeCRC('SP-12')).toBeNull();
  });
});
