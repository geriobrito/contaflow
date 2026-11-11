import React from 'react';

const SIZES = {
  sm: { box: 'w-6 h-6 rounded-[8px]', glyph: 'w-[15px] h-[15px]' },
  md: { box: 'w-8 h-8 rounded-[10px]', glyph: 'w-5 h-5' },
  lg: { box: 'w-10 h-10 rounded-[13px]', glyph: 'w-6 h-6' },
} as const;

/** Símbolo do ContaFlow: o "C" que abraça um sinal de igual (débito = crédito). */
export function BrandGlyph({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden className={className}>
      <path d="M17.6 7.1A7.4 7.4 0 1 0 17.6 16.9" />
      <path d="M12.4 10.1h6.4M12.4 13.9h6.4" />
    </svg>
  );
}

/** Selo da marca: o símbolo sobre o quadrado em terracota. */
export function BrandMark({ size = 'md', className = '' }: { size?: keyof typeof SIZES; className?: string }) {
  const s = SIZES[size];
  return (
    <span
      className={`${s.box} shrink-0 inline-flex items-center justify-center text-white bg-linear-to-br from-[#D97757] to-[#A9481F] shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_1px_2px_rgba(124,52,24,0.35),0_6px_14px_-6px_rgba(181,85,47,0.6)] ${className}`}
    >
      <BrandGlyph className={s.glyph} />
    </span>
  );
}

/** Marca completa: selo e nome. */
export function Brand({ size = 'md', className = '' }: { size?: keyof typeof SIZES; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <BrandMark size={size} />
      <span className={`${size === 'sm' ? 'text-[15px]' : 'text-[17px]'} font-semibold tracking-tight`}>
        Conta<span className="text-accent-ink">Flow</span>
      </span>
    </span>
  );
}
