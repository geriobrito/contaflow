import { describe, expect, it } from 'vitest';
import { isInputElement } from './useTableKeyboard';
import { SHORTCUTS } from '@/components/conciliacao/KeyboardHelpModal';

describe('isInputElement', () => {
  it('detecta elementos de entrada corretamente com objetos simulados', () => {
    expect(isInputElement(null)).toBe(false);

    expect(isInputElement({ tagName: 'INPUT' } as unknown as Element)).toBe(true);
    expect(isInputElement({ tagName: 'TEXTAREA' } as unknown as Element)).toBe(true);
    expect(isInputElement({ tagName: 'SELECT' } as unknown as Element)).toBe(true);
    expect(isInputElement({ tagName: 'DIV' } as unknown as Element)).toBe(false);
    expect(isInputElement({ tagName: 'DIV', isContentEditable: true } as unknown as Element)).toBe(true);
  });

  it('lista completa de atalhos de produtividade documentados no modal de ajuda', () => {
    const flatKeys = SHORTCUTS.flatMap((s) => s.keys);
    expect(flatKeys).toContain('J');
    expect(flatKeys).toContain('K');
    expect(flatKeys).toContain('C');
    expect(flatKeys).toContain('S');
    expect(flatKeys).toContain('A');
    expect(flatKeys).toContain('V');
    expect(flatKeys).toContain('[');
    expect(flatKeys).toContain(']');
  });
});
