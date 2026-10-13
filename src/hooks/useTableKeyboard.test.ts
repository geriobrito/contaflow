import { describe, expect, it } from 'vitest';
import { isInputElement } from './useTableKeyboard';

describe('isInputElement', () => {
  it('detecta elementos de entrada corretamente com objetos simulados', () => {
    expect(isInputElement(null)).toBe(false);

    expect(isInputElement({ tagName: 'INPUT' } as unknown as Element)).toBe(true);
    expect(isInputElement({ tagName: 'TEXTAREA' } as unknown as Element)).toBe(true);
    expect(isInputElement({ tagName: 'SELECT' } as unknown as Element)).toBe(true);
    expect(isInputElement({ tagName: 'DIV' } as unknown as Element)).toBe(false);
    expect(isInputElement({ tagName: 'DIV', isContentEditable: true } as unknown as Element)).toBe(true);
  });
});
