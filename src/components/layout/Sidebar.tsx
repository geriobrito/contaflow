'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ArrowLeftRight,
  BookOpen,
  Building2,
  Check,
  ChevronsUpDown,
  LineChart,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Sparkles,
  X,
  type LucideIcon,
  History,
  Landmark,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useClient } from '@/contexts/ClientContext';
import { isFirebaseConfigured } from '@/lib/firebase';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: readonly NavItem[] = [
  { href: '/', label: 'Conciliação', icon: ArrowLeftRight },
  { href: '/plano-de-contas', label: 'Plano de Contas', icon: BookOpen },
  { href: '/regras', label: 'Regras de Aprendizado', icon: Sparkles },
  { href: '/dre', label: 'DRE', icon: LineChart },
  { href: '/clientes', label: 'Clientes', icon: Building2 },
  { href: '/auditoria', label: 'Auditoria', icon: History },
  { href: '/escritorio', label: 'Escritório', icon: Landmark },
];

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
  const { clients, currentClient, selectClient } = useClient();
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
                  {active && <Check className="w-3.5 h-3.5 text-[#0071E3] shrink-0" />}
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
   Conteúdo da sidebar (compartilhado entre desktop e gaveta mobile)
   ========================================================================= */

interface SidebarBodyProps {
  collapsed: boolean;
  onNavigate?: () => void;
  headerAction?: React.ReactNode;
}

function SidebarBody({ collapsed, onNavigate, headerAction }: SidebarBodyProps) {
  const pathname = usePathname();
  const { user, signOut } = useAuth();
  const connected = isFirebaseConfigured();
  const displayName = user?.displayName || user?.email?.split('@')[0] || 'Usuário';

  return (
    <div className="flex flex-col h-full">
      {/* Marca */}
      <div className={`flex items-center h-14 px-3 ${collapsed ? 'justify-center' : 'justify-between'}`}>
        {!collapsed && (
          <Link href="/" onClick={onNavigate} className="flex items-center gap-2 px-1">
            <span className="w-6 h-6 rounded-lg bg-gradient-to-br from-[#D97757] to-[#C15F3C] flex items-center justify-center">
              <Sparkles className="w-3.5 h-3.5 text-white" />
            </span>
            <span className="text-[15px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
              ContaFlow
            </span>
          </Link>
        )}
        {headerAction}
      </div>

      <div className="px-2">
        <ClientSwitcher collapsed={collapsed} />
      </div>

      <div className="mx-4 my-3 border-t border-black/[0.05] dark:border-white/[0.06]" />

      {/* Navegação */}
      <nav className="flex-1 px-2 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              title={collapsed ? label : undefined}
              aria-current={active ? 'page' : undefined}
              className={`flex items-center gap-3 rounded-xl px-2.5 py-2 text-[13px] tracking-tight transition-all duration-150 active:scale-[0.98] ${
                collapsed ? 'justify-center' : ''
              } ${
                active
                  ? 'bg-white dark:bg-white/[0.08] text-stone-900 dark:text-white font-medium shadow-[0_1px_3px_rgba(0,0,0,0.06)] border border-black/[0.04] dark:border-white/[0.06]'
                  : 'text-stone-600 dark:text-stone-400 hover:bg-black/[0.04] dark:hover:bg-white/[0.05] hover:text-stone-900 dark:hover:text-stone-100 border border-transparent'
              }`}
            >
              <Icon className={`w-[17px] h-[17px] shrink-0 ${active ? 'text-[#0071E3]' : ''}`} strokeWidth={1.75} />
              {!collapsed && <span className="truncate">{label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Rodapé */}
      <div className="p-2 space-y-1 border-t border-black/[0.05] dark:border-white/[0.06]">
        <div
          className={`flex items-center gap-2 px-2.5 py-1.5 text-[11px] text-stone-500 ${collapsed ? 'justify-center' : ''}`}
          title={connected ? 'Conectado ao Firestore' : 'Modo local (sem Firebase)'}
        >
          <span className="relative flex w-2 h-2">
            <span className={`absolute inset-0 rounded-full ${connected ? 'bg-emerald-500 animate-ping opacity-40' : ''}`} />
            <span className={`relative w-2 h-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-amber-400'}`} />
          </span>
          {!collapsed && <span>{connected ? 'Firestore conectado' : 'Modo local'}</span>}
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
   Sidebar (desktop fixa/colapsável + gaveta mobile)
   ========================================================================= */

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

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

  // Fecha a gaveta ao navegar.
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setMobileOpen(false);
  }

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMobileOpen(false);
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [mobileOpen]);

  return (
    <>
      {/* Barra superior mobile */}
      <header className="lg:hidden print:hidden sticky top-0 z-30 flex items-center gap-3 h-14 px-4 backdrop-blur-xl bg-[#F9F9F8]/80 dark:bg-stone-950/80 border-b border-black/[0.05] dark:border-white/[0.06]">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Abrir menu"
          className="p-2 -ml-2 rounded-xl text-stone-700 dark:text-stone-300 hover:bg-black/[0.04] active:scale-[0.96] transition-all duration-150"
        >
          <Menu className="w-5 h-5" strokeWidth={1.75} />
        </button>
        <span className="text-[15px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">ContaFlow</span>
      </header>

      {/* Desktop */}
      <aside
        className={`hidden lg:block print:hidden sticky top-0 h-screen shrink-0 p-3 transition-[width] duration-200 ease-out ${
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

      {/* Gaveta mobile */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-stone-900/20 backdrop-blur-sm animate-fade-in"
            onClick={() => setMobileOpen(false)}
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Menu de navegação"
            className="absolute inset-y-0 left-0 w-[288px] max-w-[85vw] p-2 animate-drawer-in"
          >
            <div className="h-full rounded-[22px] bg-[#F9F9F8] dark:bg-stone-900 border border-black/[0.06] dark:border-white/[0.08] shadow-[0_8px_40px_rgba(0,0,0,0.12)]">
              <SidebarBody
                collapsed={false}
                onNavigate={() => setMobileOpen(false)}
                headerAction={
                  <button
                    type="button"
                    onClick={() => setMobileOpen(false)}
                    aria-label="Fechar menu"
                    className="p-1.5 rounded-lg text-stone-400 hover:bg-black/[0.05] active:scale-[0.94] transition-all duration-150"
                  >
                    <X className="w-4 h-4" />
                  </button>
                }
              />
            </div>
          </aside>
        </div>
      )}
    </>
  );
}

export default Sidebar;
