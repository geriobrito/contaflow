
const SIZES = {
  sm: { box: 'w-6 h-6 rounded-[8px]', glyph: 'w-[17px] h-[17px]' },
  md: { box: 'w-8 h-8 rounded-[10px]', glyph: 'w-[22px] h-[22px]' },
  lg: { box: 'w-10 h-10 rounded-[13px]', glyph: 'w-7 h-7' },
  xl: { box: 'w-14 h-14 rounded-[18px]', glyph: 'w-10 h-10' },
} as const;

/** Símbolo do ContaFlow: o "C" de conta com o visto de conferido saindo pela abertura (mesmo traço de src/app/icon.svg). */
export function BrandGlyph({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="4 4 24 24" fill="none" stroke="currentColor" strokeWidth={2.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      <path d="M17.6 8.3A8 8 0 1 0 21.2 21.9" />
      <path d="M12.4 15.9l3.3 3.3 8.4-8.9" />
    </svg>
  );
}

/** Selo da marca: o símbolo sobre o quadrado em terracota. */
export function BrandMark({ size = 'md', className = '' }: { size?: keyof typeof SIZES; className?: string }) {
  const s = SIZES[size];
  return (
    <span
      className={`${s.box} shrink-0 inline-flex items-center justify-center text-white bg-linear-to-br from-[#E08A66] via-[#BF5B33] to-[#963F1C] shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_1px_2px_rgba(124,52,24,0.35),0_6px_14px_-6px_rgba(181,85,47,0.6)] ${className}`}
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
