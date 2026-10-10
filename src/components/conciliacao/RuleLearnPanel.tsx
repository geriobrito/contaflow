'use client';

import React from 'react';
import { AlertTriangle } from 'lucide-react';
import type { RuleMatchType } from '@/types/firestore';
import type { TermAssessment } from '@/lib/payee';
import { IOSSwitch, SegmentedControl } from '@/components/ui/primitives';

export const MATCH_OPTIONS: readonly { value: RuleMatchType; label: string }[] = [
  { value: 'CONTAINS', label: 'Contém' },
  { value: 'STARTS_WITH', label: 'Começa com' },
  { value: 'EXACT', label: 'É exatamente' },
];

/** Mesmo termo para a regra (a comparação ignora maiúsculas e espaços extras). */
const sameTerm = (a: string, b: string) => a.toLowerCase().replace(/\s+/g, ' ').trim() === b.toLowerCase().replace(/\s+/g, ' ').trim();

interface RuleLearnPanelProps {
  checked: boolean;
  onChecked: (v: boolean) => void;
  title: string;
  subtitle: string;
  term: string;
  onTerm: (v: string) => void;
  matchType: RuleMatchType;
  onMatchType: (v: RuleMatchType) => void;
  /** Avaliação do termo contra as descrições carregadas. */
  assessment: TermAssessment;
  /** Termo genérico: só salva depois de "Criar mesmo assim". */
  acknowledged: boolean;
  onAcknowledged: (v: boolean) => void;
  /** Aviso extra (ex.: "É exatamente" não casaria este lançamento). */
  note?: React.ReactNode;
  /** Sugestão de termo (favorecido), para voltar a ela com um toque. */
  suggestion?: string;
  /** Sugestão pela descrição do lançamento (como aparece na lista). */
  memoSuggestion?: string;
}

/** Bloco "Lembrar essa classificação": termo, tipo de comparação e avisos de termo genérico ou amplo. */
export function RuleLearnPanel({
  checked,
  onChecked,
  title,
  subtitle,
  term,
  onTerm,
  matchType,
  onMatchType,
  assessment,
  acknowledged,
  onAcknowledged,
  note,
  suggestion,
  memoSuggestion,
}: RuleLearnPanelProps) {
  return (
    <section className="rounded-2xl bg-white dark:bg-stone-800/60 border border-black/[0.06] dark:border-white/[0.06] overflow-hidden">
      <label htmlFor="learn-rule" className="flex items-center gap-4 px-4 py-3 cursor-pointer">
        <span className="flex-1 min-w-0">
          <span className="block text-[14px] tracking-tight text-stone-900 dark:text-stone-100">{title}</span>
          <span className="block text-[12px] text-stone-500">{subtitle}</span>
        </span>
        <IOSSwitch id="learn-rule" checked={checked} onChange={onChecked} />
      </label>
      {checked && (
        <div className="border-t border-black/[0.04] dark:border-white/[0.06] px-4 py-3 animate-fade-in">
          <label htmlFor="pattern" className="block text-[12px] text-stone-500 mb-1">
            Termo a memorizar
          </label>
          <input
            id="pattern"
            value={term}
            onChange={(e) => onTerm(e.target.value)}
            placeholder="ex.: nome do favorecido"
            aria-invalid={assessment.level === 'generic'}
            className="w-full bg-transparent font-mono text-[13px] text-stone-900 dark:text-stone-100 placeholder:text-stone-400 outline-none"
          />
          {memoSuggestion && !sameTerm(memoSuggestion, term) && (
            <button type="button" onClick={() => onTerm(memoSuggestion)} className="mt-1 mr-3 text-[11px] text-[#0071E3] hover:underline text-left">
              Usar a descrição: {memoSuggestion}
            </button>
          )}
          {suggestion && !sameTerm(suggestion, term) && !(memoSuggestion && sameTerm(suggestion, memoSuggestion)) && (
            <button type="button" onClick={() => onTerm(suggestion)} className="mt-1 text-[11px] text-[#0071E3] hover:underline text-left">
              Usar só o favorecido: {suggestion}
            </button>
          )}
          <div className="mt-2.5 overflow-x-auto">
            <SegmentedControl ariaLabel="Tipo de comparação" value={matchType} onChange={onMatchType} options={MATCH_OPTIONS} />
          </div>
          {note}
          <TermWarning assessment={assessment} acknowledged={acknowledged} onAcknowledged={onAcknowledged} />
        </div>
      )}
    </section>
  );
}

/**
 * Aviso de termo genérico (vermelho, exige "Criar mesmo assim") ou amplo (âmbar). Não mostra nada
 * quando o termo é específico.
 */
export function TermWarning({
  assessment,
  acknowledged,
  onAcknowledged,
  className = 'mt-3',
}: {
  assessment: TermAssessment;
  acknowledged: boolean;
  onAcknowledged: (v: boolean) => void;
  className?: string;
}) {
  if (assessment.level === 'ok') return null;
  const generic = assessment.level === 'generic';
  return (
    <div
      role="alert"
      className={`${className} rounded-xl px-3 py-2.5 text-[12px] leading-snug border ${
        generic
          ? 'bg-rose-50 dark:bg-rose-950/30 border-rose-200/70 text-rose-800 dark:text-rose-300'
          : 'bg-amber-50 dark:bg-amber-950/30 border-amber-200/70 text-amber-800 dark:text-amber-300'
      }`}
    >
      <p className="flex items-start gap-1.5 font-medium">
        <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />
        {generic ? 'Termo genérico demais' : 'Termo amplo'}
      </p>
      <ul className="mt-1 ml-5 list-disc space-y-0.5">
        {assessment.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      <p className="mt-1 ml-5">
        {generic
          ? 'Esta regra classificaria lançamentos sem relação entre si na mesma conta. Prefira o nome do favorecido.'
          : 'Confira se todos esses favorecidos vão para a mesma conta.'}
      </p>
      {generic && (
        <label className="mt-2 ml-5 flex items-center gap-2 font-medium cursor-pointer">
          <input type="checkbox" checked={acknowledged} onChange={(e) => onAcknowledged(e.target.checked)} />
          Criar mesmo assim
        </label>
      )}
    </div>
  );
}
