'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CNPJLookupResult } from '@/lib/cnpj';
import { useAuth } from '@/contexts/AuthContext';

export interface LookupNotice {
  kind: 'ok' | 'warn' | 'info';
  text: string;
}

interface Options {
  /** CNPJ digitado, já sem máscara. */
  cnpj: string;
  /** Se o CNPJ está completo e com dígitos verificadores certos. */
  valid: boolean;
  /** CNPJ já gravado da empresa em edição: não é consultado de novo sozinho. */
  savedCnpj: string | null;
  /** Recebe os dados da Receita; `overwrite` diz se pode trocar campos já preenchidos. */
  onResult: (data: CNPJLookupResult, overwrite: boolean) => void;
}

/**
 * Consulta do cadastro público do CNPJ pela rota `/api/cnpj`. Dispara sozinha quando um CNPJ
 * novo fica completo e válido; `lookup(cnpj, true)` é a consulta pedida pelo botão.
 */
export function useCnpjLookup({ cnpj, valid, savedCnpj, onResult }: Options) {
  const { user, isMockAuth } = useAuth();
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<LookupNotice | null>(null);
  const lastAutoQueriedRef = useRef<string | null>(savedCnpj);
  const abortRef = useRef<AbortController | null>(null);
  const onResultRef = useRef(onResult);

  useEffect(() => {
    onResultRef.current = onResult;
  });

  const lookup = useCallback(
    async (targetCnpj: string, overwrite: boolean) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      setNotice(null);
      try {
        // A rota só atende usuário logado (ID token do Firebase); o modo local não tem token.
        const token = isMockAuth ? null : await user?.getIdToken();
        const response = await fetch(`/api/cnpj/${encodeURIComponent(targetCnpj)}`, {
          signal: controller.signal,
          ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          setNotice({ kind: 'info', text: body?.error || 'Consulta automática indisponível — preencha os campos manualmente.' });
          return;
        }

        const data = (await response.json()) as CNPJLookupResult;
        onResultRef.current(data, overwrite);

        const sit = data.situacaoCadastral;
        const isInactive = Boolean(sit && sit.toUpperCase() !== 'ATIVA');
        setNotice({
          kind: isInactive ? 'warn' : 'ok',
          text: isInactive
            ? `Dados preenchidos · Atenção: situação cadastral "${sit}" na Receita Federal.`
            : 'Dados preenchidos automaticamente via cadastro público do CNPJ.',
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setNotice({ kind: 'info', text: 'Sem conexão com a consulta pública — preencha os dados manualmente.' });
      } finally {
        if (abortRef.current === controller) setLoading(false);
      }
    },
    [isMockAuth, user]
  );

  // Busca sozinha ao completar um CNPJ novo e válido.
  useEffect(() => {
    if (!valid || lastAutoQueriedRef.current === cnpj) return;
    lastAutoQueriedRef.current = cnpj;
    void lookup(cnpj, false);
  }, [valid, cnpj, lookup]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const clearNotice = useCallback(() => setNotice(null), []);

  return { loading, notice, clearNotice, lookup };
}
