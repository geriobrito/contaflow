import { describe, expect, it } from 'vitest';
import { IDLE_TIMEOUT_MS, IDLE_WARNING_MS, MAX_SESSION_MS, MAX_WARNING_MS, sessionStatus } from '@/lib/auth/session-policy';

const MIN = 60_000;
const HOUR = 60 * MIN;
const login = Date.parse('2026-10-15T08:00:00Z');

describe('validade da sessão', () => {
  it('vale enquanto houver uso dentro de 30 minutos e de 12 horas do login', () => {
    expect(sessionStatus(login, login + 2 * HOUR, login + 2 * HOUR + 10 * MIN)).toEqual({ expired: null, warning: null, remainingMs: 20 * MIN });
  });

  it('encerra após 30 minutos sem uso, com aviso no último minuto', () => {
    const last = login + HOUR;
    expect(sessionStatus(login, last, last + IDLE_TIMEOUT_MS - IDLE_WARNING_MS + 1).warning).toBe('idle');
    expect(sessionStatus(login, last, last + IDLE_TIMEOUT_MS).expired).toBe('idle');
  });

  it('encerra 12 horas depois do login mesmo com uso contínuo, avisando 5 minutos antes', () => {
    const end = login + MAX_SESSION_MS;
    expect(sessionStatus(login, end - MAX_WARNING_MS, end - MAX_WARNING_MS)).toMatchObject({ expired: null, warning: 'max', remainingMs: MAX_WARNING_MS });
    expect(sessionStatus(login, end - 1, end).expired).toBe('max');
  });

  it('navegador reaberto no dia seguinte: sessão vencida', () => {
    const yesterday = login - 20 * HOUR;
    expect(sessionStatus(yesterday, yesterday + HOUR, login).expired).toBe('max');
    // Login recente (menos de 12 horas), mas sem uso há mais de 30 minutos.
    expect(sessionStatus(login, login + HOUR, login + 3 * HOUR).expired).toBe('idle');
  });

  it('login novo não é derrubado pelo registro de uso antigo, e sem registro conta como uso agora', () => {
    expect(sessionStatus(login, login - 5 * HOUR, login + MIN).expired).toBeNull();
    expect(sessionStatus(login, null, login + 3 * HOUR).expired).toBeNull();
  });
});
