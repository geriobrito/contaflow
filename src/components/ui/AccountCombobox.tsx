'use client';

import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';
import type { ChartAccount } from '@/types/firestore';
import { searchAccounts } from '@/lib/account-search';
import type { AccountSuggestion } from '@/lib/account-suggestions';

/**
 * Seletor de conta do plano, único no app: busca sem acento, em qualquer ordem e tolerando
 * plural (`account-search`), contas sugeridas no topo e teclado (↑ ↓ Enter). Dois formatos:
 * `AccountPicker` (lista aberta, nos sheets de classificação) e `AccountSelectField` (campo que
 * abre a lista, nos formulários).
 */

export type { AccountSuggestion };

interface Row {
  account: ChartAccount;
  reason?: string;
}

interface Section {
  title?: string;
  rows: Row[];
}

/** Sem busca: sugeridas e depois o resto. Com busca: por relevância; no empate, sugeridas primeiro. */
function buildSections(accounts: readonly ChartAccount[], search: string, suggestions: readonly AccountSuggestion[]): Section[] {
  const byId = new Map(accounts.map((a) => [a.id, a] as const));
  const suggested: Row[] = [];
  for (const s of suggestions) {
    const account = byId.get(s.accountId);
    if (account && !suggested.some((r) => r.account.id === account.id)) suggested.push({ account, reason: s.reason });
  }
  const reasonOf = new Map(suggested.map((r) => [r.account.id, r.reason] as const));
  const rest = accounts.filter((a) => !reasonOf.has(a.id));
  if (search.trim()) {
    const rows = searchAccounts([...suggested.map((r) => r.account), ...rest], search).map((account) => ({ account, reason: reasonOf.get(account.id) }));
    return [{ rows }];
  }
  if (suggested.length === 0) return [{ rows: rest.map((account) => ({ account })) }];
  return [
    { title: 'Sugeridas', rows: suggested },
    { title: 'Todas as contas', rows: rest.map((account) => ({ account })) },
  ];
}

interface OptionListProps {
  accounts: readonly ChartAccount[];
  value: string;
  onPick: (accountId: string) => void;
  suggestions: readonly AccountSuggestion[];
  autoFocus: boolean;
  placeholder: string;
  compact: boolean;
  showNature: boolean;
  /** Rola a lista até a conta escolhida ao montar. */
  revealSelected: boolean;
}

function OptionList({ accounts, value, onPick, suggestions, autoFocus, placeholder, compact, showNature, revealSelected }: OptionListProps) {
  const id = useId();
  const [search, setSearch] = useState('');
  const [active, setActive] = useState(-1);
  const listRef = useRef<HTMLUListElement>(null);
  const sections = useMemo(() => buildSections(accounts, search, suggestions), [accounts, search, suggestions]);
  const flat = useMemo(() => sections.flatMap((s) => s.rows), [sections]);
  const optionId = (index: number) => `${id}-opcao-${index}`;

  // Traz a conta atual para o centro da lista; rola só a lista (não o sheet nem a página).
  // Só uma vez por montagem: trocar a seleção não deve mover a lista sob o cursor.
  const revealedRef = useRef(false);
  useEffect(() => {
    if (!revealSelected || revealedRef.current) return;
    revealedRef.current = true;
    const list = listRef.current;
    const item = list?.querySelector<HTMLElement>('[aria-selected="true"]')?.closest('li');
    if (list && item) list.scrollTop = item.offsetTop - list.clientHeight / 2 + item.clientHeight / 2;
  }, [revealSelected]);

  useEffect(() => {
    if (active < 0) return;
    document.getElementById(`${id}-opcao-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, id]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (flat.length === 0) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i < 0 ? (step > 0 ? 0 : flat.length - 1) : (i + step + flat.length) % flat.length));
    } else if (e.key === 'Enter') {
      // Nunca envia o formulário em volta; com texto digitado, Enter escolhe a primeira opção.
      e.preventDefault();
      const row = flat[active >= 0 ? active : search.trim() ? 0 : -1];
      if (row) onPick(row.account.id);
    }
  };

  const text = compact ? 'text-[13px]' : 'text-[14px]';
  const offsets = sections.map((_, si) => sections.slice(0, si).reduce((n, s) => n + s.rows.length, 0));

  return (
    <>
      <div className="relative border-b border-black/4 dark:border-white/6">
        <Search className={`${compact ? 'w-3.5 h-3.5 left-3' : 'w-4 h-4 left-3.5'} absolute top-1/2 -translate-y-1/2 text-stone-400`} />
        <input
          autoFocus={autoFocus}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setActive(e.target.value.trim() ? 0 : -1);
          }}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded
          aria-controls={`${id}-lista`}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? optionId(active) : undefined}
          placeholder={placeholder}
          className={`w-full ${compact ? 'h-9 pl-8' : 'py-3 pl-10'} pr-3 bg-transparent ${text} tracking-tight placeholder:text-stone-400 outline-none`}
        />
      </div>
      <ul id={`${id}-lista`} ref={listRef} role="listbox" className="relative max-h-56 overflow-y-auto overscroll-contain">
        {flat.length === 0 && <li className="px-4 py-6 text-center text-[13px] text-stone-400">Nenhuma conta encontrada</li>}
        {sections.map((section, si) =>
          section.rows.length === 0 ? null : (
            <React.Fragment key={section.title ?? 'contas'}>
              {section.title && (
                <li role="presentation" className="sticky top-0 z-10 px-4 py-1.5 bg-stone-50/95 dark:bg-stone-800/95 backdrop-blur text-[11px] font-medium uppercase tracking-wide text-stone-500 dark:text-stone-400">
                  {section.title}
                </li>
              )}
              {section.rows.map(({ account: a, reason }, j) => {
                const i = offsets[si] + j;
                const selected = a.id === value;
                return (
                  <li key={a.id} role="presentation" className="border-b border-black/4 dark:border-white/4 last:border-0">
                    <button
                      id={optionId(i)}
                      type="button"
                      role="option"
                      tabIndex={-1}
                      aria-selected={selected}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => onPick(a.id)}
                      className={`w-full flex items-center gap-3 ${compact ? 'px-3 py-2' : 'px-4 py-2.5'} text-left transition-colors duration-100 ${
                        selected ? 'bg-accent/5 dark:bg-accent/[0.14]' : i === active ? 'bg-black/4 dark:bg-white/6' : 'hover:bg-black/2 dark:hover:bg-white/3'
                      }`}
                    >
                      <span className={`${compact ? 'w-[86px] text-[11px]' : 'w-[96px] text-[12px]'} shrink-0 font-mono tabular-nums text-stone-400`}>{a.code}</span>
                      <span className="flex-1 min-w-0">
                        <span className={`block truncate ${text} tracking-tight ${selected ? 'text-accent-ink font-medium' : 'text-stone-800 dark:text-stone-200'}`}>{a.name}</span>
                        {reason && <span className="block truncate text-[11px] text-stone-500 dark:text-stone-400">{reason}</span>}
                      </span>
                      {showNature && <span className="text-[10px] uppercase text-stone-500 dark:text-stone-400 font-mono shrink-0">{a.nature === 'SYNTHETIC' ? 'Sintética' : 'Analítica'}</span>}
                      {selected && <Check className="w-4 h-4 text-accent-ink shrink-0" strokeWidth={2.5} />}
                    </button>
                  </li>
                );
              })}
            </React.Fragment>
          )
        )}
      </ul>
    </>
  );
}

const analyticOf = (accounts: readonly ChartAccount[], analyticOnly: boolean) => (analyticOnly ? accounts.filter((a) => a.nature === 'ANALYTIC') : accounts);

interface AccountPickerProps {
  accounts: readonly ChartAccount[];
  value: string;
  onChange: (accountId: string) => void;
  autoFocus?: boolean;
  suggestions?: readonly AccountSuggestion[];
}

const NO_SUGGESTIONS: readonly AccountSuggestion[] = [];

/** Lista aberta de contas analíticas (classificação única, em lote e por favorecido). */
export function AccountPicker({ accounts, value, onChange, autoFocus = false, suggestions = NO_SUGGESTIONS }: AccountPickerProps) {
  const options = useMemo(() => analyticOf(accounts, true), [accounts]);
  return (
    <div className="rounded-2xl bg-white dark:bg-stone-800/60 border border-line overflow-hidden">
      <OptionList
        accounts={options}
        value={value}
        onPick={onChange}
        suggestions={suggestions}
        autoFocus={autoFocus}
        placeholder="Buscar por código ou nome"
        compact={false}
        showNature={false}
        revealSelected
      />
    </div>
  );
}

interface AccountSelectFieldProps {
  accounts: readonly ChartAccount[];
  value: string;
  onChange: (accountId: string) => void;
  /** Nome acessível do campo. */
  label: string;
  placeholder?: string;
  disabled?: boolean;
  /** Só contas analíticas (padrão) ou também as sintéticas, marcadas na lista. */
  analyticOnly?: boolean;
  suggestions?: readonly AccountSuggestion[];
  /** Classes do contêiner (largura). */
  className?: string;
  /** Largura mínima da lista aberta, em px (padrão: a do campo, no mínimo 320). */
  panelWidth?: number;
  /** Lista alinhada pelo começo (padrão) ou pelo fim do campo. */
  align?: 'start' | 'end';
  /** Altura do campo (padrão `h-10`), para alinhar com os campos vizinhos. */
  triggerClassName?: string;
}

/** Altura aproximada da lista aberta (busca + até ~6 contas), para decidir se abre para cima. */
const PANEL_HEIGHT = 280;
const GAP = 6;

/** Campo que abre a lista de contas com busca (formulários: rateio, regras, lançamentos, razão). */
export function AccountSelectField({
  accounts,
  value,
  onChange,
  label,
  placeholder = 'Selecionar conta…',
  disabled = false,
  analyticOnly = true,
  suggestions = NO_SUGGESTIONS,
  className = '',
  panelWidth = 320,
  align = 'start',
  triggerClassName = 'h-10',
}: AccountSelectFieldProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<React.CSSProperties | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const options = useMemo(() => analyticOf(accounts, analyticOnly), [accounts, analyticOnly]);
  const selected = accounts.find((a) => a.id === value);

  // A lista vai para o <body> em posição fixa, junto ao campo: nenhum contêiner com rolagem
  // (tabela de partidas, corpo do modal) a corta. Abre para cima se faltar espaço embaixo.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.min(Math.max(r.width, panelWidth), window.innerWidth - 2 * GAP);
      const left = Math.min(Math.max(GAP, align === 'end' ? r.right - width : r.left), window.innerWidth - width - GAP);
      const below = window.innerHeight - r.bottom;
      setPosition(
        below < PANEL_HEIGHT && r.top > below ? { left, width, bottom: window.innerHeight - r.top + GAP } : { left, width, top: r.bottom + GAP }
      );
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, panelWidth, align]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!ref.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false);
    };
    // Na captura: o Esc fecha só a lista, não o modal em volta.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <div ref={ref} className={`relative min-w-0 ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={`w-full ${triggerClassName} px-3 flex items-center gap-2 rounded-xl border text-left transition-all duration-150 active:scale-[0.99] disabled:opacity-60 disabled:pointer-events-none ${
          open
            ? 'border-accent/60 shadow-[0_0_0_4px_rgba(181,85,47,0.12)] bg-white dark:bg-stone-800'
            : 'border-line-strong bg-white dark:bg-stone-800/70 hover:border-black/[0.14]'
        }`}
      >
        {selected ? (
          <span className="flex-1 min-w-0 truncate text-[13px] text-stone-900 dark:text-stone-100">
            <span className="font-mono tabular-nums text-[11px] text-stone-500 dark:text-stone-400 mr-1.5">{selected.code}</span>
            {selected.name}
          </span>
        ) : (
          <span className="flex-1 min-w-0 truncate text-[13px] text-stone-400">{placeholder}</span>
        )}
        <ChevronDown className="w-3.5 h-3.5 text-stone-400 shrink-0" />
      </button>

      {open &&
        position &&
        createPortal(
        <div
          ref={panelRef}
          style={position}
          className="fixed z-[60] rounded-2xl bg-surface border border-line-strong shadow-raised overflow-hidden animate-pop-in"
        >
          <OptionList
            accounts={options}
            value={value}
            onPick={(id) => {
              onChange(id);
              setOpen(false);
              triggerRef.current?.focus();
            }}
            suggestions={suggestions}
            autoFocus
            placeholder="Código ou nome"
            compact
            showNature={!analyticOnly && options.some((a) => a.nature === 'ANALYTIC') && options.some((a) => a.nature === 'SYNTHETIC')}
            revealSelected
          />
        </div>,
        document.body
      )}
    </div>
  );
}
