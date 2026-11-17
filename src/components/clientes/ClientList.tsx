'use client';

import { Download, Pencil, Trash2 } from 'lucide-react';
import type { ClientCompany } from '@/types/firestore';
import type { ClientIssue } from '@/lib/client-health';
import { PORTE_LABEL, porteOf } from '@/lib/accounting-standard';
import { formatCNPJ, formatDateBR } from '@/lib/utils/formatters';
import { BUTTON, SURFACE, TABLE_HEAD } from '@/components/ui/primitives';
import { regimeLabel } from '@/components/clientes/options';
import { ClientIssueChips } from '@/components/clientes/ClientIssueChips';

const ICON_BUTTON =
  'w-8 h-8 rounded-full flex items-center justify-center text-stone-400 hover:text-stone-800 dark:hover:text-stone-200 hover:bg-black/5 dark:hover:bg-white/8 disabled:opacity-40 active:scale-[0.94] transition-all duration-150';

interface ClientListProps {
  clients: readonly ClientCompany[];
  activeId: string | null;
  issuesOf: (client: ClientCompany) => readonly ClientIssue[];
  deletingId: string | null;
  backingUpId: string | null;
  onActivate: (client: ClientCompany) => void;
  onEdit: (client: ClientCompany) => void;
  onIssue: (client: ClientCompany, issue: ClientIssue) => void;
  onBackup: (client: ClientCompany) => void;
  onAskDelete: (client: ClientCompany) => void;
  /** Retoma uma exclusão que parou no meio. */
  onDelete: (client: ClientCompany) => void;
}

/** Carteira em lista: uma linha por empresa, para comparar cadastros lado a lado. */
export function ClientList({ clients, activeId, issuesOf, deletingId, backingUpId, onActivate, onEdit, onIssue, onBackup, onAskDelete, onDelete }: ClientListProps) {
  return (
    <div className={`${SURFACE} rounded-[22px] overflow-x-auto`}>
      <table className="w-full min-w-[980px] text-[13px]">
        <thead>
          <tr className={TABLE_HEAD}>
            <th scope="col" className="text-left font-semibold px-5 py-2.5">Empresa</th>
            <th scope="col" className="text-left font-semibold px-3 py-2.5">CNPJ</th>
            <th scope="col" className="text-left font-semibold px-3 py-2.5">Regime</th>
            <th scope="col" className="text-left font-semibold px-3 py-2.5">Porte</th>
            <th scope="col" className="text-left font-semibold px-3 py-2.5">Cliente desde</th>
            <th scope="col" className="text-left font-semibold px-3 py-2.5">Cadastro</th>
            <th scope="col" className="px-5 py-2.5">
              <span className="sr-only">Ações</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-black/4 dark:divide-white/5">
          {clients.map((c) => {
            const label = c.tradeName || c.name;
            const active = c.id === activeId;
            const deleting = deletingId === c.id;
            if (c.deletingAt) {
              return (
                <tr key={c.id} className="bg-amber-50/70 dark:bg-amber-950/20">
                  <th scope="row" className="text-left font-medium px-5 py-3 text-stone-900 dark:text-stone-50">
                    {label}
                  </th>
                  <td colSpan={5} className="px-3 py-3 text-[12px] text-amber-800 dark:text-amber-300">
                    Exclusão incompleta: parte dos dados já foi apagada. Retome para concluir.
                  </td>
                  <td className="px-5 py-3 text-right">
                    {deleting ? (
                      <span className="text-[12px] text-stone-500">Excluindo…</span>
                    ) : (
                      <button type="button" onClick={() => onDelete(c)} className={`${BUTTON.secondary} h-8 px-3`}>
                        <Trash2 className="w-3.5 h-3.5" /> Retomar exclusão
                      </button>
                    )}
                  </td>
                </tr>
              );
            }
            return (
              <tr key={c.id} className={active ? 'bg-accent/[0.04] dark:bg-accent/[0.08]' : 'hover:bg-black/[0.015] dark:hover:bg-white/[0.03]'}>
                <th scope="row" className="text-left font-normal px-5 py-3 max-w-[280px]">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[14px] font-medium tracking-tight text-stone-900 dark:text-stone-50">{label}</span>
                    {active && (
                      <span className="shrink-0 inline-flex items-center gap-1.5 px-2 py-px rounded-full border text-[10.5px] font-medium bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200/60 dark:border-emerald-500/25">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        Ativo
                      </span>
                    )}
                  </span>
                  {c.tradeName && <span className="block truncate text-[12px] text-stone-500">{c.name}</span>}
                </th>
                <td className="px-3 py-3 font-mono tabular-nums whitespace-nowrap text-stone-700 dark:text-stone-300">{formatCNPJ(c.cnpj)}</td>
                <td className="px-3 py-3 whitespace-nowrap text-stone-700 dark:text-stone-300">{regimeLabel(c.regime)}</td>
                <td className="px-3 py-3 whitespace-nowrap text-stone-700 dark:text-stone-300">{PORTE_LABEL[porteOf(c)]}</td>
                <td className="px-3 py-3 font-mono tabular-nums whitespace-nowrap text-stone-700 dark:text-stone-300">{c.clientSince ? formatDateBR(c.clientSince) : '—'}</td>
                <td className="px-3 py-3">
                  <ClientIssueChips issues={issuesOf(c)} onIssue={(issue) => onIssue(c, issue)} max={2} />
                </td>
                <td className="px-5 py-3">
                  <span className="flex items-center justify-end gap-1">
                    {!active && (
                      <button type="button" onClick={() => onActivate(c)} className={`${BUTTON.ghost} h-8 px-3 text-accent-ink hover:bg-accent/[0.07] dark:hover:bg-accent/[0.14]`}>
                        Definir como ativo
                      </button>
                    )}
                    <button type="button" onClick={() => onEdit(c)} aria-label={`Editar ${c.name}`} className={ICON_BUTTON}>
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={backingUpId === c.id}
                      onClick={() => onBackup(c)}
                      aria-label={`Baixar backup de ${label}`}
                      title="Baixar backup (JSON) com todos os dados da empresa"
                      className={ICON_BUTTON}
                    >
                      <Download className={`w-3.5 h-3.5 ${backingUpId === c.id ? 'animate-pulse' : ''}`} />
                    </button>
                    {deleting ? (
                      <span className="px-2 text-[12px] text-stone-500 dark:text-stone-400">Excluindo…</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onAskDelete(c)}
                        aria-label={`Excluir ${label} e todos os seus dados`}
                        className="w-8 h-8 rounded-full flex items-center justify-center text-stone-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 active:scale-[0.94] transition-all duration-150"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
