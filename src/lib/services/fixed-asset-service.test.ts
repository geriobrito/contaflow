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
    // Plano antigo, sem a conta de custo nova (3.2.1.04): a rotina a cria quando precisa.
    await repo.insertAccounts(buildITG1000Chart(CLIENT).filter((a) => a.code !== '3.2.1.04'));
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

  it('baixa grava o lançamento junto e desfaz junto', async () => {
    const ctx = await loadFixedAssetContext(CLIENT);
    const asset = ctx.register!.assets[0];
    await postMonthDepreciation(CLIENT, '2025-04', 'u1');
    const entry = await disposeFixedAsset(CLIENT, asset, { date: '2025-04-30', reason: 'SALE' }, ctx, 'u1');
    expect(entry?.fixedAssetId).toBe('fa1');
    expect(entry?.lines.map((l) => [l.accountCode, l.type, l.amount])).toEqual([
      ['1.2.3.07', 'DEBIT', 2409.34],
      ['3.3.9.04', 'DEBIT', 69870.66],
      ['1.2.3.04', 'CREDIT', 72280],
    ]);
    const after = await loadFixedAssetContext(CLIENT);
    expect(after.register!.assets[0].disposal?.journalEntryId).toBe(entry!.id);
    // Depois da baixa não há cota em maio.
    expect((await loadMonthDepreciation(CLIENT, '2025-05'))?.status.kind).toBe('NONE');

    await undoFixedAssetDisposal(CLIENT, after.register!.assets[0], after);
    expect((await getRepository().getFixedAssets(CLIENT))?.assets[0].disposal).toBeUndefined();
    expect((await getRepository().listJournalEntries(CLIENT)).some((e) => e.fixedAssetId)).toBe(false);
  });
});
