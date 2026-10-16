import { PAGE, SURFACE } from '@/components/ui/primitives';
import { Skeleton, TableSkeleton } from '@/components/ui/Skeleton';

/** Esqueleto exibido enquanto a tela de destino carrega, no lugar de uma área em branco. */
export default function Loading() {
  return (
    <main className={PAGE} aria-busy="true" aria-label="Carregando">
      <div className="space-y-2">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-8 w-72 max-w-full rounded-lg" />
      </div>
      <section className={`${SURFACE} rounded-[22px] overflow-hidden`}>
        <TableSkeleton rows={6} />
      </section>
    </main>
  );
}
