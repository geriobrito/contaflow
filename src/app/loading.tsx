import { PAGE, SURFACE } from '@/components/ui/primitives';

/** Esqueleto exibido enquanto a tela de destino carrega, no lugar de uma área em branco. */
export default function Loading() {
  return (
    <main className={PAGE} aria-busy="true" aria-label="Carregando">
      <div className="space-y-2">
        <div className="h-3 w-32 rounded bg-black/[0.06] dark:bg-white/[0.08] animate-pulse" />
        <div className="h-8 w-72 max-w-full rounded-lg bg-black/[0.06] dark:bg-white/[0.08] animate-pulse" />
      </div>
      <section className={`${SURFACE} rounded-[22px] p-5 space-y-4`}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4">
            <div className="h-3 w-16 rounded bg-black/[0.05] dark:bg-white/[0.07] animate-pulse" />
            <div className="h-3 flex-1 rounded bg-black/[0.05] dark:bg-white/[0.07] animate-pulse" />
            <div className="h-3 w-20 rounded bg-black/[0.05] dark:bg-white/[0.07] animate-pulse" />
          </div>
        ))}
      </section>
    </main>
  );
}
