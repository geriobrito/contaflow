import React from 'react';
import { TABLE_HEAD } from '@/components/ui/primitives';

export { TABLE_HEAD };

const ALIGN = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;
const EDGE = { start: 'pl-5 pr-3 py-2.5', end: 'pl-3 pr-5 py-2.5' } as const;
/** Classe de espaçamento sem variante (`print:px-1` não conta): quem passa a sua dispensa o padrão. */
const HAS_PADDING = /(^|\s)p[xytblr]?-/;

interface ThProps extends Omit<React.ThHTMLAttributes<HTMLTableCellElement>, 'align'> {
  align?: keyof typeof ALIGN;
  /** Primeira (`start`) ou última (`end`) coluna: recuo maior do lado da borda do cartão. */
  edge?: keyof typeof EDGE;
}

/**
 * Célula de cabeçalho de tabela. Use dentro de `<tr className={TABLE_HEAD}>`.
 * O espaçamento padrão só entra quando `className` não traz o seu.
 */
export function Th({ align, edge, className = '', ...rest }: ThProps) {
  const padding = HAS_PADDING.test(className) ? '' : edge ? EDGE[edge] : 'px-3 py-2.5';
  const classes = ['font-semibold', padding, align ? ALIGN[align] : '', className].filter(Boolean).join(' ');
  return <th className={classes} {...rest} />;
}
