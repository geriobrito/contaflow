'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Layers,
  ArrowLeftRight,
  TrendingUp,
  BrainCircuit,
  Building2,
  Sparkles,
  LogOut,
  User as UserIcon,
} from 'lucide-react';
import { ClientCompany } from '@/types/firestore';
import { isFirebaseConfigured } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';

interface NavbarProps {
  currentClient?: ClientCompany;
  clients?: ClientCompany[];
  onSelectClient?: (client: ClientCompany) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentClient,
  clients = [],
  onSelectClient,
}) => {
  const pathname = usePathname();
  const firebaseActive = isFirebaseConfigured();
  const { user, signOut } = useAuth();

  const navLinks = [
    { href: '/', label: 'Conciliação OFX', icon: ArrowLeftRight },
    { href: '/plano-de-contas', label: 'Plano de Contas', icon: Layers },
    { href: '/regras', label: 'Motor de Regras', icon: BrainCircuit },
    { href: '/dre', label: 'Demonstração DRE', icon: TrendingUp },
    { href: '/clientes', label: 'Empresas', icon: Building2 },
  ];

  return (
    <header className="sticky top-0 z-50 w-full ios-glass border-b border-black/[0.06] dark:border-white/[0.08]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Brand */}
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2.5 group">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white shadow-md shadow-blue-500/20 group-hover:scale-105 transition-transform duration-200">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <span className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-white">
                  ContaFlow
                </span>
                <span className="text-[10px] ml-1.5 px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400 font-medium">
                  Smart OFX
                </span>
              </div>
            </Link>

            {/* Navigation Tabs (Apple Segmented Style) */}
            <nav className="hidden md:flex items-center p-1 bg-black/[0.03] dark:bg-white/[0.04] rounded-2xl border border-black/[0.04] dark:border-white/[0.06]">
              {navLinks.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-medium transition-all duration-200 ${
                      isActive
                        ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm shadow-black/[0.04]'
                        : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* Right Area: Client Switcher, Status Indicator & User Logout */}
          <div className="flex items-center gap-3">
            {/* Database indicator */}
            <div
              title={
                firebaseActive
                  ? 'Conectado ao Firestore (Plano Spark)'
                  : 'Modo Local / Armazenamento rápido ativado'
              }
              className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200/50 dark:border-emerald-800/40"
            >
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>{firebaseActive ? 'Firebase Spark' : 'Storage Ativo'}</span>
            </div>

            {/* Client selector dropdown */}
            {clients.length > 0 && (
              <div className="relative">
                <select
                  value={currentClient?.id || ''}
                  onChange={(e) => {
                    const sel = clients.find((c) => c.id === e.target.value);
                    if (sel && onSelectClient) onSelectClient(sel);
                  }}
                  className="text-xs font-medium bg-white dark:bg-zinc-800 border border-black/[0.08] dark:border-white/[0.1] rounded-xl px-3 py-1.5 pr-7 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20 shadow-sm cursor-pointer"
                >
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.tradeName || c.name} ({c.taxRegime || c.regime})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* User Session & Discrete Logout Button */}
            {user && (
              <div className="flex items-center gap-2 pl-2 border-l border-black/10 dark:border-white/10">
                <div className="hidden lg:flex flex-col text-right">
                  <span className="text-[11px] font-semibold text-zinc-800 dark:text-zinc-200 truncate max-w-[130px]">
                    {user.displayName || user.email?.split('@')[0]}
                  </span>
                  <span className="text-[9px] text-zinc-400 truncate max-w-[130px]">
                    {user.email}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => signOut()}
                  title="Sair do sistema (Logout)"
                  className="ios-button flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium text-zinc-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 border border-transparent hover:border-rose-200 dark:hover:border-rose-900/50 transition-all"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline text-[11px]">Sair</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
