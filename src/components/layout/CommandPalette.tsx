'use client';

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, Check, CornerDownLeft, LogOut, Monitor, Moon, Search, Sun, type LucideIcon } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useClient } from '@/contexts/ClientContext';
import { NAV_SECTIONS } from '@/components/layout/nav';
import { useTheme } from '@/components/ui/useTheme';
import { searchCommands, type CommandEntry } from '@/lib/command-search';
import { THEME_OPTIONS, type ThemePreference } from '@/lib/theme';
import { formatCNPJ } from '@/lib/utils/formatters';
import { ModalPortal } from '@/components/ui/ModalPortal';

/** Atalho exibido nas dicas; no Mac, ⌘K também abre. */
export const SHORTCUT_LABEL = 'Ctrl+K';
const OPEN_EVENT = 'contaflow-command-palette';

/** Abre a busca rápida de qualquer lugar (botão do menu, barra do celular). */
export function openCommandPalette(): void {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

interface Command extends CommandEntry {
  icon: LucideIcon;
  /** Marca o item que já está em uso (empresa ativa, tema escolhido). */
  current?: boolean;
  run: () => void;
}

const THEME_ICON: Record<ThemePreference, LucideIcon> = { light: Sun, dark: Moon, system: Monitor };

/**
 * Busca rápida (Ctrl+K ou ⌘K): pular para uma tela, trocar a empresa ativa ou o tema, sair.
 * Setas navegam, Enter abre, Esc fecha.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  // Montado só enquanto aberto: a busca recomeça vazia a cada abertura.
  return open ? <PaletteDialog onClose={() => setOpen(false)} /> : null;
}

function PaletteDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { signOut } = useAuth();
  const { clients, currentClient, selectClient } = useClient();
  const [theme, setTheme] = useTheme();
  const [query, setQuery] = useState('');
  const [rawActive, setActive] = useState(0);
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);

  const commands = useMemo<Command[]>(() => {
    const companies: Command[] = clients
      .filter((c) => !c.deletingAt)
      .map((c) => ({
        id: `client-${c.id}`,
        group: 'Empresas',
        label: c.tradeName || c.name,
        hint: [c.tradeName && c.tradeName !== c.name ? c.name : null, c.cnpj ? formatCNPJ(c.cnpj) : null].filter(Boolean).join(' · '),
        icon: Building2,
        current: c.id === currentClient?.id,
        run: () => selectClient(c),
      }));
    const pages: Command[] = NAV_SECTIONS.flatMap((s) =>
      s.items.map((item) => ({
        id: `page-${item.href}`,
        group: 'Telas' as const,
        label: item.label,
        hint: s.title,
        keywords: item.keywords,
        icon: item.icon,
        run: () => router.push(item.href),
      }))
    );
    const actions: Command[] = [
      ...THEME_OPTIONS.map((o) => ({
        id: `theme-${o.value}`,
        group: 'Ações' as const,
        label: `Tema: ${o.label}`,
        keywords: o.value === 'dark' ? 'modo escuro noturno dark' : o.value === 'light' ? 'modo claro light' : 'automatico windows sistema',
        icon: THEME_ICON[o.value],
        current: theme === o.value,
        run: () => setTheme(o.value),
      })),
      { id: 'sign-out', group: 'Ações', label: 'Sair', keywords: 'logout desconectar encerrar sessao', icon: LogOut, run: () => void signOut() },
    ];
    return [...companies, ...pages, ...actions];
  }, [clients, currentClient?.id, selectClient, router, theme, setTheme, signOut]);

  const results = useMemo(() => searchCommands(query, commands), [query, commands]);
  const active = Math.min(rawActive, Math.max(0, results.length - 1));

  // Trava a rolagem da página e devolve o foco a quem abriu.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
      previous?.focus?.();
    };
  }, []);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, results]);

  const run = (cmd: Command | undefined) => {
    if (!cmd) return;
    onClose();
    cmd.run();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Nenhuma tecla daqui chega aos atalhos da tela por baixo (ex.: os da Conciliação).
    e.stopPropagation();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (results.length === 0) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((active + step + results.length) % results.length);
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      setActive(e.key === 'Home' ? 0 : results.length - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(results[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  const optionId = (i: number) => `${listId}-${i}`;

  const palette = (
    <div className="fixed inset-0 z-[70] flex items-start justify-center px-4 pt-[12vh] print:hidden" role="presentation">
      <div className="absolute inset-0 bg-stone-900/25 dark:bg-black/50 backdrop-blur-sm animate-fade-in" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Busca rápida"
        className="relative w-full max-w-[560px] rounded-[20px] bg-white dark:bg-stone-900 border border-black/[0.08] dark:border-white/[0.10] shadow-[0_24px_64px_rgba(0,0,0,0.22)] overflow-hidden animate-pop-in"
      >
        <div className="flex items-center gap-3 px-4 h-14 border-b border-black/[0.06] dark:border-white/[0.08]">
          <Search className="w-[18px] h-[18px] text-stone-400 shrink-0" strokeWidth={1.75} />
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={results.length ? optionId(active) : undefined}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Buscar telas, empresas e ações…"
            className="flex-1 min-w-0 bg-transparent text-[15px] tracking-tight text-stone-900 dark:text-stone-100 placeholder:text-stone-400 outline-none"
          />
          <kbd className="inline-flex h-6 px-1.5 items-center rounded-md border border-black/[0.08] dark:border-white/[0.12] bg-black/[0.03] dark:bg-white/[0.06] font-mono text-[10.5px] text-stone-500">Esc</kbd>
        </div>

        <ul ref={listRef} id={listId} role="listbox" aria-label="Resultados" className="max-h-[min(60vh,420px)] overflow-y-auto overscroll-contain p-2">
          {results.length === 0 && (
            <li role="presentation" className="px-3 py-8 text-center text-[13px] text-stone-500">
              Nada encontrado para “{query.trim()}”.
            </li>
          )}
          {results.map((cmd, i) => {
            const Icon = cmd.icon;
            const selected = i === active;
            const header = i === 0 || results[i - 1].group !== cmd.group;
            return (
              <React.Fragment key={cmd.id}>
                {header && (
                  <li role="presentation" className={`px-3 pb-1 text-[10.5px] font-medium uppercase tracking-[0.08em] text-stone-400 ${i === 0 ? 'pt-1' : 'pt-3'}`}>
                    {cmd.group}
                  </li>
                )}
                <li
                  id={optionId(i)}
                  role="option"
                  aria-selected={selected}
                  onMouseMove={() => !selected && setActive(i)}
                  onClick={() => run(cmd)}
                  className={`flex items-center gap-3 px-3 h-10 rounded-xl cursor-pointer select-none transition-colors duration-100 ${
                    selected ? 'bg-black/[0.05] dark:bg-white/[0.08]' : ''
                  }`}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${selected ? 'text-accent-ink' : 'text-stone-400'}`} strokeWidth={1.75} />
                  <span className="min-w-0 flex-1 flex items-baseline gap-2">
                    <span className="truncate text-[14px] tracking-tight text-stone-900 dark:text-stone-100">{cmd.label}</span>
                    {cmd.hint && <span className="truncate text-[12px] text-stone-400">{cmd.hint}</span>}
                  </span>
                  {cmd.current && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-stone-500">
                      <Check className="w-3.5 h-3.5 text-accent-ink" /> Atual
                    </span>
                  )}
                  {selected && !cmd.current && <CornerDownLeft className="w-3.5 h-3.5 text-stone-400 shrink-0" aria-hidden />}
                </li>
              </React.Fragment>
            );
          })}
        </ul>

        <div className="flex items-center gap-4 px-4 h-9 border-t border-black/[0.06] dark:border-white/[0.08] text-[11px] text-stone-400">
          <span>↑↓ navegar</span>
          <span>Enter abrir</span>
          <span>Esc fechar</span>
          <span className="ml-auto">{SHORTCUT_LABEL} em qualquer tela</span>
        </div>
      </div>
    </div>
  );

  return <ModalPortal>{palette}</ModalPortal>;
}
