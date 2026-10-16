'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Check, ChevronsUpDown, LogOut, Monitor, Moon, PanelLeftClose, PanelLeftOpen, Search, Sparkles, Sun, type LucideIcon } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useClient } from '@/contexts/ClientContext';
import { isFirebaseConfigured } from '@/lib/firebase';
import { APP_VERSION, versionDetail, versionShort } from '@/lib/app-version';
import { SLIDING_INDICATOR, useSlidingIndicator } from '@/components/ui/useSlidingIndicator';
import { useTheme } from '@/components/ui/useTheme';
import { NAV_SECTIONS, activeNavHref } from '@/components/layout/nav';
import { openCommandPalette, SHORTCUT_LABEL } from '@/components/layout/CommandPalette';
import { THEME_OPTIONS, nextPreference, type ThemePreference } from '@/lib/theme';

const THEME_ICON: Record<ThemePreference, LucideIcon> = { light: Sun, dark: Moon, system: Monitor };

/** Seletor de tema (Claro, Escuro, Sistema); no menu recolhido, um botão que alterna entre os três. */
function ThemeSwitcher({ collapsed }: { collapsed: boolean }) {
  const [pref, setPref] = useTheme();
  const { containerRef, indicatorRef } = useSlidingIndicator<HTMLDivElement>(pref);
  const label = (p: ThemePreference) => `Tema: ${THEME_OPTIONS.find((o) => o.value === p)!.label}`;
  if (collapsed) {
    const Icon = THEME_ICON[pref];
    return (
      <button
        type="button"
        onClick={() => setPref(nextPreference(pref))}
        title={`${label(pref)} (clique para trocar)`}
        aria-label={`${label(pref)}. Trocar tema`}
        className="mx-auto flex w-8 h-8 items-center justify-center rounded-lg text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition-all duration-150 active:scale-[0.94]"
      >
        <Icon className="w-4 h-4" strokeWidth={1.75} />
      </button>
    );
  }
  return (
    <div className="flex items-center justify-between gap-2 px-2.5">
      <span className="text-[11px] text-stone-500">Tema</span>
      <div ref={containerRef} role="radiogroup" aria-label="Tema" className="relative inline-flex p-0.5 rounded-lg bg-black/[0.05] dark:bg-white/[0.06]">
        <span ref={indicatorRef} aria-hidden className={`${SLIDING_INDICATOR} rounded-md bg-white dark:bg-stone-700 shadow-[0_1px_2px_rgba(0,0,0,0.08)]`} />
        {THEME_OPTIONS.map((o) => {
          const Icon = THEME_ICON[o.value];
          const active = o.value === pref;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={o.label}
              title={o.label}
              data-active={active}
              onClick={() => setPref(o.value)}
              className={`relative z-10 w-7 h-6 flex items-center justify-center rounded-md transition-colors duration-150 ${
                active ? 'text-stone-900 dark:text-white' : 'text-stone-400 hover:text-stone-700 dark:hover:text-stone-200'
              }`}
            >
              <Icon className="w-3.5 h-3.5" strokeWidth={1.9} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

const COLLAPSE_KEY = 'contaflow_sidebar_collapsed';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

/* =========================================================================
   Seletor de cliente ativo (dropdown minimalista)
   ========================================================================= */

function ClientSwitcher({ collapsed }: { collapsed: boolean }) {
  const { clients: allClients, currentClient, selectClient } = useClient();
  // Empresas com exclusão incompleta só aparecem na tela de Clientes (para retomar).
  const clients = allClients.filter((c) => !c.deletingAt);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const label = currentClient?.tradeName || currentClient?.name || 'Nenhum cliente';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={collapsed ? label : undefined}
        className={`w-full flex items-center gap-3 rounded-2xl p-2 text-left transition-all duration-150 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] active:scale-[0.98] ${
          collapsed ? 'justify-center' : ''
        }`}
      >
        <span className="w-8 h-8 shrink-0 rounded-xl bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 flex items-center justify-center text-[11px] font-semibold tracking-tight">
          {currentClient ? initials(label) : '—'}
        </span>
        {!collapsed && (
          <>
            <span className="flex-1 min-w-0">
              <span className="block text-[11px] text-stone-400">Cliente ativo</span>
              <span className="block text-[13px] font-medium tracking-tight text-stone-900 dark:text-stone-100 truncate">
                {label}
              </span>
            </span>
            <ChevronsUpDown className="w-3.5 h-3.5 text-stone-400 shrink-0" />
          </>
        )}
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute z-50 left-0 top-full mt-1.5 w-64 max-h-72 overflow-y-auto overscroll-contain rounded-2xl p-1.5 backdrop-blur-xl bg-white/90 dark:bg-stone-900/90 border border-black/[0.06] dark:border-white/[0.08] shadow-[0_8px_32px_rgba(0,0,0,0.10)] animate-pop-in"
        >
          {clients.length === 0 && (
            <li className="px-3 py-2 text-xs text-stone-400">Nenhum cliente cadastrado</li>
          )}
          {clients.map((c) => {
            const active = c.id === currentClient?.id;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    selectClient(c);
                    setOpen(false);
                  }}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors"
                >
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] tracking-tight text-stone-900 dark:text-stone-100 truncate">
                      {c.tradeName || c.name}
                    </span>
                    <span className="block text-[11px] font-mono tabular-nums text-stone-400">{c.cnpj}</span>
                  </span>
                  {active && <Check className="w-3.5 h-3.5 text-accent-ink shrink-0" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* =========================================================================
   Conteúdo da sidebar
   ========================================================================= */

interface SidebarBodyProps {
  collapsed: boolean;
  headerAction?: React.ReactNode;
}

function SidebarBody({ collapsed, headerAction }: SidebarBodyProps) {
  const pathname = usePathname();
  const { user, signOut } = useAuth();
  const connected = isFirebaseConfigured();
  const displayName = user?.displayName || user?.email?.split('@')[0] || 'Usuário';
  const activeHref = activeNavHref(pathname);
  const { containerRef: navRef, indicatorRef: navPillRef } = useSlidingIndicator<HTMLElement>(activeHref);

  return (
    <div className="flex flex-col h-full">
      {/* Marca */}
      <div className={`flex items-center h-14 px-3 ${collapsed ? 'justify-center' : 'justify-between'}`}>
        {!collapsed && (
          <Link href="/" className="flex items-center gap-2 px-1">
            <span className="w-6 h-6 rounded-lg bg-gradient-to-br from-[#D97757] to-[#C15F3C] flex items-center justify-center">
              <Sparkles className="w-3.5 h-3.5 text-white" />
            </span>
            <span className="text-[15px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
              ContaFlow
            </span>
          </Link>
        )}
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={openCommandPalette}
            title={`Buscar telas e empresas (${SHORTCUT_LABEL})`}
            aria-label={`Buscar telas e empresas (${SHORTCUT_LABEL})`}
            aria-keyshortcuts="Control+K Meta+K"
            className="p-1.5 rounded-lg text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition-all duration-150 active:scale-[0.94]"
          >
            <Search className="w-4 h-4" strokeWidth={1.75} />
          </button>
          {headerAction}
        </div>
      </div>

      <div className="px-2">
        <ClientSwitcher collapsed={collapsed} />
      </div>

      <div className="mx-4 my-2 border-t border-black/[0.05] dark:border-white/[0.06]" />

      {/* Navegação: o destaque da página atual desliza até a próxima, entre as seções também */}
      <nav ref={navRef} className="relative flex-1 px-2 pb-2 overflow-y-auto">
        <span
          ref={navPillRef}
          aria-hidden
          className={`${SLIDING_INDICATOR} rounded-xl bg-white dark:bg-white/[0.08] shadow-[0_1px_3px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.04] dark:ring-white/[0.06]`}
        />
        {NAV_SECTIONS.map((section, s) => (
          <div key={section.title} role="group" aria-label={section.title} className="space-y-px">
            {collapsed ? (
              s > 0 && <div aria-hidden className="mx-3 my-2 border-t border-black/[0.06] dark:border-white/[0.08]" />
            ) : (
              <p className={`px-2.5 pb-1 text-[10.5px] font-medium uppercase tracking-[0.08em] text-stone-400 dark:text-stone-500 ${s > 0 ? 'pt-3' : 'pt-0.5'}`}>
                {section.title}
              </p>
            )}
            {section.items.map(({ href, label, icon: Icon }) => {
              const active = href === activeHref;
              return (
                <Link
                  key={href}
                  href={href}
                  title={collapsed ? label : undefined}
                  aria-current={active ? 'page' : undefined}
                  data-active={active}
                  className={`relative z-10 flex items-center gap-3 rounded-xl px-2.5 py-[5px] text-[13px] tracking-tight transition-[color,background-color,transform] duration-150 active:scale-[0.98] ${
                    collapsed ? 'justify-center' : ''
                  } ${
                    active
                      ? 'text-stone-900 dark:text-white font-medium'
                      : 'text-stone-600 dark:text-stone-400 hover:bg-black/[0.04] dark:hover:bg-white/[0.05] hover:text-stone-900 dark:hover:text-stone-100'
                  }`}
                >
                  <Icon className={`w-[17px] h-[17px] shrink-0 ${active ? 'text-accent-ink' : ''}`} strokeWidth={1.75} />
                  {!collapsed && <span className="truncate">{label}</span>}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Rodapé: tema, conexão e versão, usuário */}
      <div className="p-2 space-y-1 border-t border-black/[0.05] dark:border-white/[0.06]">
        <div className="pt-1">
          <ThemeSwitcher collapsed={collapsed} />
        </div>
        <div className={`flex items-center gap-2 px-2.5 py-1.5 text-[11px] text-stone-500 ${collapsed ? 'justify-center' : ''}`}>
          <span className="relative flex w-2 h-2 shrink-0" title={connected ? 'Conectado ao Firestore' : 'Modo local (sem Firebase)'}>
            <span className={`absolute inset-0 rounded-full ${connected ? 'bg-emerald-500 animate-ping opacity-40' : ''}`} />
            <span className={`relative w-2 h-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-amber-400'}`} />
          </span>
          {!collapsed && (
            <>
              <span className="shrink-0">{connected ? 'Firestore conectado' : 'Modo local'}</span>
              <span className="ml-auto min-w-0 text-[10.5px] text-stone-400 font-mono tabular-nums truncate" title={versionDetail(APP_VERSION)}>
                {APP_VERSION.commitUrl ? (
                  <a href={APP_VERSION.commitUrl} target="_blank" rel="noopener noreferrer" className="hover:text-stone-700 dark:hover:text-stone-200 hover:underline">
                    {versionShort(APP_VERSION)}
                  </a>
                ) : (
                  versionShort(APP_VERSION)
                )}
              </span>
            </>
          )}
        </div>

        <div className={`flex items-center gap-2.5 rounded-xl px-2 py-2 ${collapsed ? 'flex-col' : ''}`}>
          <span className="w-7 h-7 shrink-0 rounded-full bg-stone-200 dark:bg-stone-700 text-stone-700 dark:text-stone-200 flex items-center justify-center text-[11px] font-semibold">
            {initials(displayName)}
          </span>
          {!collapsed && (
            <span className="flex-1 min-w-0">
              <span className="block text-[13px] font-medium tracking-tight text-stone-900 dark:text-stone-100 truncate">
                {displayName}
              </span>
              <span className="block text-[11px] text-stone-400 truncate">{user?.email}</span>
            </span>
          )}
          <button
            type="button"
            onClick={() => void signOut()}
            title="Sair"
            aria-label="Sair"
            className="p-1.5 rounded-lg text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition-all duration-150 active:scale-[0.94]"
          >
            <LogOut className="w-4 h-4" strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* =========================================================================
   Sidebar (fixa/colapsável)
   ========================================================================= */

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);

  // Restaura preferência de colapso (fora do corpo síncrono do effect).
  useEffect(() => {
    let stored = false;
    try {
      stored = localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
      /* armazenamento indisponível */
    }
    if (stored) queueMicrotask(() => setCollapsed(true));
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, prev ? '0' : '1');
      } catch {
        /* armazenamento indisponível */
      }
      return !prev;
    });
  };

  return (
    <aside
      className={`block print:hidden sticky top-0 h-screen shrink-0 p-3 transition-[width] duration-200 ease-out ${
        collapsed ? 'w-[84px]' : 'w-[272px]'
      }`}
    >
      <div className="h-full rounded-[22px] backdrop-blur-xl bg-white/60 dark:bg-stone-900/60 border border-black/[0.06] dark:border-white/[0.08] shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
        <SidebarBody
          collapsed={collapsed}
          headerAction={
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label={collapsed ? 'Expandir barra lateral' : 'Recolher barra lateral'}
              className="p-1.5 rounded-lg text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition-all duration-150 active:scale-[0.94]"
            >
              {collapsed ? (
                <PanelLeftOpen className="w-4 h-4" strokeWidth={1.75} />
              ) : (
                <PanelLeftClose className="w-4 h-4" strokeWidth={1.75} />
              )}
            </button>
          }
        />
      </div>
    </aside>
  );
}

export default Sidebar;
