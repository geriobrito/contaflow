'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CepLookupResult } from '@/lib/cep';
import { fetchCEPFromProviders, isValidCEP } from '@/lib/cep';
import { isFinalLookupStatus } from '@/lib/cnpj';
import { cleanDigits } from '@/lib/utils/formatters';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Endereço pelo CEP (rota `/api/cep`): consulta sozinha quando um CEP novo fica completo, e
 * `lookup()` repete a consulta pelo botão. Falha nunca bloqueia: o endereço é digitado à mão.
 */
export function useCepLookup({ cep, savedCep, onFound }: { cep: string; savedCep: string | null; onFound: (data: CepLookupResult) => void }) {
  const { user, isMockAuth } = useAuth();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'info'; text: string } | null>(null);
  const lastRef = useRef<string | null>(savedCep);
  const abortRef = useRef<AbortController | null>(null);
  const onFoundRef = useRef(onFound);
  useEffect(() => {
    onFoundRef.current = onFound;
  });

  const lookup = useCallback(
    async (target: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      setMessage(null);
      try {
        // Como no CNPJ: 1º a rota do app; se ela falhar por motivo que não seja do próprio CEP,
        // o navegador consulta direto os provedores públicos. O modo local fica só na rota.
        let data: CepLookupResult | null = null;
        let failure = 'Sem conexão com a consulta de CEP — preencha o endereço manualmente.';
        let tryDirect = !isMockAuth;
        try {
          const token = isMockAuth ? null : await user?.getIdToken();
          const res = await fetch(`/api/cep/${encodeURIComponent(target)}`, {
            signal: controller.signal,
            ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
          });
          if (res.ok) {
            data = (await res.json()) as CepLookupResult;
          } else {
            const body = (await res.json().catch(() => null)) as { error?: string } | null;
            failure = body?.error || 'Consulta de CEP indisponível — preencha o endereço manualmente.';
            if (isFinalLookupStatus(res.status)) tryDirect = false;
          }
        } catch (err) {
          if (controller.signal.aborted) return;
          if (!tryDirect) throw err;
        }
        if (!data && tryDirect) {
          const direct = await fetchCEPFromProviders(target, fetch, { direct: true, signal: controller.signal });
          if (controller.signal.aborted) return;
          if (direct.ok) data = direct.data;
          else if (direct.status === 404) failure = direct.error;
        }
        if (!data) {
          setMessage({ kind: 'info', text: failure });
          return;
        }
        onFoundRef.current(data);
        setMessage({ kind: 'ok', text: 'Endereço preenchido pelo CEP. Confira o número e o complemento.' });
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setMessage({ kind: 'info', text: 'Sem conexão com a consulta de CEP — preencha o endereço manualmente.' });
      } finally {
        if (abortRef.current === controller) setLoading(false);
      }
    },
    [isMockAuth, user]
  );

  const digits = cleanDigits(cep);
  useEffect(() => {
    if (!isValidCEP(digits) || lastRef.current === digits) return;
    lastRef.current = digits;
    void lookup(digits);
  }, [digits, lookup]);

  useEffect(() => () => abortRef.current?.abort(), []);

  return {
    loading,
    message,
    lookup: () => void lookup(digits),
    clear: () => setMessage(null),
    /** CEP que já chegou com o endereço (do cartão CNPJ): não consulta sozinho por cima dele. */
    markKnown: (known: string) => {
      lastRef.current = cleanDigits(known);
    },
  };
}
