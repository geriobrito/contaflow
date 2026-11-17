import { describe, expect, it } from 'vitest';
import { NAV_EXTRA_PAGES, NAV_ITEMS, activeNavHref, pageTitle } from '@/components/layout/nav';

describe('telas fora do menu', () => {
  it('marcam o item do menu de onde são abertas e têm título próprio na aba', () => {
    expect(activeNavHref('/simples-ibs-cbs')).toBe('/nfe');
    expect(pageTitle('/simples-ibs-cbs')).toBe('IBS/CBS no Simples · ContaFlow');
    expect(pageTitle('/nfe')).toBe('Notas Fiscais · ContaFlow');
  });

  it('não repetem telas do menu e apontam um item que existe', () => {
    for (const page of NAV_EXTRA_PAGES) {
      expect(NAV_ITEMS.some((i) => i.href === page.href)).toBe(false);
      expect(NAV_ITEMS.some((i) => i.label === page.within)).toBe(true);
    }
  });
});
