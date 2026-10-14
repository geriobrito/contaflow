import { describe, expect, it } from 'vitest';
import { cleanCNPJ, formatCNPJ, isValidCNPJ, isValidCPF, maskCNPJ, maskCPF, normalizeCRC } from '@/lib/utils/formatters';

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
    expect(isValidCNPJ('11222333000181')).toBe(true);
    expect(isValidCNPJ('11.222.333/0001-82')).toBe(false);
    expect(isValidCNPJ('00.000.000/0000-00')).toBe(false);
    expect(isValidCNPJ('11.111.111/1111-11')).toBe(false);
    expect(isValidCNPJ('1122233300018')).toBe(false);
    expect(maskCNPJ('11222333000181')).toBe('11.222.333/0001-81');
    expect(maskCNPJ('112223')).toBe('11.222.3');
    expect(formatCNPJ('11222333000181')).toBe('11.222.333/0001-81');
  });

  it('CNPJ alfanumérico (IN RFB 2.229/2024): letras nas 12 primeiras posições, DV numérico', () => {
    // Exemplo oficial da RFB.
    expect(isValidCNPJ('12.ABC.345/01DE-35')).toBe(true);
    expect(isValidCNPJ('12ABC34501DE35')).toBe(true);
    expect(isValidCNPJ('12.abc.345/01de-35')).toBe(true);
    expect(isValidCNPJ('12.ABC.345/01DE-36')).toBe(false);
    expect(isValidCNPJ('12.ABD.345/01DE-35')).toBe(false);
    // DV com letra não existe.
    expect(isValidCNPJ('12.ABC.345/01DE-3A')).toBe(false);
  });

  it('CNPJ alfanumérico: limpeza, formatação e máscara progressiva', () => {
    expect(cleanCNPJ('12.abc.345/01de-35')).toBe('12ABC34501DE35');
    expect(formatCNPJ('12abc34501de35')).toBe('12.ABC.345/01DE-35');
    // Formato inválido é devolvido como veio.
    expect(formatCNPJ('12.ABC.345/01DE-3A')).toBe('12.ABC.345/01DE-3A');
    expect(maskCNPJ('12abc34501de35')).toBe('12.ABC.345/01DE-35');
    expect(maskCNPJ('12ab')).toBe('12.AB');
    // Letras depois da 12ª posição (DV) são descartadas; o excesso também.
    expect(maskCNPJ('12ABC34501DEX35')).toBe('12.ABC.345/01DE-35');
    expect(maskCNPJ('12ABC34501DE3599')).toBe('12.ABC.345/01DE-35');
  });

  it('CRC: UF + número, categoria e dígito opcionais', () => {
    expect(normalizeCRC('sp-123456/o-5')).toBe('SP-123456/O-5');
    expect(normalizeCRC('RJ 098765')).toBe('RJ-098765');
    expect(normalizeCRC('MG123456')).toBe('MG-123456');
    expect(normalizeCRC('123456')).toBeNull();
    expect(normalizeCRC('SP-12')).toBeNull();
  });
});
