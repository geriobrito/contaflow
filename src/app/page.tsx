'use client';

import React, { useState, useEffect } from 'react';
import { Navbar } from '@/components/layout/Navbar';
import { OFXDropzone } from '@/components/conciliacao/OFXDropzone';
import { TransactionTable } from '@/components/conciliacao/TransactionTable';
import { ClassifyModal } from '@/components/conciliacao/ClassifyModal';
import {
  ClientCompany,
  ChartAccount,
  BankTransaction,
  ClassificationRule,
  ImportBatch,
} from '@/types/firestore';
import { OFXParseResult } from '@/lib/ofx/types';
import {
  getClients,
  getAccounts,
  getRules,
  getTransactions,
  saveTransactionsBatch,
  updateTransactionClassification,
  saveRule,
} from '@/lib/services/data-service';
import {
  matchTransactionWithRules,
  buildLearnedRule,
  normalizeText,
} from '@/lib/rules/engine';
import {
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownLeft,
  Building,
  RotateCcw,
} from 'lucide-react';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';

export default function ConciliacaoPage() {
  const [clients, setClients] = useState<ClientCompany[]>([]);
  const [currentClient, setCurrentClient] = useState<ClientCompany | null>(null);
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [rules, setRules] = useState<ClassificationRule[]>([]);
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Modal de classificação
  const [selectedTxForClassify, setSelectedTxForClassify] = useState<BankTransaction | null>(null);
  const [isClassifyModalOpen, setIsClassifyModalOpen] = useState(false);

  // Notificação de importação recente
  const [lastImportStats, setLastImportStats] = useState<{
    added: number;
    duplicates: number;
    autoClassified: number;
    bankName?: string;
  } | null>(null);

  // Carregar dados iniciais
  useEffect(() => {
    async function loadData() {
      setIsLoading(true);
      try {
        const loadedClients = await getClients();
        setClients(loadedClients);
        const activeClient = loadedClients[0] || null;
        setCurrentClient(activeClient);

        const [loadedAccounts, loadedRules, loadedTxs] = await Promise.all([
          getAccounts(activeClient?.id),
          getRules(activeClient?.id),
          getTransactions(activeClient?.id),
        ]);

        setAccounts(loadedAccounts);
        setRules(loadedRules);
        setTransactions(loadedTxs);
      } catch (err) {
        console.error('Erro ao carregar dados:', err);
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, []);

  // Quando o cliente selecionado mudar
  const handleSelectClient = async (client: ClientCompany) => {
    setCurrentClient(client);
    const [clientAccounts, clientRules, clientTxs] = await Promise.all([
      getAccounts(client.id),
      getRules(client.id),
      getTransactions(client.id),
    ]);
    setAccounts(clientAccounts);
    setRules(clientRules);
    setTransactions(clientTxs);
    setLastImportStats(null);
  };

  // Processamento do arquivo OFX parseado
  const handleOFXParsed = async (result: OFXParseResult, fileName: string) => {
    if (!currentClient) return;

    const clientId = currentClient.id;
    const batchId = `batch_${Date.now()}`;
    const now = new Date().toISOString();

    let autoClassifiedCount = 0;
    let totalDebit = 0;
    let totalCredit = 0;

    // Converter as transações brutas do OFX em transações do sistema com auto-classificação inteligente
    const preparedTransactions: BankTransaction[] = result.transactions.map((raw) => {
      if (raw.amount < 0) totalDebit += Math.abs(raw.amount);
      else totalCredit += raw.amount;

      // Executa o motor de correspondência com aprendizado prévio
      const match = matchTransactionWithRules(raw.memo, rules, clientId);

      let status: BankTransaction['status'] = 'PENDING';
      let accountId: string | undefined;
      let accountCode: string | undefined;
      let accountName: string | undefined;
      let matchedRuleId: string | undefined;
      let confidence: number | undefined;

      if (match.matched && match.rule) {
        status = 'AUTO_CLASSIFIED';
        accountId = match.rule.accountId;
        accountCode = match.rule.accountCode;
        accountName = match.rule.accountName;
        matchedRuleId = match.rule.id;
        confidence = match.confidence;
        autoClassifiedCount++;
      }

      return {
        id: `${clientId}_${raw.fitid}`, // Garante unicidade por cliente e FITID
        fitid: raw.fitid,
        clientId,
        importBatchId: batchId,
        bankName: result.account.org || 'Banco',
        accountNumber: result.account.accountId,
        date: raw.date,
        amount: raw.amount,
        type: raw.type,
        memo: raw.memo,
        checkNum: raw.checkNum,
        status,
        accountId,
        accountCode,
        accountName,
        matchedRuleId,
        confidence,
        createdAt: now,
      };
    });

    const batchInfo: ImportBatch = {
      id: batchId,
      clientId,
      fileName,
      fileSize: 0,
      bankId: result.account.bankId,
      accountNumber: result.account.accountId,
      startDate: result.startDate,
      endDate: result.endDate,
      totalTransactions: preparedTransactions.length,
      importedCount: 0,
      duplicateCount: 0,
      autoClassifiedCount,
      totalDebit,
      totalCredit,
      importedAt: now,
    };

    // Salva no banco de dados com prevenção ativa contra duplicidades de FITID
    const { addedCount, duplicateCount } = await saveTransactionsBatch(
      clientId,
      preparedTransactions,
      batchInfo
    );

    // Atualiza estado local
    const refreshed = await getTransactions(clientId);
    setTransactions(refreshed);

    setLastImportStats({
      added: addedCount,
      duplicates: duplicateCount,
      autoClassified: autoClassifiedCount,
      bankName: result.account.org,
    });
  };

  // Abrir modal de classificação
  const handleOpenClassify = (t: BankTransaction) => {
    setSelectedTxForClassify(t);
    setIsClassifyModalOpen(true);
  };

  // Confirmação de classificação manual + APRENDIZADO CONTÍNUO
  const handleConfirmClassification = async (
    transactionId: string,
    account: ChartAccount,
    learnRule: boolean,
    pattern: string,
    applyToSimilar: boolean
  ) => {
    if (!currentClient) return;

    // 1. Atualizar a transação selecionada
    await updateTransactionClassification(
      transactionId,
      account.id,
      account.code,
      account.name,
      'RECONCILED'
    );

    // 2. Se o usuário ativou o aprendizado contínuo, grava/atualiza a regra no Firestore
    if (learnRule && pattern) {
      const cleanPattern = normalizeText(pattern);
      const existing = rules.find((r) => normalizeText(r.pattern) === cleanPattern);
      const newOrUpdatedRule = buildLearnedRule(pattern, account, currentClient.id, existing);
      await saveRule(newOrUpdatedRule);

      // Recarrega regras
      const updatedRules = await getRules(currentClient.id);
      setRules(updatedRules);

      // 3. Se selecionou para aplicar aos semelhantes pendentes no mesmo lote
      if (applyToSimilar) {
        const pendingSimilar = transactions.filter(
          (t) =>
            t.id !== transactionId &&
            t.status !== 'RECONCILED' &&
            normalizeText(t.memo).includes(cleanPattern)
        );

        for (const sim of pendingSimilar) {
          await updateTransactionClassification(
            sim.id,
            account.id,
            account.code,
            account.name,
            'AUTO_CLASSIFIED'
          );
        }
      }
    }

    // Recarregar lançamentos
    const refreshed = await getTransactions(currentClient.id);
    setTransactions(refreshed);
  };

  // Aprovação rápida de todas as transações auto-classificadas pelo robô
  const handleQuickApproveAuto = async () => {
    const autos = transactions.filter((t) => t.status === 'AUTO_CLASSIFIED');
    for (const item of autos) {
      if (item.accountId && item.accountCode && item.accountName) {
        await updateTransactionClassification(
          item.id,
          item.accountId,
          item.accountCode,
          item.accountName,
          'RECONCILED'
        );
      }
    }
    if (currentClient) {
      const refreshed = await getTransactions(currentClient.id);
      setTransactions(refreshed);
    }
  };

  // Métricas do extrato
  const totalDebits = transactions
    .filter((t) => t.amount < 0)
    .reduce((acc, t) => acc + Math.abs(t.amount), 0);
  const totalCredits = transactions
    .filter((t) => t.amount > 0)
    .reduce((acc, t) => acc + t.amount, 0);

  return (
    <div className="min-h-screen flex flex-col bg-[#fbfbfd] dark:bg-black">
      <Navbar
        currentClient={currentClient || undefined}
        clients={clients}
        onSelectClient={handleSelectClient}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Header & Company Title */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">
              Conciliação Bancária OFX
            </h1>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
              Importação inteligente de extratos com aprendizado contínuo para{' '}
              <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                {currentClient?.name}
              </span>
            </p>
          </div>

          {/* Quick Metrics Cards */}
          <div className="flex items-center gap-3">
            <div className="ios-card px-4 py-2.5 rounded-2xl border border-black/[0.06] dark:border-white/[0.08] flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 flex items-center justify-center">
                <ArrowUpRight className="w-4 h-4" />
              </div>
              <div>
                <p className="text-[10px] text-zinc-400 font-medium uppercase tracking-wider">
                  Total Entradas
                </p>
                <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  {formatCurrency(totalCredits)}
                </p>
              </div>
            </div>

            <div className="ios-card px-4 py-2.5 rounded-2xl border border-black/[0.06] dark:border-white/[0.08] flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 flex items-center justify-center">
                <ArrowDownLeft className="w-4 h-4" />
              </div>
              <div>
                <p className="text-[10px] text-zinc-400 font-medium uppercase tracking-wider">
                  Total Saídas
                </p>
                <p className="text-xs font-semibold text-rose-600 dark:text-rose-400">
                  {formatCurrency(totalDebits)}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Import Notification Banner */}
        {lastImportStats && (
          <div className="p-4 rounded-3xl ios-card border border-blue-200 dark:border-blue-900/60 bg-blue-50/70 dark:bg-blue-950/30 flex items-center justify-between animate-in fade-in duration-300">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-sm">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-xs font-semibold text-zinc-900 dark:text-white">
                  Extrato bancário processado com sucesso!
                </h4>
                <p className="text-[11px] text-zinc-600 dark:text-zinc-300">
                  <span className="font-semibold text-blue-700 dark:text-blue-300">
                    {lastImportStats.added}
                  </span>{' '}
                  novos lançamentos importados •{' '}
                  <span className="font-semibold text-purple-700 dark:text-purple-300">
                    {lastImportStats.autoClassified}
                  </span>{' '}
                  auto-classificados pelo robô
                  {lastImportStats.duplicates > 0 && (
                    <span className="text-amber-600 dark:text-amber-400 ml-1">
                      • {lastImportStats.duplicates} duplicidades ignoradas via FITID
                    </span>
                  )}
                </p>
              </div>
            </div>
            <button
              onClick={() => setLastImportStats(null)}
              className="text-xs font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400"
            >
              Fechar
            </button>
          </div>
        )}

        {/* Dropzone Section */}
        <OFXDropzone onParsed={handleOFXParsed} isLoading={isLoading} />

        {/* Transactions Table */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-white">
              Lançamentos do Extrato ({transactions.length})
            </h2>
            <div className="text-xs text-zinc-500">
              Regras ativas no robô:{' '}
              <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                {rules.length}
              </span>
            </div>
          </div>

          <TransactionTable
            transactions={transactions}
            accounts={accounts}
            onOpenClassify={handleOpenClassify}
            onQuickApproveAuto={handleQuickApproveAuto}
          />
        </div>
      </main>

      {/* Modal de Classificação & Aprendizado Contínuo */}
      <ClassifyModal
        isOpen={isClassifyModalOpen}
        transaction={selectedTxForClassify}
        accounts={accounts}
        onClose={() => setIsClassifyModalOpen(false)}
        onConfirm={handleConfirmClassification}
      />
    </div>
  );
}
