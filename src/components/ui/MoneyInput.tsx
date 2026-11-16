'use client';

import { useState } from 'react';
import { parseMoneyInput } from '@/lib/opening';
import { toCents } from '@/lib/money';

const BRL = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Centavos → texto do campo ("1.234,56"); vazio quando zero. */
export const centsToText = (cents: number): string => (cents === 0 ? '' : BRL.format(cents / 100));

interface MoneyInputProps {
  /** Valor em centavos (0 = campo vazio). */
  cents: number;
  onChange: (cents: number) => void;
  /** Nome acessível do campo. */
  label: string;
  disabled?: boolean;
  placeholder?: string;
  /** Classes do campo (altura, borda, cor do texto). O alinhamento à direita e a fonte já vêm. */
  className?: string;
  /** Mostra "R$" à esquerda, dentro do campo. */
  prefix?: boolean;
  onEnter?: () => void;
}

/**
 * Campo de valor do sistema: digita-se o valor como ele é ("1500", "1.500,00", "1500,5") e, ao
 * sair do campo, ele aparece formatado ("1.500,00"). É o mesmo jeito da abertura, da folha, do
 * estoque e das aplicações: nenhum campo trata os dígitos como centavos entrando pela direita,
 * então colar ou digitar "1500" dá sempre mil e quinhentos reais. Só aceita dígitos, ponto e
 * vírgula; valores negativos não entram (o lado do lançamento diz o sinal).
 */
export function MoneyInput({ cents, onChange, label, disabled = false, placeholder = '0,00', className = '', prefix = false, onEnter }: MoneyInputProps) {
  /** Texto enquanto o campo está em edição; null fora dela (mostra o valor formatado). */
  const [draft, setDraft] = useState<string | null>(null);

  const input = (
    <input
      aria-label={label}
      inputMode="decimal"
      autoComplete="off"
      disabled={disabled}
      value={draft ?? centsToText(cents)}
      placeholder={placeholder}
      onFocus={(e) => {
        setDraft(centsToText(cents));
        // Seleciona tudo: digitar por cima troca o valor em vez de emendar nele. Só com valor no
        // campo, e só se nada foi digitado antes do quadro seguinte (senão apagaria o começo).
        const el = e.currentTarget;
        const initial = el.value;
        if (initial) requestAnimationFrame(() => document.activeElement === el && el.value === initial && el.select());
      }}
      onChange={(e) => {
        const text = e.target.value.replace(/[^\d.,]/g, '').slice(0, 18);
        setDraft(text);
        const value = parseMoneyInput(text);
        if (value !== null) onChange(toCents(value));
      }}
      onBlur={() => setDraft(null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          setDraft(null);
          onEnter?.();
        }
      }}
      className={`w-full text-right font-mono tabular-nums outline-none ${prefix ? 'pl-9' : ''} ${className}`}
    />
  );

  if (!prefix) return input;
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[12px] text-stone-500 dark:text-stone-400 pointer-events-none">R$</span>
      {input}
    </div>
  );
}
