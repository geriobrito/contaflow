'use client';

import React from 'react';
import { Calendar, CreditCard, DollarSign, FileText, HelpCircle, type LucideIcon } from 'lucide-react';
import type { CSVColumnMapping } from '@/lib/csv/parser';
import { FIELD_LABEL, INPUT_COMPACT } from '@/components/ui/primitives';
import type { csvColumnOptions } from '@/lib/csv/batch';

type ColumnOption = ReturnType<typeof csvColumnOptions>[number];

interface CSVColumnFieldsProps {
  mapping: CSVColumnMapping;
  columns: readonly ColumnOption[];
  /** Altera o mapeamento (a configuração passa a ser manual). */
  onEdit: (update: (m: CSVColumnMapping) => CSVColumnMapping) => void;
}

const SELECT = `${INPUT_COMPACT} w-full`;
const LABEL = `${FIELD_LABEL} mb-1.5 flex items-center gap-1.5`;

function ColumnSelect({
  label,
  icon: Icon,
  iconClassName,
  value,
  onChange,
  columns,
  emptyOption,
}: {
  label: string;
  icon: LucideIcon;
  iconClassName: string;
  value: number;
  onChange: (index: number) => void;
  columns: readonly ColumnOption[];
  /** Opção com valor -1 antes das colunas (campo opcional). */
  emptyOption?: string;
}) {
  return (
    <>
      <label className={LABEL}>
        <Icon className={`w-3.5 h-3.5 ${iconClassName}`} />
        {label}
      </label>
      <select value={value} onChange={(e) => onChange(parseInt(e.target.value, 10))} className={SELECT}>
        {emptyOption && <option value="-1">{emptyOption}</option>}
        {columns.map((c) => (
          <option key={c.index} value={c.index}>
            {c.label}
          </option>
        ))}
      </select>
    </>
  );
}

/** Mapeamento das colunas do CSV: data, histórico, documento, valor (único ou débito/crédito) e inversão de sinais. */
export function CSVColumnFields({ mapping, columns, onEdit }: CSVColumnFieldsProps) {
  return (
    <div className="p-4 rounded-xl border border-line bg-stone-50/50 dark:bg-stone-800/30 space-y-4">
      <h3 className="text-[14px] font-semibold text-stone-900 dark:text-stone-100 flex items-center gap-2">Mapeamento de Campos</h3>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <ColumnSelect
            label="Coluna da Data *"
            icon={Calendar}
            iconClassName="text-accent-ink"
            value={mapping.dateCol}
            onChange={(dateCol) => onEdit((m) => ({ ...m, dateCol }))}
            columns={columns}
          />
        </div>
        <div>
          <ColumnSelect
            label="Coluna da Descrição / Histórico *"
            icon={FileText}
            iconClassName="text-purple-600 dark:text-purple-300"
            value={mapping.memoCol}
            onChange={(memoCol) => onEdit((m) => ({ ...m, memoCol }))}
            columns={columns}
          />
        </div>
        <div>
          <ColumnSelect
            label="Coluna de Documento / FITID (Opcional)"
            icon={HelpCircle}
            iconClassName="text-stone-400"
            value={mapping.docCol ?? -1}
            onChange={(val) => onEdit((m) => ({ ...m, docCol: val === -1 ? undefined : val }))}
            columns={columns}
            emptyOption="Gerar identificador automático (Recomendado)"
          />
        </div>
      </div>

      {/* Configuração de Valores (Único vs Separado) */}
      <div className="space-y-3 pt-2 border-t border-black/4 dark:border-white/6">
        <div className="flex flex-wrap items-center gap-6">
          <span className="text-[12px] font-medium text-stone-600 dark:text-stone-300">Formato do Valor:</span>
          <label className="inline-flex items-center gap-2 text-[13px] text-stone-700 dark:text-stone-300 cursor-pointer">
            <input
              type="radio"
              name="valueMode"
              checked={mapping.valueMode === 'single'}
              onChange={() => onEdit((m) => ({ ...m, valueMode: 'single', amountCol: m.amountCol ?? 0 }))}
              className="text-accent-ink"
            />
            Coluna Única com sinal (+ / -)
          </label>
          <label className="inline-flex items-center gap-2 text-[13px] text-stone-700 dark:text-stone-300 cursor-pointer">
            <input
              type="radio"
              name="valueMode"
              checked={mapping.valueMode === 'split'}
              onChange={() =>
                onEdit((m) => ({
                  ...m,
                  valueMode: 'split',
                  debitCol: m.debitCol ?? 0,
                  creditCol: m.creditCol ?? Math.min(1, Math.max(0, columns.length - 1)),
                }))
              }
              className="text-accent-ink"
            />
            Colunas Separadas (Débito e Crédito)
          </label>
        </div>

        {mapping.valueMode === 'single' ? (
          <div className="w-full md:w-1/2">
            <ColumnSelect
              label="Coluna do Valor *"
              icon={DollarSign}
              iconClassName="text-emerald-600 dark:text-emerald-300"
              value={mapping.amountCol ?? 0}
              onChange={(amountCol) => onEdit((m) => ({ ...m, amountCol }))}
              columns={columns}
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <ColumnSelect
                label="Coluna de Saída (Débito) *"
                icon={DollarSign}
                iconClassName="text-rose-600 dark:text-rose-300"
                value={mapping.debitCol ?? 0}
                onChange={(debitCol) => onEdit((m) => ({ ...m, debitCol }))}
                columns={columns}
              />
            </div>
            <div>
              <ColumnSelect
                label="Coluna de Entrada (Crédito) *"
                icon={DollarSign}
                iconClassName="text-emerald-600 dark:text-emerald-300"
                value={mapping.creditCol ?? 0}
                onChange={(creditCol) => onEdit((m) => ({ ...m, creditCol }))}
                columns={columns}
              />
            </div>
          </div>
        )}
      </div>

      {/* Inversão de Sinal (Fatura de Cartão) */}
      <div className="pt-2 border-t border-black/4 dark:border-white/6">
        <label className="flex items-start gap-3 p-3 rounded-xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-800/30 cursor-pointer">
          <input
            type="checkbox"
            checked={mapping.invertSigns ?? false}
            onChange={(e) => {
              const invertSigns = e.target.checked;
              onEdit((m) => ({ ...m, invertSigns }));
            }}
            className="mt-0.5 rounded border-amber-300 dark:border-amber-500/25 text-amber-600 dark:text-amber-300 focus:ring-amber-500"
          />
          <div className="text-[12px]">
            <span className="font-semibold text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
              <CreditCard className="w-3.5 h-3.5" /> Inverter sinais (+/-) — Recomendado para Faturas de Cartão de Crédito
            </span>
            <p className="text-amber-700 dark:text-amber-300/80 mt-0.5 leading-relaxed">
              Na maioria das faturas de cartão, compras vêm com valores positivos e pagamentos como negativos. Ao marcar esta opção, o sistema
              inverte os sinais para que as compras sejam registradas como saídas (débitos) no extrato.
            </p>
          </div>
        </label>
      </div>
    </div>
  );
}

