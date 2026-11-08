'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface VirtualWindowInput {
  /** Quantidade total de linhas/itens na lista. */
  totalCount: number;
  /** Altura estimada de cada linha em pixels. */
  rowHeight: number;
  /** Altura visível do container em pixels. */
  viewportHeight: number;
  /** Posição atual de rolagem vertical (`scrollTop`). */
  scrollTop: number;
  /** Linhas extras renderizadas acima e abaixo da janela visível (buffer). */
  overscan?: number;
  /** Limiar mínimo de itens para ativar a virtualização (abaixo disso renderiza tudo). */
  minItemsForVirtualization?: number;
  /** Força a desativação da virtualização (ex.: durante impressão `@media print`). */
  disabled?: boolean;
}

export interface VirtualWindowResult {
  /** Indica se a lista está efetivamente virtualizada no momento. */
  isVirtualized: boolean;
  /** Índice inicial (inclusivo) da fatia visível. */
  startIndex: number;
  /** Índice final (exclusivo) da fatia visível. */
  endIndex: number;
  /** Altura do espaçador superior em pixels. */
  offsetTop: number;
  /** Altura do espaçador inferior em pixels. */
  offsetBottom: number;
  /** Altura total estimada de todas as linhas em pixels. */
  totalHeight: number;
}

/**
 * Cálculo puro da janela de virtualização de tabela.
 * Separado do ciclo de vida do React para permitir testes determinísticos em Node.js.
 */
export function computeVirtualWindow({
  totalCount,
  rowHeight,
  viewportHeight,
  scrollTop,
  overscan = 10,
  minItemsForVirtualization = 60,
  disabled = false,
}: VirtualWindowInput): VirtualWindowResult {
  const safeCount = Math.max(0, totalCount);
  const safeRowHeight = Math.max(1, rowHeight);
  const totalHeight = safeCount * safeRowHeight;

  if (disabled || safeCount === 0 || safeCount < minItemsForVirtualization) {
    return {
      isVirtualized: false,
      startIndex: 0,
      endIndex: safeCount,
      offsetTop: 0,
      offsetBottom: 0,
      totalHeight,
    };
  }

  const safeViewport = Math.max(safeRowHeight, viewportHeight);
  const clampedScrollTop = Math.max(0, Math.min(scrollTop, Math.max(0, totalHeight - safeViewport)));

  const rawStart = Math.floor(clampedScrollTop / safeRowHeight);
  const visibleCount = Math.ceil(safeViewport / safeRowHeight);

  const startIndex = Math.max(0, rawStart - overscan);
  const endIndex = Math.min(safeCount, rawStart + visibleCount + overscan);

  const offsetTop = startIndex * safeRowHeight;
  const offsetBottom = Math.max(0, (safeCount - endIndex) * safeRowHeight);

  return {
    isVirtualized: true,
    startIndex,
    endIndex,
    offsetTop,
    offsetBottom,
    totalHeight,
  };
}

export interface UseVirtualTableOptions {
  /** Altura estimada de cada linha em pixels (padrão: 42). */
  rowHeight?: number;
  /** Altura padrão da viewport antes da medição do DOM (padrão: 560). */
  defaultViewportHeight?: number;
  /** Quantidade de itens extras acima/abaixo da viewport (padrão: 12). */
  overscan?: number;
  /** Quantidade mínima de linhas para ativar virtualização (padrão: 60). */
  minItemsForVirtualization?: number;
  /** Desativa manualmente a virtualização. */
  disabled?: boolean;
}

export interface UseVirtualTableReturn<T> extends VirtualWindowResult {
  /** Ref a ser conectada ao container rolável (`overflow-y-auto`). */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Handler de scroll a ser conectado ao `onScroll` do container rolável. */
  onScroll: (e: React.UIEvent<HTMLDivElement>) => void;
  /** Subconjunto de itens que devem ser renderizados no DOM agora. */
  visibleItems: readonly T[];
  /** Indica se o navegador está em modo de impressão (`@media print`). */
  isPrinting: boolean;
}

/**
 * Hook de virtualização para tabelas longas (Razão, Diário, Gaveta Analítica).
 * Mantém 60 FPS renderizando apenas os itens da viewport e desativa o corte
 * automaticamente durante a impressão (`window.print()`).
 */
export function useVirtualTable<T>(
  items: readonly T[],
  options: UseVirtualTableOptions = {}
): UseVirtualTableReturn<T> {
  const {
    rowHeight = 42,
    defaultViewportHeight = 560,
    overscan = 12,
    minItemsForVirtualization = 60,
    disabled = false,
  } = options;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(defaultViewportHeight);
  const [isPrinting, setIsPrinting] = useState(false);

  // Detecta modo de impressão (@media print e eventos beforeprint/afterprint)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleBeforePrint = () => setIsPrinting(true);
    const handleAfterPrint = () => setIsPrinting(false);

    window.addEventListener('beforeprint', handleBeforePrint);
    window.addEventListener('afterprint', handleAfterPrint);

    let mql: MediaQueryList | null = null;
    const handleMediaChange = (e: MediaQueryListEvent) => setIsPrinting(e.matches);
    if (typeof window.matchMedia === 'function') {
      mql = window.matchMedia('print');
      mql.addEventListener?.('change', handleMediaChange);
    }

    return () => {
      window.removeEventListener('beforeprint', handleBeforePrint);
      window.removeEventListener('afterprint', handleAfterPrint);
      mql?.removeEventListener?.('change', handleMediaChange);
    };
  }, []);

  // Mede a altura real do container de scroll quando montado ou redimensionado
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof window === 'undefined') return;

    const updateHeight = () => {
      if (el.clientHeight > 0) {
        setViewportHeight(el.clientHeight);
      }
    };
    updateHeight();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(updateHeight);
      observer.observe(el);
      return () => observer.disconnect();
    }
  }, [items.length]);

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const windowResult = useMemo(
    () =>
      computeVirtualWindow({
        totalCount: items.length,
        rowHeight,
        viewportHeight,
        scrollTop,
        overscan,
        minItemsForVirtualization,
        disabled: disabled || isPrinting,
      }),
    [items.length, rowHeight, viewportHeight, scrollTop, overscan, minItemsForVirtualization, disabled, isPrinting]
  );

  const visibleItems = useMemo(
    () =>
      windowResult.isVirtualized
        ? items.slice(windowResult.startIndex, windowResult.endIndex)
        : items,
    [items, windowResult.isVirtualized, windowResult.startIndex, windowResult.endIndex]
  );

  return {
    containerRef,
    onScroll,
    visibleItems,
    isPrinting,
    ...windowResult,
  };
}
