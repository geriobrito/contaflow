'use client';

import React, { useState, useEffect } from 'react';
import { Navbar } from '@/components/layout/Navbar';
import {
  ChartAccount,
  AccountType,
  AccountNature,
  DREGroup,
  ClientCompany,
} from '@/types/firestore';
import {
  getAccounts,
  saveAccount,
  deleteAccount,
  getClients,
} from '@/lib/services/data-service';
import {
  Layers,
  Plus,
  FolderTree,
  FileText,
  Search,
  Check,
  X,
  Trash2,
} from 'lucide-react';

export default function PlanoDeContasPage() {
  const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [clients, setClients] = useState<ClientCompany[]>([]);
  const [currentClient, setCurrentClient] = useState<ClientCompany | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<string>('ALL');

  // Modal de criação de conta
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<AccountType>('EXPENSE');
  const [newNature, setNewNature] = useState<AccountNature>('ANALYTIC');
  const [newDREGroup, setNewDREGroup] = useState<DREGroup | ''>('DESPESAS_ADMINISTRATIVAS');
  const [selectedParentId, setSelectedParentId] = useState('');

  useEffect(() => {
    async function load() {
      const loadedClients = await getClients();
      setClients(loadedClients);
      if (loadedClients.length > 0) setCurrentClient(loadedClients[0]);

      const loadedAccounts = await getAccounts(loadedClients[0]?.id);
      setAccounts(loadedAccounts);
    }
    load();
  }, []);

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCode || !newName) return;

    const newAcc: ChartAccount = {
      id: `acc-${Date.now()}`,
      clientId: currentClient?.id || 'global',
      code: newCode.trim(),
      name: newName.trim(),
      type: newType,
      nature: newNature,
      parentId: selectedParentId || undefined,
      level: newCode.split('.').length,
      dreGroup: newDREGroup ? (newDREGroup as DREGroup) : undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await saveAccount(newAcc);
    const refreshed = await getAccounts(currentClient?.id);
    setAccounts(refreshed);

    setIsModalOpen(false);
    setNewCode('');
    setNewName('');
  };

  const handleDelete = async (id: string) => {
    if (confirm('Tem certeza de que deseja excluir esta conta contábil?')) {
      await deleteAccount(id);
      const refreshed = await getAccounts(currentClient?.id);
      setAccounts(refreshed);
    }
  };

  const filteredAccounts = accounts.filter((acc) => {
    if (selectedTypeFilter !== 'ALL' && acc.type !== selectedTypeFilter) return false;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      return acc.name.toLowerCase().includes(term) || acc.code.includes(term);
    }
    return true;
  });

  const getTypeBadgeColor = (type: AccountType) => {
    switch (type) {
      case 'ASSET':
        return 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border-blue-200';
      case 'LIABILITY':
        return 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border-amber-200';
      case 'COST':
        return 'bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300 border-orange-200';
      case 'EXPENSE':
        return 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 border-rose-200';
      case 'REVENUE':
        return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border-emerald-200';
      default:
        return 'bg-zinc-50 text-zinc-700 border-zinc-200';
    }
  };

  const getTypeLabel = (type: AccountType) => {
    switch (type) {
      case 'ASSET': return '1. Ativo';
      case 'LIABILITY': return '2. Passivo';
      case 'COST': return '3. Custos';
      case 'EXPENSE': return '4. Despesas';
      case 'REVENUE': return '5. Receitas';
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#fbfbfd] dark:bg-black">
      <Navbar currentClient={currentClient || undefined} clients={clients} />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">
              Plano de Contas
            </h1>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
              Estrutura hierárquica contábil oficial (Ativo, Passivo, Custos, Despesas e Receitas)
            </p>
          </div>

          <button
            onClick={() => setIsModalOpen(true)}
            className="ios-button inline-flex items-center gap-1.5 px-4 py-2 rounded-2xl text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Nova Subconta Analítica</span>
          </button>
        </div>

        {/* Filter Bar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar por código ou nome da conta..."
              className="w-full pl-9 pr-4 py-2 text-xs rounded-2xl border border-black/[0.08] dark:border-white/[0.08] bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 shadow-sm"
            />
          </div>

          <div className="flex items-center gap-1.5 p-1 bg-black/[0.03] dark:bg-white/[0.04] rounded-2xl border border-black/[0.04] dark:border-white/[0.06] overflow-x-auto">
            <button
              onClick={() => setSelectedTypeFilter('ALL')}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
                selectedTypeFilter === 'ALL'
                  ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900'
              }`}
            >
              Todas ({accounts.length})
            </button>
            {(['ASSET', 'LIABILITY', 'COST', 'EXPENSE', 'REVENUE'] as AccountType[]).map(
              (type) => (
                <button
                  key={type}
                  onClick={() => setSelectedTypeFilter(type)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
                    selectedTypeFilter === type
                      ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm'
                      : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900'
                  }`}
                >
                  {getTypeLabel(type)}
                </button>
              )
            )}
          </div>
        </div>

        {/* Hierarchical Tree Table */}
        <div className="ios-card rounded-3xl overflow-hidden border border-black/[0.06] dark:border-white/[0.08] shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-black/[0.06] dark:border-white/[0.08] bg-zinc-50/70 dark:bg-zinc-800/40 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                  <th className="py-3 px-4">Código</th>
                  <th className="py-3 px-4">Descrição da Conta</th>
                  <th className="py-3 px-4">Grupo / Tipo</th>
                  <th className="py-3 px-4">Natureza</th>
                  <th className="py-3 px-4">Mapeamento DRE</th>
                  <th className="py-3 px-4 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.04] dark:divide-white/[0.04] text-xs">
                {filteredAccounts.map((acc) => {
                  const isSynthetic = acc.nature === 'SYNTHETIC';
                  const indentLevel = Math.max(0, acc.level - 1) * 20;

                  return (
                    <tr
                      key={acc.id}
                      className={`hover:bg-black/[0.015] dark:hover:bg-white/[0.02] transition-colors ${
                        isSynthetic ? 'bg-zinc-50/40 dark:bg-zinc-900/30 font-semibold' : ''
                      }`}
                    >
                      <td className="py-3 px-4 font-mono text-zinc-800 dark:text-zinc-200">
                        {acc.code}
                      </td>
                      <td className="py-3 px-4">
                        <div
                          className="flex items-center gap-2"
                          style={{ paddingLeft: `${indentLevel}px` }}
                        >
                          {isSynthetic ? (
                            <FolderTree className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                          ) : (
                            <FileText className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
                          )}
                          <span
                            className={
                              isSynthetic
                                ? 'text-zinc-900 dark:text-white font-medium'
                                : 'text-zinc-700 dark:text-zinc-300'
                            }
                          >
                            {acc.name}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-medium border ${getTypeBadgeColor(
                            acc.type
                          )}`}
                        >
                          {getTypeLabel(acc.type)}
                        </span>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={`text-[11px] font-medium ${
                            isSynthetic
                              ? 'text-zinc-500 uppercase tracking-wider text-[10px]'
                              : 'text-blue-600 dark:text-blue-400'
                          }`}
                        >
                          {isSynthetic ? 'Sintética (Grupo)' : 'Analítica (Lançamentos)'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-zinc-500 dark:text-zinc-400 font-mono text-[11px]">
                        {acc.dreGroup || '-'}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {!isSynthetic && (
                          <button
                            onClick={() => handleDelete(acc.id)}
                            className="p-1.5 rounded-lg text-zinc-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                            title="Excluir conta analítica"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {/* Modal Nova Conta */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl ios-card p-6 shadow-2xl bg-white dark:bg-zinc-900 border border-black/[0.08] dark:border-white/[0.1]">
            <div className="flex items-center justify-between pb-3 border-b border-black/[0.06] dark:border-white/[0.08]">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">
                Cadastrar Subconta Contábil
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="w-7 h-7 rounded-full flex items-center justify-center text-zinc-400 hover:text-zinc-600 hover:bg-black/[0.04]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateAccount} className="mt-4 space-y-3.5 text-xs">
              <div>
                <label className="font-semibold text-zinc-700 dark:text-zinc-300 block mb-1">
                  Código Contábil (ex: 4.1.02.004)
                </label>
                <input
                  type="text"
                  required
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value)}
                  placeholder="Ex: 4.1.02.004"
                  className="w-full font-mono px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              <div>
                <label className="font-semibold text-zinc-700 dark:text-zinc-300 block mb-1">
                  Nome da Conta
                </label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Ex: Assinaturas de IA e Ferramentas Cloud"
                  className="w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-zinc-700 dark:text-zinc-300 block mb-1">
                    Tipo de Conta
                  </label>
                  <select
                    value={newType}
                    onChange={(e) => setNewType(e.target.value as AccountType)}
                    className="w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white"
                  >
                    <option value="EXPENSE">4. Despesas</option>
                    <option value="REVENUE">5. Receitas</option>
                    <option value="COST">3. Custos</option>
                    <option value="ASSET">1. Ativo</option>
                    <option value="LIABILITY">2. Passivo</option>
                  </select>
                </div>

                <div>
                  <label className="font-semibold text-zinc-700 dark:text-zinc-300 block mb-1">
                    Natureza
                  </label>
                  <select
                    value={newNature}
                    onChange={(e) => setNewNature(e.target.value as AccountNature)}
                    className="w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white"
                  >
                    <option value="ANALYTIC">Analítica (Recebe lançamentos)</option>
                    <option value="SYNTHETIC">Sintética (Grupo pai)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="font-semibold text-zinc-700 dark:text-zinc-300 block mb-1">
                  Grupo no Demonstrativo DRE
                </label>
                <select
                  value={newDREGroup}
                  onChange={(e) => setNewDREGroup(e.target.value as DREGroup)}
                  className="w-full px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white"
                >
                  <option value="">Não impacta DRE (Patrimonial)</option>
                  <option value="RECEITA_BRUTA">Receita Bruta</option>
                  <option value="DEDUCOES_RECEITA">Deduções da Receita / Impostos</option>
                  <option value="CUSTOS">Custos dos Serviços / CMV</option>
                  <option value="DESPESAS_ADMINISTRATIVAS">Despesas Administrativas</option>
                  <option value="DESPESAS_COMERCIAIS">Despesas Comerciais / Marketing</option>
                  <option value="DESPESAS_FINANCEIRAS">Despesas Financeiras / Tarifas</option>
                  <option value="RECEITAS_FINANCEIRAS">Receitas Financeiras / Rendimentos</option>
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
                  className="ios-button px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-medium shadow-sm flex items-center gap-1.5"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Cadastrar Conta</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
