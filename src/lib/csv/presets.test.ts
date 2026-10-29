import { describe, expect, it } from 'vitest';
import type { BankAccount } from '@/types/firestore';
import { accountKeyOf } from '@/lib/statement';
import {
  clampMappingToColumns,
  headersMatchSignature,
  isMappingCompatible,
  resolveInitialCSVConfig,
  toOFXAccountInfo,
} from '@/lib/csv/presets';

describe('presets e memorização de CSV por conta', () => {
  it('reconhece cabeçalhos embutidos de bancos e cartões brasileiros', () => {
    const nubankCard = 'date,title,amount\n2025-03-10,Uber,34.90\n2025-03-11,Pagamento recebido,-500.00';
    const resolvedCard = resolveInitialCSVConfig(nubankCard);
    expect(resolvedCard.source).toBe('preset');
    expect(resolvedCard.presetId).toBe('nubank-card');
    expect(resolvedCard.delimiter).toBe(',');
    expect(resolvedCard.mapping).toMatchObject({
      dateCol: 0,
      memoCol: 1,
      amountCol: 2,
      invertSigns: true,
    });

    const nubankConta = 'Data,Valor,Identificador,Descrição\n10/03/2025,-120.50,abc-123,Pix enviado';
    const resolvedConta = resolveInitialCSVConfig(nubankConta);
    expect(resolvedConta.source).toBe('preset');
    expect(resolvedConta.presetId).toBe('nubank-conta');
    expect(resolvedConta.mapping).toMatchObject({
      dateCol: 0,
      amountCol: 1,
      docCol: 2,
      memoCol: 3,
      invertSigns: false,
    });
  });

  it('prioriza o formato memorizado na conta bancária quando compatível com o arquivo', () => {
    const bank: BankAccount = {
      id: 'c1_card-corp',
      clientId: 'c1',
      accountKey: 'card-corp',
      kind: 'CARD',
      nickname: 'Cartão Corporativo',
      csvPreset: {
        delimiter: ';',
        headerSignature: ['dt', 'estab', 'categoria', 'vlr'],
        mapping: {
          dateCol: 0,
          memoCol: 1,
          valueMode: 'single',
          amountCol: 3,
          invertSigns: true,
          hasHeader: true,
        },
      },
      createdAt: '',
      updatedAt: '',
    };

    const csv = 'Dt;Estab;Categoria;Vlr\n15/03/2025; Kalunga ;Papelaria;89,90';
    const resolved = resolveInitialCSVConfig(csv, bank);
    expect(resolved.source).toBe('saved');
    expect(resolved.delimiter).toBe(';');
    expect(resolved.mapping.amountCol).toBe(3);
    expect(resolved.mapping.invertSigns).toBe(true);

    // Se o arquivo tiver menos colunas do que o preset salvo exige, cai para detecção segura.
    const incompatibleCsv = 'Data,Historico,Valor\n15/03/2025,Tarifa,-15.00';
    const fallback = resolveInitialCSVConfig(incompatibleCsv, bank);
    expect(fallback.source).toBe('auto');
    expect(fallback.delimiter).toBe(',');
  });

  it('valida compatibilidade e limita índices de colunas ao tamanho do CSV', () => {
    expect(
      isMappingCompatible(
        { dateCol: 0, memoCol: 1, valueMode: 'single', amountCol: 4, hasHeader: true },
        3
      )
    ).toBe(false);
    expect(
      isMappingCompatible(
        { dateCol: 0, memoCol: 1, valueMode: 'split', debitCol: 2, creditCol: 3, hasHeader: true },
        4
      )
    ).toBe(true);

    const clamped = clampMappingToColumns(
      { dateCol: 0, memoCol: 4, valueMode: 'single', amountCol: 8, docCol: 7, hasHeader: true },
      3
    );
    expect(clamped.memoCol).toBeLessThan(3);
    expect(clamped.amountCol).toBeLessThan(3);
    expect(clamped.docCol).toBeUndefined();

    expect(headersMatchSignature(['Data', 'Histórico', 'Valor'], ['data', 'historico', 'valor'])).toBe(true);
    expect(headersMatchSignature(['Data', 'Valor'], ['data', 'historico', 'valor'])).toBe(false);
  });

  it('preserva exatamente o accountKey ao montar OFXAccountInfo para contas OFX e manuais', () => {
    const ofxBank: BankAccount = {
      id: 'c1_0341-1234-55555-5',
      clientId: 'c1',
      accountKey: '0341-1234-55555-5',
      bankId: '0341',
      branchId: '1234',
      accountNumber: '55555-5',
      nickname: 'Itaú Movimento',
      createdAt: '',
      updatedAt: '',
    };
    expect(accountKeyOf(toOFXAccountInfo(ofxBank, ofxBank.accountKey))).toBe('0341-1234-55555-5');

    const manualCard: BankAccount = {
      id: 'c1_card-nubank',
      clientId: 'c1',
      accountKey: 'card-nubank',
      kind: 'CARD',
      nickname: 'Cartão Nubank',
      createdAt: '',
      updatedAt: '',
    };
    expect(accountKeyOf(toOFXAccountInfo(manualCard, manualCard.accountKey))).toBe('card-nubank');
  });
});

