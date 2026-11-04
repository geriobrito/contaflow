'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CNPJLookupResult } from '@/lib/cnpj';
import { reviewLookup, type ClientFormFields, type LookupReview } from '@/lib/cnpj-review';
import { useAuth } from '@/contexts/AuthContext';

export interface LookupNotice {
  kind: 'ok' | 'warn' | 'info';
  text: string;
}

/** Resposta da Receita que pede confirmação antes de mexer no formulário. */
export interface PendingLookup {
  review: Extract<LookupReview, { kind: 'other-company' | 'changes' }>;
  /** Situação cadastral fora de "ATIVA", para mostrar junto da pergunta. */
  inactiveStatus: string | null;
}

interface Options {
  /** CNPJ digitado, já sem máscara. */
  cnpj: string;
  /** Se o CNPJ está completo e com dígitos verificadores certos. */
  valid: boolean;
  /** CNPJ já gravado da empresa em edição: não é consultado de novo sozinho. */
  savedCnpj: string | null;
  /** Valores atuais do formulário, para comparar com a Receita. */
  getForm: () => ClientFormFields;
  /** Grava no formulário os campos aceitos. */
  apply: (fields: Partial<ClientFormFields>) => void;
}

const inactiveOf = (data: CNPJLookupResult): string | null => {
  const sit = data.situacaoCadastral;
  return sit && sit.toUpperCase() !== 'ATIVA' ? sit : null;
};

const filledNotice = (inactive: string | null): LookupNotice =>
  inactive
    ? { kind: 'warn', text: `Dados preenchidos · Atenção: situação cadastral "${inactive}" na Receita Federal.` }
    : { kind: 'ok', text: 'Dados preenchidos automaticamente via cadastro público do CNPJ.' };

/**
 * Consulta do cadastro público do CNPJ pela rota `/api/cnpj`. Dispara sozinha quando um CNPJ
 * novo fica completo e válido; `lookup(cnpj, true)` é a consulta pedida pelo botão. Quando a
 * resposta conflita com o que foi digitado (`reviewLookup`), fica pendente até o usuário decidir.
 */
export function useCnpjLookup({ cnpj, valid, savedCnpj, getForm, apply }: Options) {
  const { user, isMockAuth } = useAuth();
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<LookupNotice | null>(null);
  const [pending, setPending] = useState<PendingLookup | null>(null);
  const lastAutoQueriedRef = useRef<string | null>(savedCnpj);
  const abortRef = useRef<AbortController | null>(null);
  const getFormRef = useRef(getForm);
  const applyRef = useRef(apply);

  useEffect(() => {
    getFormRef.current = getForm;
    applyRef.current = apply;
  });

  const lookup = useCallback(
    async (targetCnpj: string, overwrite: boolean) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      setNotice(null);
      setPending(null);
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
        const inactive = inactiveOf(data);
        const review = reviewLookup(getFormRef.current(), data, overwrite);
        if (review.kind === 'apply') {
          applyRef.current(review.fields);
          setNotice(filledNotice(inactive));
        } else if (review.kind === 'unchanged') {
          setNotice(
            inactive
              ? { kind: 'warn', text: `O cadastro já está igual ao da Receita · Atenção: situação cadastral "${inactive}".` }
              : { kind: 'ok', text: 'O cadastro já está igual ao da Receita.' }
          );
        } else {
          setPending({ review, inactiveStatus: inactive });
        }
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

  /** CNPJ editado: o aviso e a pergunta pendente eram do CNPJ anterior. */
  const clearNotice = useCallback(() => {
    setNotice(null);
    setPending(null);
  }, []);

  const acceptPending = useCallback(() => {
    if (!pending) return;
    applyRef.current(pending.review.fields);
    setPending(null);
    setNotice(
      pending.review.kind === 'changes'
        ? { kind: 'ok', text: `${pending.review.changes.length} campo(s) atualizado(s) pela Receita.` }
        : filledNotice(pending.inactiveStatus)
    );
  }, [pending]);

  const dismissPending = useCallback(() => {
    setPending(null);
    setNotice({ kind: 'info', text: 'Mantidos os dados digitados; nada foi trocado pela Receita.' });
  }, []);

  return { loading, notice, pending, clearNotice, acceptPending, dismissPending, lookup };
}
