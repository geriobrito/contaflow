import type { AuditEntry, ClientCompany } from '@/types/firestore';
import type { DataRepository, LocalClientRestorePayload } from '@/lib/data/repository';
import { getRepository } from '@/lib/services/data-service';
import { journalAudit, newAuditId, type Actor } from '@/lib/audit';
import type { NormalizedClientBackup, RestoreMode } from './parse';
import { remapBackupForNewClient, type RemappedBackup } from './remap';

/** Gravação da restauração: fiel no modo local ou como nova empresa pelo repositório. */

export interface RestoreOptions {
  /**
   * `'local-exact'` mantém IDs originais e histórico completo (apenas modo local).
   * `'new-company'` importa como nova empresa com remapeamento completo de IDs (Firestore e local).
   */
  mode: RestoreMode;
  targetName?: string;
  actor: Actor;
  repo?: DataRepository;
  onProgress?: (stage: string) => void;
}

export interface RestoreResult {
  client: ClientCompany;
  mode: RestoreMode;
  warnings: string[];
}

export class ClientRestoreError extends Error {
  readonly partialClientId?: string;
  readonly stage: string;

  constructor(message: string, stage: string, partialClientId?: string) {
    super(message);
    this.name = 'ClientRestoreError';
    this.stage = stage;
    this.partialClientId = partialClientId;
  }
}


function buildRestoreAudit(clientId: string, sourceClient: ClientCompany, actor: Actor, at: string, note: string): AuditEntry {
  return {
    id: newAuditId(),
    clientId,
    action: 'CLIENT_RESTORE',
    actorUid: actor.uid,
    ...(actor.email ? { actorEmail: actor.email } : {}),
    at,
    note: `${note} (origem: ${sourceClient.name}${sourceClient.cnpj ? ` · ${sourceClient.cnpj}` : ''})`,
  };
}

/**
 * Executa a restauração em 6 etapas pelos métodos comuns do repositório (Client SDK / Firestore):
 * 1) Empresa + plano de contas + regras + bancos;
 * 2) Lotes + transações como PENDING;
 * 3) Lançamentos avulsos do Diário (ainda com todos os meses abertos) + saldos de abertura;
 * 4) Conciliações/classificações (`commitChanges`), cadastros auxiliares, notas fiscais (com vínculos), checklists, notas e links encerrados;
 * 5) Fechamentos de competência em ordem cronológica + encerramentos anuais (`closeYear`);
 * 6) Registro único `CLIENT_RESTORE` na trilha de auditoria.
 */
export async function restoreNewCompanyViaRepository(
  backup: NormalizedClientBackup,
  remapped: RemappedBackup,
  repo: DataRepository,
  actor: Actor,
  onProgress?: (stage: string) => void
): Promise<RestoreResult> {
  const now = new Date().toISOString();
  const clientId = remapped.client.id;
  const warnings = [...remapped.warnings];
  let createdClient = false;

  const runStage = async (stage: string, fn: () => Promise<void>) => {
    onProgress?.(stage);
    try {
      await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro inesperado durante a restauração.';
      throw new ClientRestoreError(msg, stage, createdClient ? clientId : undefined);
    }
  };

  // Etapa 1: empresa + estrutura base
  await runStage('Criando empresa, plano de contas e regras...', async () => {
    await repo.saveClient(remapped.client);
    createdClient = true;
    if (remapped.accountsToCreate.length > 0) {
      await repo.insertAccounts(remapped.accountsToCreate);
    }
    for (const rule of remapped.rulesToCreate) {
      await repo.saveRule(rule);
    }
    for (const bank of remapped.bankAccounts) {
      await repo.saveBankAccount(bank);
    }
  });

  // Etapa 2: extratos e lançamentos bancários (sempre PENDING na criação para passar nas regras)
  await runStage('Importando lotes e lançamentos bancários...', async () => {
    for (const batch of remapped.importBatches) {
      await repo.saveImportBatch(batch);
    }
    if (remapped.pendingTransactions.length > 0) {
      await repo.insertTransactions(remapped.pendingTransactions);
    }
  });

  // Etapa 3: lançamentos manuais regulares + saldos de abertura (ainda sem meses fechados)
  await runStage('Restaurando Diário e saldos de abertura...', async () => {
    for (const draft of remapped.regularJournalDrafts) {
      await repo.createJournalEntry(draft, journalAudit('JOURNAL_CREATE', actor, clientId, now, draft));
    }
    if (remapped.openingBalances) {
      await repo.saveOpeningBalances(remapped.openingBalances, {
        id: newAuditId(),
        clientId,
        action: 'OPENING_SAVE',
        actorUid: actor.uid,
        ...(actor.email ? { actorEmail: actor.email } : {}),
        at: now,
        note: 'Saldos de abertura restaurados a partir de backup',
      });
    }
  });

  // Etapa 4: conciliações, cadastros auxiliares, notas fiscais, checklists, notas e pendências
  await runStage('Aplicando conciliações, cadastros auxiliares e notas...', async () => {
    if (remapped.transactionPatches.length > 0) {
      await repo.commitChanges({ patches: remapped.transactionPatches, audits: [] });
    }
    const regAudit = (action: AuditEntry['action']): AuditEntry => ({
      id: newAuditId(),
      clientId,
      action,
      actorUid: actor.uid,
      ...(actor.email ? { actorEmail: actor.email } : {}),
      at: now,
      note: 'Cadastro restaurado a partir de backup',
    });
    if (remapped.fixedAssets) await repo.saveFixedAssets(remapped.fixedAssets, regAudit('ASSET_SAVE'));
    if (remapped.prepaidExpenses) await repo.savePrepaidExpenses(remapped.prepaidExpenses, regAudit('PREPAID_SAVE'));
    if (remapped.financingContracts) await repo.saveFinancingContracts(remapped.financingContracts, regAudit('FINANCING_SAVE'));
    if (remapped.investments) await repo.saveInvestments(remapped.investments, regAudit('INVESTMENT_SAVE'));
    if (remapped.stockControl) await repo.saveStockControl(remapped.stockControl, regAudit('STOCK_SAVE'));
    if (remapped.payrollRegister) await repo.savePayrollRegister(remapped.payrollRegister, regAudit('PAYROLL_SAVE'));

    if (remapped.invoices.length > 0) {
      await repo.saveInvoices(remapped.invoices);
      for (const inv of remapped.invoices) {
        for (const link of inv.links ?? []) {
          await repo.linkInvoice(inv.id, link);
        }
      }
    }
    for (const checklist of remapped.closingChecklists) {
      await repo.saveClosingChecklist(checklist);
    }
    for (const notes of remapped.explanatoryNotes) {
      await repo.saveExplanatoryNotes(notes);
    }
    if (remapped.feeRegister) await repo.saveFeeRegister(remapped.feeRegister);
    if (remapped.obligationChecks) await repo.saveObligationChecks(remapped.obligationChecks);
    for (const req of remapped.clientRequests) {
      // As regras do Firestore exigem criar com `status: 'OPEN'` e então encerrar.
      await repo.saveClientRequest({ ...req, status: 'OPEN' });
      await repo.closeClientRequest(req.id);
    }
  });

  // Etapa 5: fechamentos de período e encerramentos anuais
  await runStage('Reaplicando competências fechadas e encerramentos...', async () => {
    for (const lock of remapped.periodLocks) {
      await repo.closePeriod(
        { ...lock, lockedByUid: actor.uid, lockedAt: now },
        {
          id: `${lock.id}_close_${lock.auditKey ?? now}`,
          clientId,
          action: 'PERIOD_CLOSE',
          actorUid: actor.uid,
          ...(actor.email ? { actorEmail: actor.email } : {}),
          at: now,
          month: lock.month,
          note: 'Competência fechada na restauração do backup',
        }
      );
    }
    for (const group of remapped.closingYearGroups) {
      const closeAuditId = `${clientId}_${group.year}_close_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      await repo.closeYear(group.drafts, {
        id: closeAuditId,
        clientId,
        action: 'YEAR_CLOSE',
        actorUid: actor.uid,
        ...(actor.email ? { actorEmail: actor.email } : {}),
        at: now,
        month: `${group.year}-12`,
        note: `Encerramento de ${group.year} restaurado a partir de backup`,
      });
    }
  });

  // Etapa 6: registro final de auditoria
  await runStage('Registrando trilha da restauração...', async () => {
    const truncatedInfo = backup.auditTruncated
      ? ' Trilha histórica do backup estava truncada no teto de 20.000 eventos.'
      : '';
    const audit = buildRestoreAudit(
      clientId,
      backup.client,
      actor,
      now,
      `Restaurado como nova empresa (${remapped.finalTransactions.length} bancários, ${remapped.fullJournalEntries.length} no Diário). Histórico antigo permanece no JSON.${truncatedInfo}`
    );
    await repo.commitChanges({ patches: [], audits: [audit] });
  });

  if (backup.audit.length > 0) {
    warnings.push('O histórico antigo da trilha de auditoria permanece arquivado apenas no arquivo JSON (regra de imutabilidade na nuvem).');
  }

  return { client: remapped.client, mode: 'new-company', warnings };
}

/**
 * Restaura um backup de empresa do ContaFlow.
 * - No modo local (`local-exact` ou `new-company`), grava fielmente todos os documentos e a auditoria histórica.
 * - No Firestore (`new-company`), importa em 6 etapas como uma nova empresa com remapeamento seguro de IDs.
 */
export async function restoreClientBackup(backup: NormalizedClientBackup, options: RestoreOptions): Promise<RestoreResult> {
  const repo = options.repo ?? getRepository();
  const now = new Date().toISOString();

  if (options.mode === 'local-exact') {
    if (repo.mode !== 'local' || !repo.restoreLocalClientData) {
      throw new ClientRestoreError('A restauração mantendo o ID original só está disponível no modo local.', 'validacao');
    }
    options.onProgress?.('Restaurando empresa com IDs originais no modo local...');
    const { deletingAt: _del, ...clientRest } = backup.client;
    void _del;
    const restoredClient: ClientCompany = {
      ...clientRest,
      name: options.targetName?.trim() || backup.client.name,
      updatedAt: now,
    };
    const restoreAudit = buildRestoreAudit(
      restoredClient.id,
      backup.client,
      options.actor,
      now,
      'Empresa restaurada fielmente no modo local'
    );
    const payload: LocalClientRestorePayload = {
      client: restoredClient,
      accounts: backup.accounts,
      rules: backup.rules,
      bankAccounts: backup.bankAccounts,
      openingBalances: backup.openingBalances,
      importBatches: backup.importBatches,
      transactions: backup.transactions,
      journalEntries: backup.journalEntries,
      journalCounter: backup.journalCounter,
      periodLocks: backup.periodLocks,
      lockState: backup.lockState,
      clientRequests: backup.clientRequests,
      invoices: backup.invoices,
      fixedAssets: backup.fixedAssets,
      prepaidExpenses: backup.prepaidExpenses,
      financingContracts: backup.financingContracts,
      investments: backup.investments,
      stockControl: backup.stockControl,
      payrollRegister: backup.payrollRegister,
      closingChecklists: backup.closingChecklists,
      explanatoryNotes: backup.explanatoryNotes,
      ...(backup.feeRegister !== undefined ? { feeRegister: backup.feeRegister } : {}),
      ...(backup.obligationChecks !== undefined ? { obligationChecks: backup.obligationChecks } : {}),
      audit: backup.audit,
      restoreAudit,
    };
    await repo.restoreLocalClientData(payload);
    return {
      client: restoredClient,
      mode: 'local-exact',
      warnings: backup.auditTruncated ? ['O arquivo de backup indicou trilha de auditoria truncada (teto de 20.000 registros).'] : [],
    };
  }

  options.onProgress?.('Lendo plano de contas e regras existentes...');
  const [existingGlobalAccounts, existingGlobalRules] = await Promise.all([
    repo.listAccounts('global'),
    repo.listRules('global'),
  ]);
  const remapped = remapBackupForNewClient(backup, {
    targetName: options.targetName,
    existingGlobalAccounts,
    existingGlobalRules,
    actorUid: options.actor.uid,
    now,
  });

  if (repo.mode === 'local' && repo.restoreLocalClientData) {
    options.onProgress?.('Gravando nova empresa no armazenamento local...');
    const restoreAudit = buildRestoreAudit(
      remapped.client.id,
      backup.client,
      options.actor,
      now,
      'Empresa restaurada como cópia no modo local'
    );
    await repo.restoreLocalClientData({
      client: remapped.client,
      accounts: remapped.accountsToCreate,
      rules: remapped.rulesToCreate,
      bankAccounts: remapped.bankAccounts,
      openingBalances: remapped.openingBalances,
      importBatches: remapped.importBatches,
      transactions: remapped.finalTransactions,
      journalEntries: remapped.fullJournalEntries,
      journalCounter: remapped.journalCounter,
      periodLocks: remapped.periodLocks,
      lockState: remapped.lockState,
      clientRequests: remapped.clientRequests,
      invoices: remapped.invoices,
      fixedAssets: remapped.fixedAssets,
      prepaidExpenses: remapped.prepaidExpenses,
      financingContracts: remapped.financingContracts,
      investments: remapped.investments,
      stockControl: remapped.stockControl,
      payrollRegister: remapped.payrollRegister,
      closingChecklists: remapped.closingChecklists,
      explanatoryNotes: remapped.explanatoryNotes,
      feeRegister: remapped.feeRegister,
      obligationChecks: remapped.obligationChecks,
      audit: remapped.remappedAudit,
      restoreAudit,
    });
    return { client: remapped.client, mode: 'new-company', warnings: remapped.warnings };
  }

  return restoreNewCompanyViaRepository(backup, remapped, repo, options.actor, options.onProgress);
}
