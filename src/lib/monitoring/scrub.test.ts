import { describe, expect, it } from 'vitest';
import { keepBreadcrumb, MAX_MESSAGE, scrubEvent, scrubText, scrubUrl } from '@/lib/monitoring/scrub';

const TOKEN = '0123456789abcdef0123456789abcdef';

describe('limpeza dos eventos de erro (LGPD)', () => {
  it('URL sem consulta nem fragmento: o token do link de pendências não sai', () => {
    expect(scrubUrl(`https://app.exemplo.com/responder#t=${TOKEN}`)).toBe('https://app.exemplo.com/responder');
    expect(scrubUrl('/razao?conta=1.1.1&de=2025-01-01')).toBe('/razao');
  });

  it('mensagem sem token, e-mail, CPF, CNPJ nem endereço completo; cortada no tamanho máximo', () => {
    const msg = `Falha em https://app.exemplo.com/responder#t=${TOKEN} para joao@empresa.com.br, CPF 123.456.789-09, CNPJ 11.222.333/0001-81, token ${TOKEN}`;
    const out = scrubText(msg);
    expect(out).not.toContain(TOKEN);
    expect(out).not.toContain('joao@');
    expect(out).not.toContain('123.456.789-09');
    expect(out).not.toContain('11.222.333/0001-81');
    expect(out).toContain('https://app.exemplo.com/responder');
    expect(scrubText('x'.repeat(1000))).toHaveLength(MAX_MESSAGE);
  });

  it('só navegação nos breadcrumbs, com o endereço limpo', () => {
    expect(keepBreadcrumb({ category: 'console', message: 'PIX RECEBIDO MARIA SILVA' })).toBeNull();
    expect(keepBreadcrumb({ category: 'fetch', data: { url: '/api/cnpj/11222333000181' } })).toBeNull();
    expect(keepBreadcrumb({ category: 'ui.click', message: 'button[title="Excluir Empresa X"]' })).toBeNull();
    expect(keepBreadcrumb({ category: 'navigation', data: { from: '/login', to: `/responder#t=${TOKEN}` } })).toEqual({
      category: 'navigation',
      data: { from: '/login', to: '/responder' },
    });
  });

  it('evento completo: sai só o necessário', () => {
    const event = scrubEvent({
      message: `erro com ${TOKEN}`,
      exception: { values: [{ type: 'FirebaseError', value: `Missing permissions for maria@x.com #t=${TOKEN}` }] },
      request: { url: `https://app.exemplo.com/responder?x=1#t=${TOKEN}`, query_string: 'x=1', headers: { Cookie: 'a=b' }, cookies: { a: 'b' }, data: 'corpo' },
      user: { id: 'uid-1', email: 'maria@x.com', ip_address: '1.2.3.4' },
      breadcrumbs: [{ category: 'console', message: 'memo do lançamento' }, { category: 'navigation', data: { from: '/', to: '/dre' } }],
      extra: { lancamento: 'PIX MARIA' },
      transaction: `/responder#t=${TOKEN}`,
    });
    const json = JSON.stringify(event);
    expect(json).not.toContain(TOKEN);
    expect(json).not.toContain('maria@');
    expect(json).not.toContain('1.2.3.4');
    expect(json).not.toContain('PIX MARIA');
    expect(json).not.toContain('memo do lançamento');
    expect(event.request).toEqual({ url: 'https://app.exemplo.com/responder' });
    expect(event.user).toEqual({ id: 'uid-1' });
    expect(event.breadcrumbs).toEqual([{ category: 'navigation', data: { from: '/', to: '/dre' } }]);
  });
});
