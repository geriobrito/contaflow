'use client';

import Link from 'next/link';
import { Compass } from 'lucide-react';
import { BUTTON, EmptyState, PAGE, SURFACE } from '@/components/ui/primitives';

/** Endereço que não existe: explica e leva de volta ao trabalho, no lugar da página 404 padrão (em inglês). */
export default function NotFound() {
  return (
    <main className={PAGE}>
      <section className={`${SURFACE} rounded-[22px]`}>
        <EmptyState
          icon={Compass}
          title="Esta página não existe"
          description="O endereço pode ter mudado ou sido digitado errado. Use o menu, a busca rápida (Ctrl+K) ou volte ao Painel."
          action={
            <Link href="/painel" className={BUTTON.primary}>
              Ir para o Painel
            </Link>
          }
        />
      </section>
    </main>
  );
}
