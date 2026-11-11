'use client';

import React, { useEffect, useId, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Inbox, Search, X, type LucideIcon } from 'lucide-react';
import { SLIDING_INDICATOR, useSlidingIndicator } from '@/components/ui/useSlidingIndicator';
import { ModalPortal } from '@/components/ui/ModalPortal';

/* =========================================================================
   Tokens de superfície e controles
   ========================================================================= */

/** Container fluido das páginas: ocupa o espaço útil ao lado da sidebar, com teto para monitores ultrawide. */
export const PAGE =
  'w-full max-w-[1680px] mx-auto px-8 pt-7 pb-12 space-y-7';

/** Cartão: superfície sólida com fio e sombra em duas camadas (contato + ambiente). */
export const SURFACE =
  'bg-surface border border-line shadow-card';

export const INPUT =
  'w-full h-11 px-3.5 rounded-xl bg-surface border border-line-strong text-[14px] tracking-tight text-stone-900 dark:text-stone-100 placeholder:text-stone-400 outline-none shadow-[inset_0_1px_2px_rgba(28,25,23,0.035)] transition-[border-color,box-shadow,background-color] duration-150 hover:border-stone-400/70 dark:hover:border-white/25 focus:border-accent/70 focus:shadow-[0_0_0_4px_rgba(181,85,47,0.14)] disabled:opacity-55 disabled:cursor-not-allowed disabled:bg-surface-2';

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 h-9 px-4 rounded-full text-[13px] font-medium tracking-tight whitespace-nowrap transition-all duration-150 active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none';

export const BUTTON = {
  primary: `${BUTTON_BASE} bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 shadow-button hover:bg-stone-800 dark:hover:bg-white`,
  accent: `${BUTTON_BASE} bg-linear-to-b from-[#C4623A] to-accent text-white shadow-accent hover:from-[#B85930] hover:to-accent-hover`,
  ghost: `${BUTTON_BASE} text-stone-600 dark:text-stone-300 hover:bg-stone-900/6 dark:hover:bg-white/8 hover:text-stone-900 dark:hover:text-stone-100`,
  secondary: `${BUTTON_BASE} bg-surface text-stone-800 dark:text-stone-100 border border-line-strong shadow-[0_1px_2px_rgba(28,25,23,0.05)] hover:border-stone-400/80 dark:hover:border-white/25 hover:bg-surface-2`,
  danger: `${BUTTON_BASE} bg-rose-600 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_1px_2px_rgba(159,18,57,0.3),0_8px_18px_-8px_rgba(225,29,72,0.55)] hover:bg-rose-700`,
} as const;

/** Linha de cabeçalho de tabela: rótulos pequenos em caixa alta sobre uma faixa discreta. */
export const TABLE_HEAD =
  'text-[10.5px] uppercase tracking-[0.08em] text-stone-500 dark:text-stone-400 bg-surface-2 border-b border-line';

/** Rótulo de seção em caixa alta (acima de grupos de campos, colunas e resumos). */
export const OVERLINE = 'text-[10.5px] font-semibold uppercase tracking-[0.1em] text-stone-500 dark:text-stone-400';

/* =========================================================================
   Cabeçalho editorial de página
   ========================================================================= */

interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}

/** Título em serifa sobre o fio duplo de fechamento de conta (o "total" do livro contábil). */
export function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps) {
  return (
    <header className="flex items-end justify-between gap-6 pb-5 border-b-[3px] border-double border-line-strong print:border-0 print:pb-0">
      <div className="space-y-2 min-w-0">
        {eyebrow && (
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-accent-ink">
            <span aria-hidden className="w-1.5 h-1.5 rounded-[2px] bg-accent rotate-45 shrink-0" />
            <span className="truncate">{eyebrow}</span>
          </p>
        )}
        <h1 className="font-serif text-[36px] leading-[1.08] font-medium text-stone-900 dark:text-stone-50">
          {title}
        </h1>
        {description && <p className="text-[14px] leading-relaxed text-stone-500 dark:text-stone-400 max-w-2xl">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center justify-end gap-2 print:hidden">{actions}</div>}
    </header>
  );
}

/* =========================================================================
   Cabeçalho de cartão e indicador (número em destaque)
   ========================================================================= */

/** Faixa de título de um cartão: ícone opcional, título, complemento e ações à direita. */
export function CardHeader({
  icon: Icon,
  title,
  meta,
  actions,
  iconClassName = 'text-stone-400',
}: {
  icon?: LucideIcon;
  title: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  iconClassName?: string;
}) {
  return (
    <div className="flex items-center gap-2.5 px-5 h-[52px] border-b border-line">
      {Icon && <Icon className={`w-4 h-4 shrink-0 ${iconClassName}`} strokeWidth={1.9} />}
      <h2 className="text-[14.5px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">{title}</h2>
      {meta && <span className="text-[12px] text-stone-500">{meta}</span>}
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export type StatTone = 'neutral' | 'good' | 'alert' | 'warn' | 'accent';

const STAT_TONE: Record<StatTone, { value: string; chip: string }> = {
  neutral: { value: 'text-stone-900 dark:text-stone-50', chip: 'bg-stone-900/6 text-stone-600 dark:bg-white/8 dark:text-stone-300' },
  good: { value: 'text-emerald-700 dark:text-emerald-400', chip: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400' },
  alert: { value: 'text-rose-600 dark:text-rose-400', chip: 'bg-rose-500/12 text-rose-600 dark:text-rose-400' },
  warn: { value: 'text-amber-700 dark:text-amber-400', chip: 'bg-amber-500/14 text-amber-700 dark:text-amber-400' },
  accent: { value: 'text-accent-ink', chip: 'bg-accent/12 text-accent-ink' },
};

interface StatCardProps {
  label: string;
  value: React.ReactNode;
  caption?: React.ReactNode;
  icon?: LucideIcon;
  tone?: StatTone;
  href?: string;
  /** Percentual (0–100) desenhado como barra fina no pé do cartão. */
  progress?: number;
}

/** Indicador: rótulo, número grande em fonte mono e legenda; vira link quando recebe `href`. */
export function StatCard({ label, value, caption, icon: Icon, tone = 'neutral', href, progress }: StatCardProps) {
  const t = STAT_TONE[tone];
  const body = (
    <div
      className={`${SURFACE} group relative h-full min-w-0 rounded-[20px] px-5 py-4 overflow-hidden transition-all duration-200 ${
        href ? 'hover:-translate-y-0.5 hover:shadow-raised hover:border-line-strong' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[12px] font-medium text-stone-500 dark:text-stone-400 leading-snug">{label}</p>
        {Icon && (
          <span className={`shrink-0 w-8 h-8 -mt-0.5 -mr-1 rounded-[10px] flex items-center justify-center ${t.chip}`}>
            <Icon className="w-4 h-4" strokeWidth={1.9} />
          </span>
        )}
      </div>
      <p className={`mt-2 text-[28px] leading-none font-semibold tracking-tight font-mono tabular-nums ${t.value}`}>{value}</p>
      {caption && (
        <p className="mt-2.5 flex items-center gap-1 text-[11.5px] text-stone-500 dark:text-stone-400">
          <span className="truncate">{caption}</span>
          {href && <ArrowUpRight aria-hidden className="w-3 h-3 shrink-0 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-200" />}
        </p>
      )}
      {progress !== undefined && (
        <div className="mt-3 h-1 rounded-full bg-stone-900/6 dark:bg-white/8 overflow-hidden">
          <div className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out" style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
        </div>
      )}
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-[20px]">
      {body}
    </Link>
  ) : (
    body
  );
}

/* =========================================================================
   Controle segmentado iOS
   ========================================================================= */

interface SegmentedControlProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
  ariaLabel: string;
  disabled?: boolean;
}

/** Trilho dos controles segmentados (levemente afundado na superfície). */
export const SEGMENT_TRACK =
  'relative inline-flex p-[3px] rounded-xl bg-stone-900/[0.055] dark:bg-white/7 shadow-[inset_0_1px_2px_rgba(28,25,23,0.05)]';

/** Destaque deslizante dos controles segmentados (o "relevo" da opção marcada). */
export const SEGMENT_PILL = `${SLIDING_INDICATOR} rounded-[9px] bg-surface dark:bg-stone-700 shadow-[0_1px_2px_rgba(28,25,23,0.1),0_0_0_1px_rgba(28,25,23,0.05)]`;

/** Classes de uma opção de controle segmentado; o fundo da marcada vem do destaque deslizante. */
export const segmentClass = (active: boolean) =>
  `relative z-10 px-3 py-1 rounded-[9px] text-[12px] font-medium tracking-tight transition-[color,transform] duration-150 active:scale-[0.97] ${
    active ? 'text-stone-900 dark:text-white' : 'text-stone-500 hover:text-stone-800 dark:hover:text-stone-200'
  }`;

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  disabled = false,
}: SegmentedControlProps<T>) {
  const { containerRef, indicatorRef } = useSlidingIndicator<HTMLDivElement>(value);
  return (
    <div
      ref={containerRef}
      role="radiogroup"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      className={`${SEGMENT_TRACK} ${disabled ? 'opacity-55 pointer-events-none' : ''}`}
    >
      <span ref={indicatorRef} aria-hidden className={SEGMENT_PILL} />
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            disabled={disabled}
            aria-checked={active}
            data-active={active}
            onClick={() => !disabled && onChange(o.value)}
            className={segmentClass(active)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* =========================================================================
   Busca estilo Spotlight
   ========================================================================= */

interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  inputRef?: React.Ref<HTMLInputElement>;
}

export function SearchField({ value, onChange, placeholder = 'Buscar', className = '', inputRef }: SearchFieldProps) {
  return (
    <div className={`relative ${className}`}>
      <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" strokeWidth={1.9} />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-10 pl-10 pr-9 rounded-xl bg-surface text-[14px] tracking-tight text-stone-900 dark:text-stone-100 placeholder:text-stone-400 outline-none border border-line-strong shadow-[inset_0_1px_2px_rgba(28,25,23,0.035)] transition-all duration-150 hover:border-stone-400/70 dark:hover:border-white/25 focus:border-accent/60 focus:shadow-[0_0_0_4px_rgba(181,85,47,0.12)] [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Limpar busca"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-stone-400/60 text-white flex items-center justify-center hover:bg-stone-500/70"
        >
          <X className="w-3 h-3" strokeWidth={3} />
        </button>
      )}
    </div>
  );
}

/* =========================================================================
   Switch iOS (51×31, knob 27, verde #34C759) sobre checkbox nativo
   ========================================================================= */

export function IOSSwitch({
  checked,
  onChange,
  id,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  id?: string;
}) {
  return (
    <span className="relative inline-flex shrink-0 w-[51px] h-[31px]">
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer absolute inset-0 opacity-0 cursor-pointer z-10"
      />
      <span className="absolute inset-0 rounded-full bg-stone-900/12 dark:bg-stone-700 shadow-[inset_0_1px_2px_rgba(28,25,23,0.08)] transition-colors duration-200 peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent/50 peer-focus-visible:ring-offset-2" />
      <span className="absolute top-[2px] left-[2px] w-[27px] h-[27px] rounded-full bg-white shadow-[0_3px_8px_rgba(0,0,0,0.15),0_1px_1px_rgba(0,0,0,0.06)] transition-transform duration-200 ease-out peer-checked:translate-x-[20px]" />
    </span>
  );
}

/* =========================================================================
   Sheet (modal centralizado ou painel lateral)
   ========================================================================= */

interface SheetProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  side?: 'center' | 'right';
  /** Largura do modal central: padrão (460px) ou largo (920px, para tabelas de conferência). */
  size?: 'md' | 'lg';
}

export function Sheet({ title, subtitle, onClose, children, footer, side = 'center', size = 'md' }: SheetProps) {
  const titleId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const right = side === 'right';

  const dialog = (
    <div
      className={`fixed inset-0 z-50 flex overflow-y-auto ${
        right ? 'items-stretch justify-end p-3' : 'items-center justify-center p-4'
      }`}
    >
      <div className="fixed inset-0 bg-stone-950/35 dark:bg-black/60 backdrop-blur-[3px] animate-fade-in" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`relative w-full flex flex-col overflow-hidden bg-canvas border border-line shadow-overlay ${
          right
            ? 'max-w-[420px] max-h-[calc(100vh-1.5rem)] rounded-[24px] animate-panel-in'
            : `${size === 'lg' ? 'max-w-[920px]' : 'max-w-[460px]'} max-h-[calc(100vh-2rem)] my-auto rounded-[28px] animate-sheet-in`
        }`}
      >
        <div className="shrink-0 flex items-start gap-3 px-6 pt-5 pb-4 bg-surface border-b border-line">
          <div className="flex-1 min-w-0">
            <h2 id={titleId} className="text-[17px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
              {title}
            </h2>
            {subtitle && <p className="mt-1 text-[13px] text-stone-500">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="w-8 h-8 -mr-1.5 -mt-0.5 rounded-full text-stone-500 flex items-center justify-center hover:bg-stone-900/7 dark:hover:bg-white/10 hover:text-stone-900 dark:hover:text-stone-100 active:scale-[0.94] transition-all duration-150"
          >
            <X className="w-4 h-4" strokeWidth={2} />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-6 pt-5 pb-5">{children}</div>
        {footer && <div className="shrink-0 px-6 py-4 bg-surface border-t border-line">{footer}</div>}
      </div>
    </div>
  );

  return <ModalPortal>{dialog}</ModalPortal>;
}

/* =========================================================================
   Campo rotulado
   ========================================================================= */

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-[12px] font-medium text-stone-600 dark:text-stone-400 px-0.5">{label}</span>
      {children}
      {error ? (
        <span className="block text-[12px] text-rose-600 dark:text-rose-400 px-0.5">{error}</span>
      ) : (
        hint && <span className="block text-[12px] text-stone-400 px-0.5">{hint}</span>
      )}
    </label>
  );
}

/* =========================================================================
   Botão com confirmação tátil em dois toques (sem window.confirm)
   ========================================================================= */

interface ConfirmButtonProps {
  onConfirm: () => void | Promise<void>;
  label: React.ReactNode;
  confirmLabel?: string;
  ariaLabel: string;
  className?: string;
}

export function ConfirmButton({
  onConfirm,
  label,
  confirmLabel = 'Confirmar',
  ariaLabel,
  className = '',
}: ConfirmButtonProps) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);

  return (
    <button
      type="button"
      aria-label={armed ? `${confirmLabel}: ${ariaLabel}` : ariaLabel}
      onClick={(e) => {
        e.stopPropagation();
        if (armed) {
          setArmed(false);
          void onConfirm();
        } else {
          setArmed(true);
        }
      }}
      className={`inline-flex items-center justify-center gap-1.5 h-8 rounded-full text-[12px] font-medium transition-all duration-150 active:scale-[0.94] ${
        armed
          ? 'px-3 bg-rose-600 text-white shadow-[0_2px_8px_rgba(225,29,72,0.3)] animate-pop-in'
          : 'w-8 text-stone-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40'
      } ${className}`}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}

/* =========================================================================
   Estado vazio
   ========================================================================= */

export function EmptyState({
  title,
  description,
  action,
  icon: Icon = Inbox,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="relative px-6 py-16 text-center overflow-hidden">
      {/* Pautas de livro contábil ao fundo, esmaecendo para as bordas */}
      <div aria-hidden className="ledger-lines pointer-events-none absolute inset-x-0 top-0 h-[120px] mask-[radial-gradient(ellipse_60%_100%_at_50%_0%,black,transparent)] print:hidden" />
      <div className="relative">
        <span className="mx-auto flex w-14 h-14 items-center justify-center rounded-2xl bg-surface border border-line shadow-card text-accent-ink -rotate-3 print:hidden">
          <Icon className="w-6 h-6 rotate-3" strokeWidth={1.6} />
        </span>
        <p className="mt-5 font-serif text-[21px] leading-snug font-medium text-stone-900 dark:text-stone-100">{title}</p>
        {description && <p className="mt-1.5 mx-auto max-w-md text-[13.5px] leading-relaxed text-stone-500 dark:text-stone-400">{description}</p>}
        {action && <div className="mt-6 flex justify-center">{action}</div>}
      </div>
    </div>
  );
}
