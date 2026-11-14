'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CNPJLookupResult } from '@/lib/cnpj';
import { reviewLookup, type ClientFormFields, type LookupReview } from '@/lib/cnpj-review';
import { useAuth } from '@/contexts/AuthContext';

export interface LookupNotice {
  kind: 'ok' | 'warn' | 'info';
  text: string;
}

/** Resposta da Receita que pede confirmação antes de mexer nos campos digitados. */
export interface PendingLookup {
  review: Extract<LookupReview, { kind: 'other-company' | 'changes' }>;
  /** Situação cadastral fora de "ATIVA", para mostrar junto da pergunta. */
  inactiveStatus: string | null;
  /** Resposta completa (cartão CNPJ, QSA e endereço). */
  data: CNPJLookupResult;
  /** O cartão, o QSA e o endereço já foram aplicados (atualização da mesma empresa). */
  cardApplied: boolean;
}

/**
 * Como aplicar o cartão: `replace` troca endereço, cartão e QSA pelos da Receita ("Atualizar
 * pela Receita"); `fill-empty` (CNPJ novo digitado) só preenche o endereço se estiver vazio.
 */
export type CardMode = 'replace' | 'fill-empty';

interface Options {
  /** CNPJ digitado, já sem máscara. */
  cnpj: string;
  /** Se o CNPJ está completo e com dígitos verificadores certos. */
  valid: boolean;
  /** CNPJ já gravado da empresa em edição: não é consultado de novo sozinho. */
  savedCnpj: string | null;
  /** Valores atuais do formulário, para comparar com a Receita. */
  getForm: () => ClientFormFields;
  /** Grava no formulário os campos digitáveis aceitos. */
  apply: (fields: Partial<ClientFormFields>) => void;
  /** Grava o endereço, o cartão CNPJ e o QSA, que espelham a Receita. */
  applyCard: (data: CNPJLookupResult, mode: CardMode) => void;
}

const inactiveOf = (data: CNPJLookupResult): string | null => {
  const sit = data.situacaoCadastral;
  return sit && sit.toUpperCase() !== 'ATIVA' ? sit : null;
};

/** O que veio além dos campos simples, para o aviso: "endereço com CEP, CNAE principal e 3 secundários, 2 sócios". */
export function describeCard(data: CNPJLookupResult): string | null {
  const parts: string[] = [];
  if (data.address) parts.push(data.address.cep ? 'endereço com CEP' : 'endereço');
  const main = data.registration?.mainActivity;
  const secondary = data.registration?.secondaryActivities?.length ?? 0;
  if (main) parts.push(secondary ? `CNAE principal e ${secondary} secundário(s)` : 'CNAE principal');
  if (data.partners?.length) parts.push(`${data.partners.length} sócio(s) no QSA`);
  if (data.registration?.status) parts.push(`situação ${data.registration.status}`);
  return parts.length ? parts.join(', ') : null;
}

const withInactive = (text: string, inactive: string | null): LookupNotice =>
  inactive ? { kind: 'warn', text: `${text} · Atenção: situação cadastral "${inactive}" na Receita Federal.` } : { kind: 'ok', text };

/**
 * Consulta do cadastro público do CNPJ pela rota `/api/cnpj`. Dispara sozinha quando um CNPJ
 * novo fica completo e válido; `lookup(cnpj, true)` é o "Atualizar pela Receita", que traz tudo:
 * endereço, cartão CNPJ e QSA são aplicados na hora, e só os campos digitados que mudam passam
 * por confirmação (`reviewLookup`). Se o CNPJ parece de outra empresa, nada muda até decidir.
 */
export function useCnpjLookup({ cnpj, valid, savedCnpj, getForm, apply, applyCard }: Options) {
  const { user, isMockAuth } = useAuth();
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<LookupNotice | null>(null);
  const [pending, setPending] = useState<PendingLookup | null>(null);
  const lastAutoQueriedRef = useRef<string | null>(savedCnpj);
  const abortRef = useRef<AbortController | null>(null);
  const getFormRef = useRef(getForm);
  const applyRef = useRef(apply);
  const applyCardRef = useRef(applyCard);

  useEffect(() => {
    getFormRef.current = getForm;
    applyRef.current = apply;
    applyCardRef.current = applyCard;
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
        // `cache: no-store`: nunca a resposta guardada pelo navegador; `atualizar=1`: nem a do servidor.
        const response = await fetch(`/api/cnpj/${encodeURIComponent(targetCnpj)}${overwrite ? '?atualizar=1' : ''}`, {
          signal: controller.signal,
          cache: 'no-store',
          ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          setNotice({ kind: 'info', text: body?.error || 'Consulta automática indisponível — preencha os campos manualmente.' });
          return;
        }

        const data = (await response.json()) as CNPJLookupResult;
        const inactive = inactiveOf(data);
        const card = describeCard(data);
        const review = reviewLookup(getFormRef.current(), data, overwrite);
        const otherCompany = review.kind === 'other-company' || (review.kind === 'changes' && review.otherCompany);

        // Atualização da mesma empresa: endereço, cartão e QSA vêm inteiros, sem perguntar.
        const cardApplied = overwrite && !otherCompany;
        if (cardApplied) applyCardRef.current(data, 'replace');

        if (review.kind === 'apply') {
          applyRef.current(review.fields);
          applyCardRef.current(data, 'fill-empty');
          setNotice(withInactive(`Dados preenchidos pela Receita${card ? ` (${card})` : ''}.`, inactive));
        } else if (review.kind === 'unchanged') {
          setNotice(withInactive(`Atualizado pela Receita${card ? `: ${card}` : ''}. Os demais campos já estavam iguais.`, inactive));
        } else {
          if (cardApplied) setNotice(withInactive(`Atualizado pela Receita${card ? `: ${card}` : ''}. Confira abaixo os campos digitados que mudam.`, inactive));
          setPending({ review, inactiveStatus: inactive, data, cardApplied });
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
    if (!pending.cardApplied) applyCardRef.current(pending.data, 'replace');
    setPending(null);
    const card = describeCard(pending.data);
    setNotice(
      pending.review.kind === 'changes'
        ? { kind: 'ok', text: `${pending.review.changes.length} campo(s) atualizado(s) pela Receita${card ? `, com ${card}` : ''}.` }
        : withInactive(`Dados preenchidos pela Receita${card ? ` (${card})` : ''}.`, pending.inactiveStatus)
    );
  }, [pending]);

  const dismissPending = useCallback(() => {
    const cardApplied = pending?.cardApplied;
    setPending(null);
    setNotice({
      kind: 'info',
      text: cardApplied
        ? 'Mantidos os campos digitados; endereço, cartão CNPJ e QSA foram atualizados pela Receita.'
        : 'Mantidos os dados digitados; nada foi trocado pela Receita.',
    });
  }, [pending]);

  return { loading, notice, pending, clearNotice, acceptPending, dismissPending, lookup };
}
