'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Check, ChevronsUpDown, LogOut, Monitor, Moon, PanelLeftClose, PanelLeftOpen, Search, Sun, type LucideIcon } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useClient } from '@/contexts/ClientContext';
import { isFirebaseConfigured } from '@/lib/firebase';
import { APP_VERSION, versionDetail, versionShort } from '@/lib/app-version';
import { SLIDING_INDICATOR, useSlidingIndicator } from '@/components/ui/useSlidingIndicator';
import { useTheme } from '@/components/ui/useTheme';
import { BrandMark } from '@/components/ui/BrandMark';
import { NAV_SECTIONS, activeNavHref } from '@/components/layout/nav';
import { openCommandPalette, SHORTCUT_LABEL } from '@/components/layout/CommandPalette';
import { THEME_OPTIONS, nextPreference, type ThemePreference } from '@/lib/theme';
import { useUnreadClientResponses } from '@/hooks/pendencias/useUnreadClientResponses';

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
        className="mx-auto flex w-8 h-8 items-center justify-center rounded-lg text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-black/5 dark:hover:bg-white/8 transition-all duration-150 active:scale-[0.94]"
      >
        <Icon className="w-4 h-4" strokeWidth={1.75} />
      </button>
    );
  }
  return (
    <div ref={containerRef} role="radiogroup" aria-label="Tema" className="relative inline-flex shrink-0 p-0.5 rounded-lg bg-stone-900/6 dark:bg-white/7 shadow-[inset_0_1px_2px_rgba(28,25,23,0.05)]">
        <span ref={indicatorRef} aria-hidden className={`${SLIDING_INDICATOR} rounded-md bg-surface dark:bg-stone-700 shadow-[0_1px_2px_rgba(28,25,23,0.12)]`} />
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
              className={`relative z-10 w-[26px] h-[22px] flex items-center justify-center rounded-md transition-colors duration-150 ${
                active ? 'text-stone-900 dark:text-white' : 'text-stone-400 hover:text-stone-700 dark:hover:text-stone-200'
              }`}
            >
              <Icon className="w-3.5 h-3.5" strokeWidth={1.9} />
            </button>
          );
        })}
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

function ClientSwitcher({
  collapsed,
  unreadByClient,
  totalOtherClientsUnread,
}: {
  collapsed: boolean;
  unreadByClient: ReadonlyMap<string, number>;
  totalOtherClientsUnread: number;
}) {
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
  const otherUnreadHint =
    totalOtherClientsUnread > 0
      ? ` · ${totalOtherClientsUnread} resposta(s) nova(s) em outra(s) empresa(s)`
      : '';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={collapsed ? `${label}${otherUnreadHint}` : otherUnreadHint ? otherUnreadHint.slice(3) : undefined}
        className={`w-full flex items-center gap-2.5 rounded-[14px] text-left transition-all duration-150 active:scale-[0.98] ${
          collapsed
            ? 'justify-center p-1.5 hover:bg-stone-900/5 dark:hover:bg-white/6'
            : 'p-2 bg-surface-2 border border-line hover:border-line-strong hover:shadow-[0_2px_8px_-2px_rgba(28,25,23,0.1)]'
        }`}
      >
        <span className="relative w-8 h-8 shrink-0 rounded-[10px] bg-linear-to-b from-stone-700 to-stone-900 dark:from-stone-100 dark:to-stone-300 text-white dark:text-stone-900 flex items-center justify-center text-[11px] font-semibold tracking-tight shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_1px_2px_rgba(28,25,23,0.25)]">
          {currentClient ? initials(label) : '—'}
          {totalOtherClientsUnread > 0 && (
            <span
              aria-hidden
              className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-stone-900"
            />
          )}
        </span>
        {!collapsed && (
          <>
            <span className="flex-1 min-w-0">
              <span className="block text-[10px] font-semibold uppercase tracking-[0.09em] text-stone-400">
                Cliente ativo
                {totalOtherClientsUnread > 0 && (
                  <span className="ml-1.5 normal-case tracking-normal text-emerald-600 dark:text-emerald-400 font-medium">
                    · +{totalOtherClientsUnread} resp.
                  </span>
                )}
              </span>
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
          className="absolute z-50 left-0 top-full mt-1.5 w-64 max-h-72 overflow-y-auto overscroll-contain rounded-2xl p-1.5 bg-surface border border-line-strong shadow-raised animate-pop-in"
        >
          {clients.length === 0 && (
            <li className="px-3 py-2 text-xs text-stone-400">Nenhum cliente cadastrado</li>
          )}
          {clients.map((c) => {
            const active = c.id === currentClient?.id;
            const unread = unreadByClient.get(c.id) ?? 0;
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
                  className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left transition-colors ${active ? 'bg-accent/8' : 'hover:bg-stone-900/5 dark:hover:bg-white/6'}`}
                >
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] tracking-tight text-stone-900 dark:text-stone-100 truncate">
                      {c.tradeName || c.name}
                    </span>
                    <span className="block text-[11px] font-mono tabular-nums text-stone-400">{c.cnpj}</span>
                  </span>
                  {unread > 0 && (
                    <span
                      title={`${unread} resposta(s) nova(s) do cliente`}
                      className="px-1.5 py-0.5 min-w-[18px] text-center rounded-full bg-emerald-600 text-white font-mono tabular-nums text-[10px] font-semibold leading-none shrink-0"
                    >
                      {unread}
                    </span>
                  )}
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
  const { currentClient } = useClient();
  const { currentUnreadCount, unreadByClient, totalOtherClientsUnread } = useUnreadClientResponses(currentClient?.id);
  const connected = isFirebaseConfigured();
  const displayName = user?.displayName || user?.email?.split('@')[0] || 'Usuário';
  const activeHref = activeNavHref(pathname);
  const { containerRef: navRef, indicatorRef: navPillRef } = useSlidingIndicator<HTMLElement>(activeHref);

  const iconButton =
    'p-1.5 rounded-lg text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-stone-900/6 dark:hover:bg-white/8 transition-all duration-150 active:scale-[0.94]';

  return (
    <div className="flex flex-col h-full">
      {/* Marca */}
      <div className={`flex items-center h-14 px-3 ${collapsed ? 'justify-center' : 'justify-between'}`}>
        {!collapsed && (
          <Link href="/" className="flex items-center gap-2.5 px-1 rounded-lg">
            <BrandMark size="sm" />
            <span className="text-[15.5px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
              Conta<span className="text-accent-ink">Flow</span>
            </span>
          </Link>
        )}
        {headerAction}
      </div>

      <div className="px-2.5 space-y-2">
        <ClientSwitcher
          collapsed={collapsed}
          unreadByClient={unreadByClient}
          totalOtherClientsUnread={totalOtherClientsUnread}
        />

        {/* Busca rápida: parece um campo, abre a paleta de comandos */}
        <button
          type="button"
          onClick={openCommandPalette}
          title={`Buscar telas e empresas (${SHORTCUT_LABEL})`}
          aria-label={`Buscar telas e empresas (${SHORTCUT_LABEL})`}
          aria-keyshortcuts="Control+K Meta+K"
          className={
            collapsed
              ? `mx-auto flex ${iconButton}`
              : 'w-full flex items-center gap-2 h-8 pl-2.5 pr-1.5 rounded-[10px] bg-stone-900/[0.045] dark:bg-white/6 text-[12.5px] text-stone-400 hover:bg-stone-900/[0.07] dark:hover:bg-white/9 hover:text-stone-600 dark:hover:text-stone-200 transition-colors duration-150'
          }
        >
          <Search className={collapsed ? 'w-4 h-4' : 'w-3.5 h-3.5 shrink-0'} strokeWidth={1.9} />
          {!collapsed && (
            <>
              <span className="flex-1 text-left">Buscar…</span>
              <kbd className="inline-flex h-5 px-1.5 items-center rounded-[6px] bg-surface border border-line font-mono text-[10px] text-stone-500 shadow-[0_1px_0_rgba(28,25,23,0.06)]">
                {SHORTCUT_LABEL}
              </kbd>
            </>
          )}
        </button>
      </div>

      {/* Navegação: o destaque da página atual desliza até a próxima, entre as seções também */}
      <nav ref={navRef} className="relative flex-1 mt-2 px-2.5 pb-2 overflow-y-auto">
        <span
          ref={navPillRef}
          aria-hidden
          className={`${SLIDING_INDICATOR} rounded-[10px] bg-accent/[0.09] dark:bg-accent/[0.16] ring-1 ring-inset ring-accent/15 before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-3.5 before:w-[3px] before:rounded-r-full before:bg-accent`}
        />
        {NAV_SECTIONS.map((section, s) => (
          <div key={section.title} role="group" aria-label={section.title} className="space-y-px">
            {collapsed ? (
              s > 0 && <div aria-hidden className="mx-3 my-1.5 border-t border-line" />
            ) : (
              <p className={`flex items-center gap-2 px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-stone-400 dark:text-stone-500 ${s > 0 ? 'pt-2.5' : 'pt-1'}`}>
                {section.title}
                <span aria-hidden className="flex-1 border-t border-line" />
              </p>
            )}
            {section.items.map(({ href, label, icon: Icon }) => {
              const active = href === activeHref;
              const unreadBadge = href === '/pendencias' ? currentUnreadCount : 0;
              return (
                <Link
                  key={href}
                  href={href}
                  title={
                    collapsed
                      ? unreadBadge > 0
                        ? `${label} (${unreadBadge} nova${unreadBadge > 1 ? 's' : ''})`
                        : label
                      : undefined
                  }
                  aria-current={active ? 'page' : undefined}
                  data-active={active}
                  className={`group relative z-10 flex items-center gap-2.5 rounded-[10px] px-2.5 py-[2.5px] text-[13px] tracking-tight transition-[color,background-color,transform] duration-150 active:scale-[0.98] ${
                    collapsed ? 'justify-center' : ''
                  } ${
                    active
                      ? 'text-stone-900 dark:text-white font-medium'
                      : 'text-stone-600 dark:text-stone-400 hover:bg-stone-900/[0.045] dark:hover:bg-white/5 hover:text-stone-900 dark:hover:text-stone-100'
                  }`}
                >
                  <Icon
                    className={`w-[16px] h-[16px] shrink-0 transition-colors duration-150 ${active ? 'text-accent-ink' : 'text-stone-400 group-hover:text-stone-600 dark:group-hover:text-stone-200'}`}
                    strokeWidth={active ? 2 : 1.75}
                  />
                  {!collapsed && <span className="truncate flex-1">{label}</span>}
                  {!collapsed && unreadBadge > 0 && (
                    <span
                      aria-label={`${unreadBadge} resposta(s) nova(s) não lida(s)`}
                      className="ml-auto px-1.5 py-0.5 min-w-[18px] text-center rounded-full bg-emerald-600 text-white font-mono tabular-nums text-[10.5px] font-semibold leading-none"
                    >
                      {unreadBadge}
                    </span>
                  )}
                  {collapsed && unreadBadge > 0 && (
                    <span
                      aria-hidden
                      className="absolute top-1 right-1.5 w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-stone-900"
                    />
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Rodapé: usuário; conexão, versão e tema */}
      <div className="p-2.5 space-y-2 border-t border-line bg-surface-2/70 rounded-b-[21px]">
        <div className={`flex items-center gap-2.5 ${collapsed ? 'flex-col' : 'pl-0.5'}`}>
          <span className="w-8 h-8 shrink-0 rounded-full bg-accent/12 text-accent-ink ring-1 ring-inset ring-accent/20 flex items-center justify-center text-[11px] font-semibold">
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
          <button type="button" onClick={() => void signOut()} title="Sair" aria-label="Sair" className={iconButton}>
            <LogOut className="w-4 h-4" strokeWidth={1.75} />
          </button>
        </div>

        <div className={`flex items-center gap-2.5 text-[11px] text-stone-500 ${collapsed ? 'flex-col' : 'pl-3.5'}`}>
          <span className="relative flex w-2 h-2 shrink-0" title={connected ? 'Conectado ao Firestore' : 'Modo local (sem Firebase)'}>
            <span className={`absolute inset-0 rounded-full ${connected ? 'bg-emerald-500 animate-ping opacity-40' : ''}`} />
            <span className={`relative w-2 h-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-amber-400'}`} />
          </span>
          {!collapsed && (
            <span className="flex-1 min-w-0 leading-tight">
              <span className="block text-stone-600 dark:text-stone-300">{connected ? 'Firestore' : 'Modo local'}</span>
              <span className="block text-[10px] text-stone-400 font-mono tabular-nums truncate" title={versionDetail(APP_VERSION)}>
                {APP_VERSION.commitUrl ? (
                  <a href={APP_VERSION.commitUrl} target="_blank" rel="noopener noreferrer" className="hover:text-stone-700 dark:hover:text-stone-200 hover:underline">
                    {versionShort(APP_VERSION)}
                  </a>
                ) : (
                  versionShort(APP_VERSION)
                )}
              </span>
            </span>
          )}
          <ThemeSwitcher collapsed={collapsed} />
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
      className={`block print:hidden sticky top-0 h-screen shrink-0 py-3 pl-3 transition-[width] duration-200 ease-out ${
        collapsed ? 'w-[76px]' : 'w-[268px]'
      }`}
    >
      <div className="h-full rounded-[22px] bg-surface border border-line shadow-card">
        <SidebarBody
          collapsed={collapsed}
          headerAction={
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label={collapsed ? 'Expandir barra lateral' : 'Recolher barra lateral'}
              className="p-1.5 rounded-lg text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-stone-900/6 dark:hover:bg-white/8 transition-all duration-150 active:scale-[0.94]"
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
