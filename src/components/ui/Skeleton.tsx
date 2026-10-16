import React from 'react';

/**
 * Esqueletos de carregamento: a forma cinza do conteúdo que vai chegar, no lugar de um texto
 * "Carregando…", para a tela não pular quando os dados aparecem. O brilho vem da classe
 * `.skeleton` (globals.css), que respeita o tema e o "reduzir movimento".
 */

export function Skeleton({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return <div aria-hidden className={`skeleton rounded-md ${className}`} style={style} />;
}

/** Larguras variadas e estáveis (sem aleatório: o mesmo desenho a cada render). */
const WIDTHS = [88, 72, 94, 66, 81, 76, 90, 69];

function Loading({ label = 'Carregando…', className = '', children }: { label?: string; className?: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-busy="true" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/** Linhas de tabela: uma coluna curta, uma longa e o valor à direita. */
export function TableSkeleton({ rows = 6, label, dense = false }: { rows?: number; label?: string; dense?: boolean }) {
  return (
    <Loading label={label} className="divide-y divide-black/[0.04] dark:divide-white/[0.05]">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={`${dense ? 'h-11' : 'h-14'} px-5 flex items-center gap-4`}>
          <Skeleton className="h-3 w-16 shrink-0" />
          <div className="flex-1 min-w-0">
            <Skeleton className="h-3" style={{ width: `${WIDTHS[i % WIDTHS.length]}%` }} />
          </div>
          <Skeleton className="h-3 w-20 shrink-0" />
        </div>
      ))}
    </Loading>
  );
}

/** Demonstração contábil (DRE, Balanço, Razão): linhas com recuo pelo nível e valor à direita. */
export function StatementSkeleton({ rows = 12, label }: { rows?: number; label?: string }) {
  const levels = [0, 1, 2, 2, 1, 2, 2, 2, 0, 1, 2, 2];
  return (
    <Loading label={label} className="p-5 space-y-3.5">
      {Array.from({ length: rows }, (_, i) => {
        const level = levels[i % levels.length];
        return (
          <div key={i} className="flex items-center gap-4" style={{ paddingLeft: level * 20 }}>
            <Skeleton className={`h-3 ${level === 0 ? 'h-3.5' : ''}`} style={{ width: `${Math.max(24, WIDTHS[i % WIDTHS.length] - 30 - level * 6)}%` }} />
            <Skeleton className="h-3 w-24 ml-auto shrink-0" />
          </div>
        );
      })}
    </Loading>
  );
}

/** Texto corrido (notas explicativas): blocos de parágrafo. */
export function TextSkeleton({ paragraphs = 3, label }: { paragraphs?: number; label?: string }) {
  return (
    <Loading label={label} className="space-y-6">
      {Array.from({ length: paragraphs }, (_, p) => (
        <div key={p} className="space-y-2.5">
          <Skeleton className="h-4 w-48" />
          {Array.from({ length: 3 }, (_, l) => (
            <Skeleton key={l} className="h-3" style={{ width: l === 2 ? `${WIDTHS[p % WIDTHS.length] - 30}%` : '100%' }} />
          ))}
        </div>
      ))}
    </Loading>
  );
}

/** Cartões (lista de clientes, resumo do painel). */
export function CardsSkeleton({ count = 3, className = '', cardClassName = 'h-52 rounded-[22px]', label }: { count?: number; className?: string; cardClassName?: string; label?: string }) {
  return (
    <Loading label={label} className={className}>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className={cardClassName} />
      ))}
    </Loading>
  );
}
