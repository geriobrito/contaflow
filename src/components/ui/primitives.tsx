'use client';

import React, { useEffect, useId, useState } from 'react';
import { Search, X } from 'lucide-react';

/* =========================================================================
   Tokens de superfície e controles
   ========================================================================= */

/** Container fluido das páginas: ocupa o espaço útil ao lado da sidebar, com teto para monitores ultrawide. */
export const PAGE =
  'w-full max-w-[1680px] mx-auto px-4 sm:px-6 md:px-10 lg:px-12 py-8 sm:py-10 space-y-8';

export const SURFACE =
  'backdrop-blur-xl bg-white/70 dark:bg-stone-900/60 border border-black/[0.06] dark:border-white/[0.08] shadow-[0_2px_12px_rgba(0,0,0,0.04)]';

export const INPUT =
  'w-full h-11 px-3.5 rounded-xl bg-white/80 dark:bg-stone-800/70 border border-black/[0.08] dark:border-white/[0.10] text-[14px] tracking-tight text-stone-900 dark:text-stone-100 placeholder:text-stone-400 outline-none transition-all duration-150 hover:border-black/[0.14] focus:border-[#0071E3]/60 focus:bg-white dark:focus:bg-stone-800 focus:shadow-[0_0_0_4px_rgba(0,113,227,0.12)]';

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 h-9 px-4 rounded-full text-[13px] font-medium tracking-tight transition-all duration-150 active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none';

export const BUTTON = {
  primary: `${BUTTON_BASE} bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 hover:bg-stone-800 dark:hover:bg-white`,
  accent: `${BUTTON_BASE} bg-[#0071E3] text-white hover:bg-[#0077ED] shadow-[0_4px_14px_rgba(0,113,227,0.22)]`,
  ghost: `${BUTTON_BASE} text-stone-600 dark:text-stone-300 hover:bg-black/[0.05] dark:hover:bg-white/[0.08]`,
  secondary: `${BUTTON_BASE} bg-white/80 dark:bg-stone-800 text-stone-800 dark:text-stone-100 border border-black/[0.08] dark:border-white/[0.10] hover:bg-white`,
} as const;

/* =========================================================================
   Cabeçalho editorial de página
   ========================================================================= */

interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}

export function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
      <div className="space-y-1.5 min-w-0">
        {eyebrow && <p className="text-[13px] font-medium text-stone-500 truncate">{eyebrow}</p>}
        <h1 className="text-[28px] sm:text-[32px] font-semibold tracking-tight text-stone-900 dark:text-stone-50">
          {title}
        </h1>
        {description && <p className="text-[14px] text-stone-500 max-w-2xl">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 print:hidden">{actions}</div>}
    </header>
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
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: SegmentedControlProps<T>) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex p-0.5 rounded-xl bg-black/[0.05] dark:bg-white/[0.06]">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={`px-3 py-1 rounded-[10px] text-[12px] font-medium tracking-tight transition-all duration-150 active:scale-[0.97] ${
              active
                ? 'bg-white dark:bg-stone-700 text-stone-900 dark:text-white shadow-[0_1px_3px_rgba(0,0,0,0.08)]'
                : 'text-stone-500 hover:text-stone-800 dark:hover:text-stone-200'
            }`}
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
}

export function SearchField({ value, onChange, placeholder = 'Buscar', className = '' }: SearchFieldProps) {
  return (
    <div className={`relative ${className}`}>
      <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-10 pl-10 pr-9 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] text-[14px] tracking-tight text-stone-900 dark:text-stone-100 placeholder:text-stone-400 outline-none border border-transparent transition-all duration-150 focus:bg-white dark:focus:bg-stone-800 focus:border-black/[0.08] focus:shadow-[0_0_0_4px_rgba(0,113,227,0.10)] [&::-webkit-search-cancel-button]:hidden"
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
      <span className="absolute inset-0 rounded-full bg-[#E9E9EA] dark:bg-stone-700 transition-colors duration-200 peer-checked:bg-[#34C759] peer-focus-visible:ring-2 peer-focus-visible:ring-[#0071E3]/50 peer-focus-visible:ring-offset-2" />
      <span className="absolute top-[2px] left-[2px] w-[27px] h-[27px] rounded-full bg-white shadow-[0_3px_8px_rgba(0,0,0,0.15),0_1px_1px_rgba(0,0,0,0.06)] transition-transform duration-200 ease-out peer-checked:translate-x-[20px]" />
    </span>
  );
}

/* =========================================================================
   Sheet (modal centralizado / bottom sheet no mobile, ou painel lateral)
   ========================================================================= */

interface SheetProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  side?: 'center' | 'right';
}

export function Sheet({ title, subtitle, onClose, children, footer, side = 'center' }: SheetProps) {
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

  return (
    <div
      className={`fixed inset-0 z-50 flex ${
        right ? 'items-end sm:items-stretch justify-center sm:justify-end sm:p-3' : 'items-end sm:items-center justify-center sm:p-6'
      }`}
    >
      <div className="absolute inset-0 bg-stone-900/25 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`relative w-full flex flex-col bg-[#F9F9F8]/95 dark:bg-stone-900/95 backdrop-blur-2xl border border-black/[0.06] dark:border-white/[0.08] shadow-[0_24px_64px_rgba(0,0,0,0.18)] rounded-t-[28px] max-h-[92vh] ${
          right
            ? 'sm:max-w-[420px] sm:rounded-[24px] sm:max-h-none animate-sheet-in sm:animate-panel-in'
            : 'sm:max-w-[460px] sm:rounded-[28px] animate-sheet-in'
        }`}
      >
        <div className="sm:hidden flex justify-center pt-2">
          <span className="w-9 h-[5px] rounded-full bg-black/15 dark:bg-white/20" />
        </div>
        <div className="flex items-start gap-3 px-6 pt-5 pb-4">
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
            className="w-7 h-7 rounded-full bg-black/[0.05] dark:bg-white/[0.08] text-stone-500 flex items-center justify-center hover:bg-black/[0.08] active:scale-[0.94] transition-all duration-150"
          >
            <X className="w-3.5 h-3.5" strokeWidth={2.25} />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-6 pb-2">{children}</div>
        {footer && <div className="px-6 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>
  );
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
      <span className="block text-[12px] font-medium text-stone-500 px-0.5">{label}</span>
      {children}
      {error ? (
        <span className="block text-[12px] text-rose-600 px-0.5">{error}</span>
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

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="px-6 py-16 text-center">
      <p className="text-[15px] font-medium tracking-tight text-stone-800 dark:text-stone-200">{title}</p>
      {description && <p className="mt-1 text-[13px] text-stone-500">{description}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}
