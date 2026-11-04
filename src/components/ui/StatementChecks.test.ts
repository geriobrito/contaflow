import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { StatementChecks } from '@/components/ui/StatementChecks';
import type { StatementCheck } from '@/lib/statement-checks';

vi.mock('next/link', async () => {
  const react = await import('react');
  return {
    default: ({ href, children, ...rest }: { href: string; children?: unknown }) => react.createElement('a', { href, ...rest }, children as never),
  };
});

const render = (checks: (StatementCheck | null)[]) => renderToString(createElement(StatementChecks, { checks }));

describe('bloco de pendências das demonstrações', () => {
  it('só atenção: recolhido numa linha, com o número e os títulos', () => {
    const html = render([
      { id: 'opening', level: 'warn', title: 'Abertura não conferida', items: ['Saldos de abertura não informados'], href: '/abertura', linkLabel: 'Conferir saldos de abertura' },
      { id: 'capital', level: 'info', title: 'Capital social sem saldo' },
      { id: 'balance', level: 'ok', title: 'Ativo = Passivo + Patrimônio líquido' },
    ]);
    expect(html).toContain('Pendências desta demonstração (1)');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('Abertura não conferida · Capital social sem saldo');
    // Detalhes só com o bloco aberto; o que confere fica sempre à vista.
    expect(html).not.toContain('Conferir saldos de abertura');
    expect(html).toContain('Ativo = Passivo + Patrimônio líquido');
  });

  it('algo impede a emissão: abre sozinho, com os detalhes e os links', () => {
    const html = render([
      { id: 'balance', level: 'block', title: 'Diferença de R$ 10,00 entre ativo e passivo + PL', href: '/abertura', linkLabel: 'Revisar a abertura' },
      { id: 'opening', level: 'warn', title: 'Abertura não conferida' },
    ]);
    expect(html).toContain('Pendências desta demonstração (2)');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('Revisar a abertura');
  });

  it('nada a mostrar: não renderiza', () => {
    expect(render([null])).toBe('');
  });
});
