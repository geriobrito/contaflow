import { describe, expect, it } from 'vitest';
import type { BankTransaction, ClientCompany } from '@/types/firestore';
import { createLocalRepository, type KeyValueStore } from '@/lib/data/local-repository';
import { journalAudit } from '@/lib/audit';
import { backupFileName, buildClientBackup } from '@/lib/export/client-backup';

function memoryStore(): KeyValueStore {
  const dump = new Map<string, string>();
  return { getItem: (k) => dump.get(k) ?? null, setItem: (k, v) => void dump.set(k, v) };
}

const client = (id: string, name: string): ClientCompany => ({ id, name, cnpj: '', regime: 'MEI', createdAt: '', updatedAt: '' });
const tx = (clientId: string, id: string): BankTransaction => ({
  id: `${clientId}_${id}`,
  clientId,
  fitid: id,
  date: '2025-03-10',
  amount: -10,
  type: 'DEBIT',
  memo: id,
  status: 'PENDING',
  createdAt: '',
});

describe('backup da empresa em JSON', () => {
  it('reúne tudo o que a exclusão apagaria, mais a auditoria, só da empresa pedida', async () => {
    const repo = createLocalRepository(memoryStore());
    const alpha = client('c1', 'Alpha');
    await repo.saveClient(alpha);
    await repo.saveClient(client('c2', 'Beta'));
    await repo.insertAccounts([
      { id: 'a1', clientId: 'c1', code: '1', name: 'Caixa', type: 'ASSET', nature: 'ANALYTIC', level: 1, createdAt: '', updatedAt: '' },
      { id: 'g1', clientId: 'global', code: '9', name: 'Global', type: 'EXPENSE', nature: 'ANALYTIC', level: 1, createdAt: '', updatedAt: '' },
      { id: 'a2', clientId: 'c2', code: '1', name: 'Caixa', type: 'ASSET', nature: 'ANALYTIC', level: 1, createdAt: '', updatedAt: '' },
    ]);
    await repo.saveRule({ id: 'r1', clientId: 'c1', pattern: 'uber', accountId: 'a1', createdAt: '', updatedAt: '' });
    await repo.saveBankAccount({ id: 'c1_k1', clientId: 'c1', accountKey: 'k1', nickname: 'Itaú', createdAt: '', updatedAt: '' });
    await repo.insertTransactions([tx('c1', 't1'), tx('c1', 't2'), tx('c2', 't3')]);
    await repo.saveOpeningBalances(
      { id: 'c1', clientId: 'c1', date: '2024-12-31', entries: [{ accountId: 'a1', amount: 100 }], updatedAt: '' },
      { id: 'au1', clientId: 'c1', action: 'OPENING_SAVE', actorUid: 'u', at: 'T1' }
    );
    await repo.closePeriod(
      { id: 'c1_2025-01', clientId: 'c1', month: '2025-01', lockedAt: 'T', lockedByUid: 'u' },
      { id: '', clientId: 'c1', action: 'PERIOD_CLOSE', actorUid: 'u', at: 'T2', month: '2025-01' }
    );
    const jDraft = {
      id: 'j1',
      clientId: 'c1',
      date: '2025-03-31',
      memo: 'Provisão',
      category: 'PROVISION' as const,
      lines: [
        { id: 'd', accountId: 'a1', type: 'DEBIT' as const, amount: 50 },
        { id: 'c', accountId: 'g1', type: 'CREDIT' as const, amount: 50 },
      ],
      totalAmount: 50,
      createdAt: '',
      updatedAt: '',
      createdByUid: 'u',
    };
    await repo.createJournalEntry(jDraft, journalAudit('JOURNAL_CREATE', { uid: 'u' }, 'c1', 'T3', jDraft));
    await repo.saveClosingChecklist({
      id: 'c1_2025',
      clientId: 'c1',
      year: '2025',
      items: { cash: { done: true, at: 'T4', byUid: 'u' } },
      updatedAt: 'T4',
    });
    await repo.saveExplanatoryNotes({
      id: 'c1_2025',
      clientId: 'c1',
      year: '2025',
      notes: [{ id: 'context', title: 'Contexto', text: 'Texto', enabled: true }],
      updatedAt: 'T4',
    });

    const backup = await buildClientBackup(alpha, repo, '2026-10-13T12:00:00.000Z');
    expect(backup).toMatchObject({ format: 'contaflow-backup', version: 2, exportedAt: '2026-10-13T12:00:00.000Z', client: alpha, auditTruncated: false });
    expect(backup.accounts.map((a) => a.id).sort()).toEqual(['a1', 'g1']);
    expect(backup.rules.map((r) => r.id)).toEqual(['r1']);
    expect(backup.bankAccounts.map((b) => b.accountKey)).toEqual(['k1']);
    expect(backup.transactions.map((t) => t.fitid).sort()).toEqual(['t1', 't2']);
    expect(backup.openingBalances?.entries).toEqual([{ accountId: 'a1', amount: 100 }]);
    expect(backup.periodLocks.map((l) => l.month)).toEqual(['2025-01']);
    expect(backup.lockState).toMatchObject({ clientId: 'c1', count: 1, seq: 1 });
    expect(backup.journalEntries.map((j) => j.entryNumber)).toEqual([1]);
    expect(backup.journalCounter).toMatchObject({ clientId: 'c1', last: 1 });
    expect(backup.closingChecklists?.map((c) => c.year)).toEqual(['2025']);
    expect(backup.explanatoryNotes?.map((n) => n.year)).toEqual(['2025']);
    expect(backup.audit.map((a) => a.action).sort()).toEqual(['JOURNAL_CREATE', 'OPENING_SAVE', 'PERIOD_CLOSE']);
    // O arquivo é JSON puro: volta idêntico depois de gravado e lido.
    expect(JSON.parse(JSON.stringify(backup))).toEqual(backup);
  });

  it('nome do arquivo sem acentos nem caracteres inválidos', () => {
    expect(backupFileName({ name: 'Alpha Ltda', tradeName: 'Padaria São João & Cia.' }, '2026-10-13T12:00:00.000Z')).toBe('Backup_Padaria_Sao_Joao_Cia_2026-10-13.json');
    expect(backupFileName({ name: '···' }, '2026-10-13T12:00:00.000Z')).toBe('Backup_Cliente_2026-10-13.json');
  });
});
