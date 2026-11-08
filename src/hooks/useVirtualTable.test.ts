import { describe, expect, it } from 'vitest';
import { computeVirtualWindow } from '@/hooks/useVirtualTable';

describe('virtualização de tabelas longas (computeVirtualWindow)', () => {
  it('não virtualiza listas pequenas abaixo do limiar minItemsForVirtualization', () => {
    const res = computeVirtualWindow({
      totalCount: 40,
      rowHeight: 40,
      viewportHeight: 500,
      scrollTop: 0,
      minItemsForVirtualization: 60,
    });

    expect(res.isVirtualized).toBe(false);
    expect(res.startIndex).toBe(0);
    expect(res.endIndex).toBe(40);
    expect(res.offsetTop).toBe(0);
    expect(res.offsetBottom).toBe(0);
    expect(res.totalHeight).toBe(1600);
  });

  it('renderiza apenas a janela ativa + overscan no topo de uma lista de 5.000 lançamentos', () => {
    const rowHeight = 40;
    const totalCount = 5000;
    const res = computeVirtualWindow({
      totalCount,
      rowHeight,
      viewportHeight: 400, // 10 linhas visíveis
      scrollTop: 0,
      overscan: 5,
      minItemsForVirtualization: 60,
    });

    expect(res.isVirtualized).toBe(true);
    expect(res.startIndex).toBe(0);
    expect(res.endIndex).toBe(15); // 10 visíveis + 5 overscan inferior
    expect(res.offsetTop).toBe(0);
    expect(res.offsetBottom).toBe((5000 - 15) * 40);
    expect(res.offsetTop + (res.endIndex - res.startIndex) * rowHeight + res.offsetBottom).toBe(res.totalHeight);
  });

  it('atualiza índices e espaçadores mantendo altura total invariante ao rolar para o meio da lista', () => {
    const rowHeight = 40;
    const totalCount = 10000;
    const res = computeVirtualWindow({
      totalCount,
      rowHeight,
      viewportHeight: 600, // 15 linhas visíveis
      scrollTop: 40000, // linha 1000 no topo
      overscan: 10,
      minItemsForVirtualization: 60,
    });

    expect(res.isVirtualized).toBe(true);
    expect(res.startIndex).toBe(990); // 1000 - 10
    expect(res.endIndex).toBe(1025); // 1000 + 15 + 10
    expect(res.offsetTop).toBe(990 * 40);
    expect(res.offsetBottom).toBe((10000 - 1025) * 40);
    expect(res.offsetTop + (res.endIndex - res.startIndex) * rowHeight + res.offsetBottom).toBe(res.totalHeight);
  });

  it('limita os índices corretamente ao rolar até o final da tabela', () => {
    const rowHeight = 40;
    const totalCount = 1000;
    const res = computeVirtualWindow({
      totalCount,
      rowHeight,
      viewportHeight: 400,
      scrollTop: 999999, // além do fim
      overscan: 5,
      minItemsForVirtualization: 60,
    });

    expect(res.isVirtualized).toBe(true);
    expect(res.endIndex).toBe(1000);
    expect(res.offsetBottom).toBe(0);
    expect(res.startIndex).toBe(985); // (1000 - 10) - 5
  });

  it('desativa o janelamento e renderiza 100% das linhas quando disabled=true (ex.: @media print)', () => {
    const res = computeVirtualWindow({
      totalCount: 3500,
      rowHeight: 40,
      viewportHeight: 500,
      scrollTop: 12000,
      overscan: 10,
      minItemsForVirtualization: 60,
      disabled: true,
    });

    expect(res.isVirtualized).toBe(false);
    expect(res.startIndex).toBe(0);
    expect(res.endIndex).toBe(3500);
    expect(res.offsetTop).toBe(0);
    expect(res.offsetBottom).toBe(0);
  });
});

