import { beforeAll, describe, expect, it } from 'vitest';
import type { FixedAsset } from '@/types/firestore';
import { buildITG1000Chart } from '@/lib/chart/itg1000';
import { setSession } from '@/lib/data/scope';
import { getRepository } from '@/lib/services/data-service';
import { closeMonth } from '@/lib/services/reconciliation-service';
import {
  disposeFixedAsset,
  loadFixedAssetContext,
  loadMonthDepreciation,
  postMonthDepreciation,
  saveFixedAsset,
  undoFixedAssetDisposal,
} from '@/lib/services/fixed-asset-service';

const CLIENT = 'imob';

const car = (accountId: string, over: Partial<FixedAsset> = {}): FixedAsset => ({
  id: 'fa1',
  description: 'Veículo de passeio',
  accountId,
  accountCode: '1.2.3.04',
  accountName: 'Veículos',
  use: 'EXPENSE',
  acquisitionDate: '2025-03-01',
  inUseDate: '2025-03-01',
  invoiceValue: 72280,
  annualRate: 20,
  createdAt: '',
  updatedAt: '',
  ...over,
});

describe('rotina do imobilizado (repositório local)', () => {
  beforeAll(async () => {
    setSession('local', { uid: 'u1', email: 'contador@teste' });
    const repo = getRepository();
    await repo.saveClient({ id: CLIENT, name: 'Imob Ltda', cnpj: '11222333000181', regime: 'SIMPLES_NACIONAL', createdAt: '', updatedAt: '' });
    // Plano antigo, sem as contas novas (3.2.1.04 e 1.1.2.11): a rotina as cria quando precisa.
    await repo.insertAccounts(buildITG1000Chart(CLIENT).filter((a) => a.code !== '3.2.1.04' && a.code !== '1.1.2.11'));
  });

  it('sem bens, não bloqueia o fechamento', async () => {
    expect(await loadMonthDepreciation(CLIENT, '2025-02')).toBeNull();
  });

  it('cadastra, exige a depreciação para fechar, lança e fecha; o bem trava', async () => {
    const accounts = await getRepository().listAccounts(CLIENT);
    const vehicles = accounts.find((a) => a.code === '1.2.3.04')!;
    await saveFixedAsset(CLIENT, car(vehicles.id, { use: 'COST' }), await loadFixedAssetContext(CLIENT));

    await expect(closeMonth(CLIENT, '2025-03')).rejects.toThrow(/Lance a depreciação de 03\/2025/);
    expect(await postMonthDepreciation(CLIENT, '2025-03', 'u1')).toBe('created');
    expect((await getRepository().listAccounts(CLIENT)).some((a) => a.code === '3.2.1.04')).toBe(true);
    const [entry] = await getRepository().listJournalEntries(CLIENT);
    expect(entry.depreciationMonth).toBe('2025-03');
    expect(entry.lines.map((l) => [l.accountCode, l.type, l.amount])).toEqual([
      ['3.2.1.04', 'DEBIT', 1204.67],
      ['1.2.3.07', 'CREDIT', 1204.67],
    ]);
    expect(await postMonthDepreciation(CLIENT, '2025-03', 'u1')).toBe('none');

    await closeMonth(CLIENT, '2025-03');
    const ctx = await loadFixedAssetContext(CLIENT);
    await expect(saveFixedAsset(CLIENT, { ...ctx.register!.assets[0], annualRate: 10 }, ctx)).rejects.toThrow(/competência fechada/);
    await saveFixedAsset(CLIENT, { ...ctx.register!.assets[0], description: 'Carro' }, ctx);
    expect((await getRepository().getFixedAssets(CLIENT))?.assets[0].description).toBe('Carro');
  });

  it('venda grava a receita e a baixa juntas (criando a conta a receber) e desfaz junto', async () => {
    const ctx = await loadFixedAssetContext(CLIENT);
    const asset = ctx.register!.assets[0];
    await postMonthDepreciation(CLIENT, '2025-04', 'u1');
    await expect(disposeFixedAsset(CLIENT, asset, { date: '2025-04-30', reason: 'SALE' }, ctx, 'u1')).rejects.toThrow(/valor da venda/);
    const sale = { amount: 70000, buyer: 'Fulano', invoiceRef: '123' };
    const entry = await disposeFixedAsset(CLIENT, asset, { date: '2025-04-30', reason: 'SALE', sale }, ctx, 'u1');
    expect((await getRepository().listAccounts(CLIENT)).some((a) => a.code === '1.1.2.11')).toBe(true);
    expect(entry?.fixedAssetId).toBe('fa1');
    expect(entry?.lines.map((l) => [l.accountCode, l.type, l.amount])).toEqual([
      ['1.1.2.11', 'DEBIT', 70000],
      ['3.3.9.02', 'CREDIT', 70000],
      ['1.2.3.07', 'DEBIT', 2409.34],
      ['3.3.9.04', 'DEBIT', 69870.66],
      ['1.2.3.04', 'CREDIT', 72280],
    ]);
    expect(entry?.lines[0].memo).toBe('Venda do bem Carro a Fulano, NF 123');
    const after = await loadFixedAssetContext(CLIENT);
    expect(after.register!.assets[0].disposal?.journalEntryId).toBe(entry!.id);
    expect(after.register!.assets[0].disposal?.sale).toEqual(sale);
    // Depois da baixa não há cota em maio.
    expect((await loadMonthDepreciation(CLIENT, '2025-05'))?.status.kind).toBe('NONE');

    await undoFixedAssetDisposal(CLIENT, after.register!.assets[0], after);
    expect((await getRepository().getFixedAssets(CLIENT))?.assets[0].disposal).toBeUndefined();
    expect((await getRepository().listJournalEntries(CLIENT)).some((e) => e.fixedAssetId)).toBe(false);
  });

  it('intangível da microentidade: prazo máximo de 5 anos no cadastro', async () => {
    const accounts = await getRepository().listAccounts(CLIENT);
    const software = accounts.find((a) => a.code === '1.2.4.01')!;
    const item = car(software.id, { id: 'fa2', description: 'Software ERP', accountCode: '1.2.4.01', accountName: 'Softwares', invoiceValue: 15000, annualRate: 10, acquisitionDate: '2025-04-01', inUseDate: '2025-04-01' });
    await expect(saveFixedAsset(CLIENT, item, await loadFixedAssetContext(CLIENT), 'MICROENTIDADE')).rejects.toThrow(/no máximo 5 anos/);
    // Pequena empresa usa a vida útil estimada: grava.
    await saveFixedAsset(CLIENT, item, await loadFixedAssetContext(CLIENT), 'PEQUENA_EMPRESA');
    // Bem já gravado fora da regra continua editável sem mexer na taxa.
    await saveFixedAsset(CLIENT, { ...item, description: 'Software ERP (licença)' }, await loadFixedAssetContext(CLIENT), 'MICROENTIDADE');
    expect((await getRepository().getFixedAssets(CLIENT))?.assets.find((a) => a.id === 'fa2')?.description).toBe('Software ERP (licença)');
  });
});
