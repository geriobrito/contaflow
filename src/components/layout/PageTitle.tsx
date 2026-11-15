'use client';

import { usePathname } from 'next/navigation';
import { pageTitle } from '@/components/layout/nav';

/**
 * Título da aba do navegador: o nome da tela atual ("Conciliação · ContaFlow"), para distinguir
 * abas e entradas do histórico. Fica no layout raiz, fora da checagem de sessão, para já sair no
 * HTML do servidor; é o único <title> do documento (o `metadata` do layout não define um).
 */
export function PageTitle() {
  return <title>{pageTitle(usePathname())}</title>;
}
