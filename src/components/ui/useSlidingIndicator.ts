'use client';

import { useLayoutEffect, useRef } from 'react';

/**
 * Destaque deslizante de um grupo de opções (controle segmentado, abas, menu): um único elemento
 * posicionado sobre o item marcado com `data-active="true"`, que desliza até o próximo quando a
 * seleção muda. A posição é escrita direto no estilo (sem novo render) e a animação é uma
 * transição de CSS em `transform`, `width` e `height` (ver SLIDING_INDICATOR). O contêiner precisa
 * ser `relative`; o destaque fica oculto enquanto nenhum item visível está ativo.
 */
export function useSlidingIndicator<C extends HTMLElement>(activeKey: string | null | undefined) {
  const containerRef = useRef<C>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  // Já visível numa posição: a próxima mudança anima; no primeiro posicionamento, não.
  const placed = useRef(false);

  const place = (animate: boolean) => {
    const container = containerRef.current;
    const pill = indicatorRef.current;
    if (!container || !pill) return;
    const active = container.querySelector<HTMLElement>('[data-active="true"]');
    if (!active || active.offsetWidth === 0) {
      pill.style.opacity = '0';
      placed.current = false;
      return;
    }
    pill.style.transition = animate && placed.current ? '' : 'none';
    pill.style.width = `${active.offsetWidth}px`;
    pill.style.height = `${active.offsetHeight}px`;
    pill.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
    pill.style.opacity = '1';
    placed.current = true;
  };
  const placeRef = useRef(place);
  useLayoutEffect(() => {
    placeRef.current = place;
  });

  useLayoutEffect(() => {
    placeRef.current(true);
  }, [activeKey]);

  // Mudanças de tamanho (fonte carregada, janela, contêiner que aparece) reposicionam sem animar.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => placeRef.current(false));
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  return { containerRef, indicatorRef };
}

/** Classes base do destaque: posição absoluta no canto do contêiner e a transição do deslize. */
export const SLIDING_INDICATOR =
  'pointer-events-none absolute left-0 top-0 opacity-0 transition-[transform,width,height,opacity] duration-[260ms] ease-[cubic-bezier(0.3,0.9,0.3,1)]';
