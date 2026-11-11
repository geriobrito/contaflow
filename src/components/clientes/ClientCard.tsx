'use client';

import { Download, Pencil, Trash2 } from 'lucide-react';
import type { ClientCompany } from '@/types/firestore';
import { PORTE_LABEL, porteOf } from '@/lib/accounting-standard';
import { clientInitials } from '@/lib/client-record';
import { formatCNPJ } from '@/lib/utils/formatters';
import { BUTTON } from '@/components/ui/primitives';
import { regimeLabel } from '@/components/clientes/options';

interface ClientCardProps {
  client: ClientCompany;
  active: boolean;
  onActivate: () => void;
  onEdit: () => void;
  /** Baixa o backup (JSON) com todos os dados da empresa. */
  onBackup: () => void;
  backingUp: boolean;
  /** Abre a confirmação de exclusão (que oferece o backup antes). */
  onAskDelete: () => void;
  /** Retoma uma exclusão que parou no meio. */
  onDelete: () => void;
  deleting: boolean;
}

/** Cartão de uma empresa da carteira. */
export function ClientCard({ client, active, onActivate, onEdit, onBackup, backingUp, onAskDelete, onDelete, deleting }: ClientCardProps) {
  const regime = client.regime;
  const label = client.tradeName || client.name;

  // A exclusão apaga os dados em vários lotes; se parou no meio, a empresa fica só para ser retomada.
  if (client.deletingAt) {
    return (
      <article className="relative flex flex-col rounded-[22px] p-5 border border-amber-200/70 bg-amber-50/70 dark:bg-amber-950/20 dark:border-amber-900/40">
        <h3 className="text-[15px] font-semibold tracking-tight text-stone-900 dark:text-stone-50 truncate">{label}</h3>
        <p className="mt-1 text-[12px] font-medium text-amber-800 dark:text-amber-300">Exclusão incompleta</p>
        <p className="mt-2 text-[12px] text-stone-600 dark:text-stone-300">
          A exclusão desta empresa começou e não terminou; parte dos dados já foi apagada. Retome para concluir.
        </p>
        <div className="mt-4 pt-4 border-t border-amber-200/60 dark:border-amber-900/40 flex justify-end">
          {deleting ? (
            <span className="px-2 text-[12px] text-stone-500">Excluindo…</span>
          ) : (
            <button type="button" onClick={onDelete} className={`${BUTTON.secondary} h-8 px-3 whitespace-nowrap`}>
              <Trash2 className="w-3.5 h-3.5" /> Retomar exclusão
            </button>
          )}
        </div>
      </article>
    );
  }

  return (
    <article
      className={`relative flex flex-col rounded-[22px] p-5 backdrop-blur-xl border transition-all duration-200 ${
        active
          ? 'bg-surface border-accent/30 shadow-[0_0_0_4px_rgba(181,85,47,0.08),0_8px_24px_rgba(0,0,0,0.06)]'
          : 'bg-white/70 dark:bg-stone-900/60 border-line shadow-card hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)]'
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`w-11 h-11 shrink-0 rounded-2xl flex items-center justify-center text-[13px] font-semibold tracking-tight ${
            active ? 'bg-accent text-white' : 'bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900'
          }`}
        >
          {clientInitials(label) || '—'}
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="text-[15px] font-semibold tracking-tight text-stone-900 dark:text-stone-50 truncate">{label}</h3>
          <p className="text-[12px] text-stone-500 truncate">{client.name}</p>
        </div>
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Editar ${client.name}`}
          className="w-8 h-8 -mr-1 -mt-1 rounded-full flex items-center justify-center text-stone-400 hover:text-stone-800 dark:hover:text-stone-200 hover:bg-black/5 active:scale-[0.94] transition-all duration-150"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-3 text-[12px]">
        <div className="min-w-0">
          <dt className="text-stone-400">CNPJ</dt>
          <dd className="mt-0.5 font-mono tabular-nums text-stone-800 dark:text-stone-200 truncate">{formatCNPJ(client.cnpj)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-stone-400">Regime</dt>
          <dd className="mt-0.5 text-stone-800 dark:text-stone-200 truncate">{regimeLabel(regime)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-stone-400">Porte</dt>
          <dd className="mt-0.5 text-stone-800 dark:text-stone-200 truncate">{PORTE_LABEL[porteOf(client)]}</dd>
        </div>
        {client.city && (
          <div className="min-w-0">
            <dt className="text-stone-400">Município</dt>
            <dd className="mt-0.5 text-stone-800 dark:text-stone-200 truncate">{client.city}</dd>
          </div>
        )}
      </dl>

      <div className="mt-5 pt-4 border-t border-line flex items-center justify-between gap-3">
        {active ? (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[11px] font-medium bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200/60 dark:border-emerald-500/25">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Ativo
          </span>
        ) : (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full border text-[11px] font-medium bg-stone-50 dark:bg-stone-800 text-stone-500 border-stone-200/60 dark:border-stone-700">
            Disponível
          </span>
        )}
        <div className="flex items-center gap-1">
          {!active && (
            <button type="button" onClick={onActivate} className={`${BUTTON.ghost} h-8 px-3 whitespace-nowrap text-accent-ink hover:bg-accent/[0.07] dark:hover:bg-accent/[0.14]`}>
              Definir como ativo
            </button>
          )}
          <button
            type="button"
            disabled={backingUp}
            onClick={onBackup}
            aria-label={`Baixar backup de ${label}`}
            title="Baixar backup (JSON) com todos os dados da empresa"
            className="w-8 h-8 rounded-full flex items-center justify-center text-stone-400 hover:text-stone-800 dark:hover:text-stone-200 hover:bg-black/5 disabled:opacity-40 active:scale-[0.94] transition-all duration-150"
          >
            <Download className={`w-3.5 h-3.5 ${backingUp ? 'animate-pulse' : ''}`} />
          </button>
          {deleting ? (
            <span className="px-2 text-[12px] text-stone-400">Excluindo…</span>
          ) : (
            <button
              type="button"
              onClick={onAskDelete}
              aria-label={`Excluir ${label} e todos os seus dados`}
              className="w-8 h-8 rounded-full flex items-center justify-center text-stone-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 active:scale-[0.94] transition-all duration-150"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
