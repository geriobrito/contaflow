'use client';

import React, { useState, useEffect } from 'react';
import { Navbar } from '@/components/layout/Navbar';
import { ClientCompany, DREResult } from '@/types/firestore';
import { getClients, generateDRE } from '@/lib/services/data-service';
import { formatCurrency, formatDateBR } from '@/lib/utils/formatters';
import {
  TrendingUp,
  Calendar,
  Building2,
  FileSpreadsheet,
  ChevronDown,
  ChevronRight,
  Printer,
  Sparkles,
} from 'lucide-react';

export default function DREPage() {
  const [clients, setClients] = useState<ClientCompany[]>([]);
  const [currentClient, setCurrentClient] = useState<ClientCompany | null>(null);
  const [startDate, setStartDate] = useState('2024-01-01');
  const [endDate, setEndDate] = useState('2024-12-31');
  const [dreResult, setDreResult] = useState<DREResult | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    'dre-1': true,
    'dre-2': true,
    'dre-4': true,
    'dre-6': true,
    'dre-7': true,
  });

  useEffect(() => {
    async function init() {
      const loadedClients = await getClients();
      setClients(loadedClients);
      if (loadedClients.length > 0) {
        const client = loadedClients[0];
        setCurrentClient(client);
        const res = await generateDRE(client.id, startDate, endDate);
        setDreResult(res);
      }
    }
    init();
  }, []);

  const handleRecalculate = async () => {
    if (!currentClient) return;
    const res = await generateDRE(currentClient.id, startDate, endDate);
    setDreResult(res);
  };

  const toggleSection = (id: string) => {
    setExpandedSections((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#fbfbfd] dark:bg-black">
      <Navbar currentClient={currentClient || undefined} clients={clients} />

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shadow-sm">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">
                DRE - Demonstração do Resultado
              </h1>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Relatório sintético e analítico oficial calculado a partir dos lançamentos conciliados
              </p>
            </div>
          </div>

          <button
            onClick={() => window.print()}
            className="ios-button inline-flex items-center gap-1.5 px-4 py-2 rounded-2xl text-xs font-medium bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 shadow-sm"
          >
            <Printer className="w-4 h-4" />
            <span>Imprimir / PDF</span>
          </button>
        </div>

        {/* Filter Controls Bar */}
        <div className="ios-card p-4 rounded-3xl border border-black/[0.06] dark:border-white/[0.08] flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-zinc-400" />
              <span className="font-medium text-zinc-600 dark:text-zinc-400">De:</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white"
              />
            </div>

            <div className="flex items-center gap-2">
              <span className="font-medium text-zinc-600 dark:text-zinc-400">Até:</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white"
              />
            </div>

            <button
              onClick={handleRecalculate}
              className="ios-button px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-medium shadow-sm"
            >
              Atualizar Período
            </button>
          </div>

          {currentClient && (
            <div className="text-right">
              <div className="text-xs font-semibold text-zinc-900 dark:text-white">
                {currentClient.name}
              </div>
              <div className="text-[11px] text-zinc-400">
                Regime: {currentClient.taxRegime} • CNPJ: {currentClient.cnpj}
              </div>
            </div>
          )}
        </div>

        {/* Highlight KPI Cards */}
        {dreResult && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="ios-card p-4 rounded-3xl border border-black/[0.06] dark:border-white/[0.08]">
              <span className="text-[11px] uppercase tracking-wider text-zinc-400 font-medium">
                Receita Operacional Bruta
              </span>
              <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                {formatCurrency(dreResult.grossRevenue)}
              </div>
            </div>

            <div className="ios-card p-4 rounded-3xl border border-black/[0.06] dark:border-white/[0.08]">
              <span className="text-[11px] uppercase tracking-wider text-zinc-400 font-medium">
                Lucro Bruto
              </span>
              <div className="text-xl font-bold text-zinc-900 dark:text-white mt-1">
                {formatCurrency(dreResult.grossProfit)}
              </div>
            </div>

            <div className="ios-card p-4 rounded-3xl border border-black/[0.06] dark:border-white/[0.08]">
              <span className="text-[11px] uppercase tracking-wider text-zinc-400 font-medium">
                Resultado Líquido (Lucro/Prejuízo)
              </span>
              <div
                className={`text-xl font-bold mt-1 ${
                  dreResult.netProfit >= 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {formatCurrency(dreResult.netProfit)}
              </div>
            </div>
          </div>
        )}

        {/* DRE Structured Statement Table */}
        <div className="ios-card rounded-3xl overflow-hidden border border-black/[0.06] dark:border-white/[0.08] shadow-sm">
          <div className="p-4 border-b border-black/[0.06] dark:border-white/[0.08] bg-zinc-50/50 dark:bg-zinc-800/30 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-zinc-900 dark:text-white uppercase tracking-wider">
              Estrutura Demonstrativa do Resultado
            </h3>
            <span className="text-[11px] text-zinc-400">
              Período: {formatDateBR(startDate)} a {formatDateBR(endDate)}
            </span>
          </div>

          <div className="divide-y divide-black/[0.04] dark:divide-white/[0.04] text-xs">
            {dreResult?.items.map((line) => {
              const hasChildren = line.children && line.children.length > 0;
              const isExpanded = expandedSections[line.id] ?? false;

              return (
                <div key={line.id} className="group">
                  <div
                    onClick={() => hasChildren && toggleSection(line.id)}
                    className={`flex items-center justify-between py-3.5 px-5 transition-colors ${
                      line.isTotal
                        ? 'bg-zinc-100/60 dark:bg-zinc-800/60 font-bold text-zinc-900 dark:text-white'
                        : hasChildren
                        ? 'cursor-pointer hover:bg-black/[0.015] dark:hover:bg-white/[0.02]'
                        : ''
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {hasChildren ? (
                        <button className="text-zinc-400 hover:text-zinc-600">
                          {isExpanded ? (
                            <ChevronDown className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5" />
                          )}
                        </button>
                      ) : (
                        <span className="w-3.5" />
                      )}
                      <span className={line.isTotal ? 'text-xs' : 'font-semibold text-zinc-800 dark:text-zinc-200'}>
                        {line.title}
                      </span>
                    </div>

                    <div
                      className={`font-mono text-right font-semibold ${
                        line.isTotal
                          ? line.value >= 0
                            ? 'text-emerald-600 dark:text-emerald-400 text-sm'
                            : 'text-rose-600 dark:text-rose-400 text-sm'
                          : 'text-zinc-800 dark:text-zinc-200'
                      }`}
                    >
                      {formatCurrency(line.value)}
                    </div>
                  </div>

                  {/* Subcontas Analíticas Detalhadas */}
                  {hasChildren && isExpanded && (
                    <div className="bg-zinc-50/50 dark:bg-zinc-900/40 border-y border-black/[0.02] dark:border-white/[0.02] divide-y divide-black/[0.02] dark:divide-white/[0.02]">
                      {line.children?.map((sub) => (
                        <div
                          key={sub.id}
                          className="flex items-center justify-between py-2.5 px-5 pl-12 text-[11px] text-zinc-600 dark:text-zinc-400 hover:bg-black/[0.01]"
                        >
                          <span>{sub.title}</span>
                          <span className="font-mono">{formatCurrency(sub.value)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </main>
    </div>
  );
}
