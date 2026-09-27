'use client';

import React, { useState, useEffect } from 'react';
import { useClient } from '@/contexts/ClientContext';
import { ClassificationRule, ChartAccount } from '@/types/firestore';
import { getRules, saveRule, getAccounts } from '@/lib/services/data-service';
import { BrainCircuit, Plus, Search, Trash2, Sparkles, Check, X } from 'lucide-react';

export default function RegrasPage() {
  const [rules, setRules] = useState<ClassificationRule[]>([]);
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const { currentClient } = useClient();
  const clientId = currentClient?.id;
  const [searchTerm, setSearchTerm] = useState('');

  // Modal nova regra
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newPattern, setNewPattern] = useState('');
  const [newAccountId, setNewAccountId] = useState('');
  const [newMatchType, setNewMatchType] = useState<'CONTAINS' | 'STARTS_WITH' | 'EXACT'>('CONTAINS');

  useEffect(() => {
    if (!clientId) return;
    Promise.all([getRules(clientId), getAccounts(clientId)]).then(([loadedRules, loadedAccounts]) => {
      setRules(loadedRules);
      setAccounts(loadedAccounts);
    });
  }, [clientId]);

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    const acc = accounts.find((a) => a.id === newAccountId);
    if (!newPattern || !acc) return;

    const rule: ClassificationRule = {
      id: `rule-${Date.now()}`,
      clientId: currentClient?.id || 'global',
      pattern: newPattern.toUpperCase().trim(),
      matchType: newMatchType,
      accountId: acc.id,
      accountCode: acc.code,
      accountName: acc.name,
      confidence: 95,
      usageCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await saveRule(rule);
    const refreshed = await getRules(currentClient?.id);
    setRules(refreshed);

    setIsModalOpen(false);
    setNewPattern('');
    setNewAccountId('');
  };

  const filteredRules = rules.filter((r) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      r.pattern.toLowerCase().includes(term) ||
      (r.accountName?.toLowerCase().includes(term) ?? false) ||
      (r.accountCode?.includes(term) ?? false)
    );
  });

  return (
    <div className="flex flex-col">

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-purple-50 dark:bg-purple-950/50 text-purple-600 dark:text-purple-400 flex items-center justify-center shadow-sm">
              <BrainCircuit className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">
                Motor de Aprendizado Contínuo
              </h1>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Padrões inteligentes reconhecidos automaticamente para auto-classificar lançamentos de extrato
              </p>
            </div>
          </div>

          <button
            onClick={() => setIsModalOpen(true)}
            className="ios-button inline-flex items-center gap-1.5 px-4 py-2 rounded-2xl text-xs font-medium bg-purple-600 hover:bg-purple-700 text-white shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Adicionar Padrão Manual</span>
          </button>
        </div>

        {/* Search Bar */}
        <div className="relative max-w-md">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Filtrar por termo do MEMO, conta ou código..."
            className="w-full pl-9 pr-4 py-2 text-xs rounded-2xl border border-black/[0.08] dark:border-white/[0.08] bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-purple-500/20 shadow-sm"
          />
        </div>

        {/* Rules Table */}
        <div className="ios-card rounded-3xl overflow-hidden border border-black/[0.06] dark:border-white/[0.08] shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-black/[0.06] dark:border-white/[0.08] bg-zinc-50/70 dark:bg-zinc-800/40 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                  <th className="py-3 px-4">Padrão Reconhecido (Termo)</th>
                  <th className="py-3 px-4">Tipo de Correspondência</th>
                  <th className="py-3 px-4">Conta Contábil de Destino</th>
                  <th className="py-3 px-4 text-center">Assertividade</th>
                  <th className="py-3 px-4 text-center">Vezes Aplicado</th>
                  <th className="py-3 px-4">Escopo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.04] text-xs">
                {filteredRules.map((rule) => (
                  <tr
                    key={rule.id}
                    className="hover:bg-black/[0.015] dark:hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="py-3.5 px-4">
                      <span className="font-mono font-semibold px-2 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white border border-zinc-200 dark:border-zinc-700">
                        {rule.pattern}
                      </span>
                    </td>

                    <td className="py-3.5 px-4 text-zinc-600 dark:text-zinc-400">
                      {rule.matchType === 'CONTAINS' && 'Contém no texto'}
                      {rule.matchType === 'STARTS_WITH' && 'Inicia com'}
                      {rule.matchType === 'EXACT' && 'Exatamente igual'}
                      {rule.matchType === 'REGEX' && 'Expressão Regular'}
                    </td>

                    <td className="py-3.5 px-4">
                      <div className="font-medium text-zinc-900 dark:text-zinc-100">
                        <span className="font-semibold text-blue-600 dark:text-blue-400">
                          {rule.accountCode}
                        </span>{' '}
                        - {rule.accountName}
                      </div>
                    </td>

                    <td className="py-3.5 px-4 text-center">
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200">
                        <Sparkles className="w-2.5 h-2.5" />
                        {rule.confidence}%
                      </span>
                    </td>

                    <td className="py-3.5 px-4 text-center font-semibold text-zinc-700 dark:text-zinc-300">
                      {rule.usageCount}
                    </td>

                    <td className="py-3.5 px-4 text-[11px] text-zinc-400">
                      {rule.clientId === 'global' ? 'Padrão Global' : 'Empresa Atual'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* Modal Nova Regra */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl ios-card p-6 shadow-2xl bg-white dark:bg-zinc-900 border border-black/[0.08] dark:border-white/[0.1]">
            <div className="flex items-center justify-between pb-3 border-b border-black/[0.06] dark:border-white/[0.08]">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">
                Nova Regra de Auto-Classificação
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="w-7 h-7 rounded-full flex items-center justify-center text-zinc-400 hover:text-zinc-600 hover:bg-black/[0.04]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateRule} className="mt-4 space-y-3.5 text-xs">
              <div>
                <label className="font-semibold text-zinc-700 dark:text-zinc-300 block mb-1">
                  Padrão do MEMO (em caixa alta)
                </label>
                <input
                  type="text"
                  required
                  value={newPattern}
                  onChange={(e) => setNewPattern(e.target.value.toUpperCase())}
                  placeholder="Ex: POSTO IPIRANGA, IFOOD, NETFLIX"
                  className="w-full font-mono uppercase px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white focus:ring-2 focus:ring-purple-500/20"
                />
              </div>

              <div>
                <label className="font-semibold text-zinc-700 dark:text-zinc-300 block mb-1">
                  Tipo de Comparação
                </label>
                <select
                  value={newMatchType}
                  onChange={(e) => setNewMatchType(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white"
                >
                  <option value="CONTAINS">Contém o texto (Recomendado)</option>
                  <option value="STARTS_WITH">Inicia com o texto</option>
                  <option value="EXACT">Exatamente igual</option>
                </select>
              </div>

              <div>
                <label className="font-semibold text-zinc-700 dark:text-zinc-300 block mb-1">
                  Conta Contábil de Destino
                </label>
                <select
                  required
                  value={newAccountId}
                  onChange={(e) => setNewAccountId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white"
                >
                  <option value="">Selecione a conta analítica...</option>
                  {accounts
                    .filter((a) => a.nature === 'ANALYTIC')
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} - {a.name} ({a.type})
                      </option>
                    ))}
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="ios-button px-4 py-2 rounded-xl text-zinc-600 dark:text-zinc-400"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="ios-button px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-medium shadow-sm flex items-center gap-1.5"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Salvar Regra</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
