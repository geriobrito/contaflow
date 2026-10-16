import { describe, expect, it } from 'vitest';
import { versionDetail, versionLabel, versionShort } from '@/lib/app-version';

const commit = '139880e2b1c4d5e6f708192a3b4c5d6e7f809123';

describe('versão publicada', () => {
  it('commit curto, com o ambiente quando não é produção', () => {
    expect(versionLabel({ commit, env: 'production' })).toBe('Versão 139880e');
    expect(versionLabel({ commit, env: 'preview' })).toBe('Versão 139880e (prévia)');
    expect(versionLabel({ commit: '', env: 'development' })).toBe('Versão sem commit (desenvolvimento)');
  });

  it('detalhe com commit completo e data do build', () => {
    expect(versionDetail({ commit, builtAt: '2026-10-15T23:00:00.000Z' })).toMatch(new RegExp(`^Commit ${commit} · Publicado em \\d{2}/\\d{2}/\\d{4}`));
    expect(versionDetail({ commit: '', builtAt: '' })).toBe('');
    expect(versionDetail({ commit, builtAt: '', env: 'preview' })).toBe(`Commit ${commit} · Ambiente: prévia`);
  });

  it('versão curta sem o ambiente, para o rodapé do menu', () => {
    expect(versionShort({ commit })).toBe('Versão 139880e');
    expect(versionShort({ commit: '' })).toBe('Versão sem commit');
  });
});
