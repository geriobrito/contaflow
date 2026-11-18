import { describe, expect, it } from 'vitest';
import type { BankTransaction, ClientCompany } from '@/types/firestore';
import { createLocalRepository, type KeyValueStore } from '@/lib/data/local-repository';
import { readZip } from '@/lib/archive/zip';
import { parseClientBackup } from '@/lib/export/restore/parse';
import { backupStatus, estimateBackupReads, planBackup, uniqueBackupFileName, type PortfolioManifest } from '@/lib/portfolio-backup';
import { buildPortfolioBackup, estimatePortfolioReads } from '@/lib/services/portfolio-backup-service';
import { buildPortfolioRow } from '@/lib/portfolio';

describe('situação do backup da empresa', () => {
  const today = '2026-11-17';
  it('nunca, antigo, mudou depois e em dia', () => {
    expect(backupStatus({}, { today })).toEqual({ state: 'never', days: null });
    expect(backupStatus({ lastBackupAt: '2026-10-18T10:00:00.000Z' }, { today })).toEqual({ state: 'stale', days: 30 });
    expect(backupStatus({ lastBackupAt: '2026-10-19T10:00:00.000Z' }, { today })).toEqual({ state: 'ok', days: 29 });
    // Prazo do escritório.
    expect(backupStatus({ lastBackupAt: '2026-11-10T10:00:00.000Z' }, { today, reminderDays: 7 }).state).toBe('stale');
    // Competência fechada depois do backup.
    expect(backupStatus({ lastBackupAt: '2026-11-10T10:00:00.000Z' }, { today, lastActivityAt: '2026-11-12T09:00:00.000Z' })).toEqual({ state: 'changed', days: 7 });
    expect(backupStatus({ lastBackupAt: '2026-11-10T10:00:00.000Z' }, { today, lastActivityAt: '2026-11-09T09:00:00.000Z' }).state).toBe('ok');
  });

  it('a última mudança vem do extrato, do fechamento ou do cadastro', () => {
    const row = buildPortfolioRow({
      client: { id: 'c', name: 'C', cnpj: '', regime: 'MEI', createdAt: '', updatedAt: '2026-01-01T00:00:00.000Z' },
      pending: 0,
      auto: 0,
      oldestPending: null,
      oldestAuto: null,
      locks: [{ id: 'c_2026-09', clientId: 'c', month: '2026-09', lockedAt: '2026-10-05T12:00:00.000Z', lockedByUid: 'u' }],
      batches: [
        { id: 'b1', clientId: 'c', fileName: 'a.ofx', fileSize: 1, totalTransactions: 1, importedCount: 1, duplicateCount: 0, autoClassifiedCount: 0, totalDebit: 0, totalCredit: 0, importedAt: '2026-11-02T08:00:00.000Z' },
        { id: 'b2', clientId: 'c', fileName: 'b.ofx', fileSize: 1, totalTransactions: 1, importedCount: 1, duplicateCount: 0, autoClassifiedCount: 0, totalDebit: 0, totalCredit: 0, importedAt: '2026-11-15T08:00:00.000Z', status: 'FAILED' },
      ],
      banks: [],
      openQueries: [],
      requests: [],
      today: '2026-11-17',
      nowMs: Date.parse('2026-11-17T12:00:00Z'),
    } as Parameters<typeof buildPortfolioRow>[0]);
    // A importação que falhou não conta.
    expect(row.lastActivityAt).toBe('2026-11-02T08:00:00.000Z');
  });
});

describe('cota de leituras', () => {
  it('estimativa e divisão pelo que resta do dia', () => {
    expect(estimateBackupReads(1000)).toBe(2400);
    const items = [
      { clientId: 'a', reads: 10_000 },
      { clientId: 'b', reads: 30_000 },
      { clientId: 'c', reads: 5_000 },
    ];
    expect(planBackup(items, 20_000)).toEqual({ now: ['a', 'c'], later: ['b'], reads: 15_000 });
    expect(planBackup(items, null)).toEqual({ now: ['a', 'b', 'c'], later: [], reads: 45_000 });
    expect(planBackup(items, 1000).now).toEqual([]);
  });

  it('nomes repetidos ganham número', () => {
    const taken = new Set<string>();
    const c = { name: 'Padaria', tradeName: 'Aurora' };
    expect(uniqueBackupFileName(c, '2026-11-17T00:00:00Z', taken)).toBe('Backup_Aurora_2026-11-17.json');
    expect(uniqueBackupFileName(c, '2026-11-17T00:00:00Z', taken)).toBe('Backup_Aurora_2026-11-17_2.json');
  });
});

function memoryStore(): KeyValueStore {
  const dump = new Map<string, string>();
  return { getItem: (k) => dump.get(k) ?? null, setItem: (k, v) => void dump.set(k, v) };
}
const client = (id: string, name: string): ClientCompany => ({ id, name, cnpj: '', regime: 'MEI', createdAt: '', updatedAt: '' });
const tx = (clientId: string, id: string): BankTransaction => ({ id: `${clientId}_${id}`, clientId, fitid: id, date: '2025-03-10', amount: -10, type: 'DEBIT', memo: id, status: 'PENDING', createdAt: '' });

describe('backup da carteira', () => {
  it('um JSON restaurável por empresa e o manifesto; a falha de uma não para as outras', async () => {
    const repo = createLocalRepository(memoryStore());
    const alpha = client('c1', 'Alpha');
    const beta = client('c2', 'Beta');
    await repo.saveClient(alpha);
    await repo.saveClient(beta);
    await repo.insertTransactions([tx('c1', 't1'), tx('c1', 't2'), tx('c2', 't3')]);
    // Uma empresa que o repositório não consegue ler.
    const broken = { ...repo, listTransactions: async (id: string) => (id === 'cX' ? Promise.reject(new Error('sem acesso')) : repo.listTransactions(id)) };
    const progress: number[] = [];

    const result = await buildPortfolioBackup([alpha, client('cX', 'Quebrada'), beta], {
      repo: broken as typeof repo,
      exportedAt: '2026-11-17T12:00:00.000Z',
      onProgress: (done) => progress.push(done),
    });
    expect(result.fileName).toBe('Backup_Carteira_2026-11-17.zip');
    expect(result.done).toEqual(['c1', 'c2']);
    expect(progress).toEqual([0, 1, 2, 3]);

    const files = await readZip(await result.blob.arrayBuffer());
    expect(files.map((f) => f.name)).toEqual(['manifesto.json', 'Backup_Alpha_2026-11-17.json', 'Backup_Beta_2026-11-17.json']);
    const manifest = JSON.parse(new TextDecoder().decode(files[0].data)) as PortfolioManifest;
    expect(manifest.files.map((f) => [f.clientId, f.transactions])).toEqual([
      ['c1', 2],
      ['c2', 1],
    ]);
    expect(manifest.failed).toEqual([{ clientId: 'cX', name: 'Quebrada', reason: 'sem acesso' }]);
    // O JSON de cada empresa é o mesmo do backup avulso: a restauração o lê.
    const restored = parseClientBackup(new TextDecoder().decode(files[1].data));
    expect(restored.client.id).toBe('c1');
    expect(restored.transactions).toHaveLength(2);
  });

  it('estimativa por empresa pela contagem de lançamentos', async () => {
    const repo = createLocalRepository(memoryStore());
    await repo.saveClient(client('c1', 'Alpha'));
    await repo.insertTransactions([tx('c1', 't1'), tx('c1', 't2')]);
    expect(await estimatePortfolioReads([client('c1', 'Alpha')], repo)).toEqual(new Map([['c1', estimateBackupReads(2)]]));
  });
});
