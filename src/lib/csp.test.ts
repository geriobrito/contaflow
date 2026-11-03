import { describe, expect, it } from 'vitest';
import { buildCsp, newNonce } from '@/lib/csp';

const directive = (csp: string, name: string) => csp.split('; ').find((d) => d.startsWith(`${name} `)) ?? '';

describe('CSP com nonce', () => {
  it('scripts só com o nonce da requisição e strict-dynamic, sem unsafe-inline', () => {
    const scripts = directive(buildCsp('abc123', false), 'script-src');
    expect(scripts).toContain("'nonce-abc123'");
    expect(scripts).toContain("'strict-dynamic'");
    expect(scripts).not.toContain('unsafe-inline');
    expect(scripts).not.toContain('unsafe-eval');
  });

  it('desenvolvimento libera eval (React) e WebSocket (HMR); produção não', () => {
    expect(directive(buildCsp('n', true), 'script-src')).toContain("'unsafe-eval'");
    expect(directive(buildCsp('n', true), 'connect-src')).toContain('ws:');
    expect(directive(buildCsp('n', false), 'connect-src')).not.toContain('ws:');
  });

  it('mantém as demais proteções', () => {
    const csp = buildCsp('n', false);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
  });

  it('nonce diferente a cada chamada', () => {
    const a = newNonce();
    expect(a).not.toBe(newNonce());
    expect(a.length).toBeGreaterThanOrEqual(32);
  });
});
