'use client';

import { useEffect, useState } from 'react';

/** Aviso curto no rodapé; some sozinho depois de `durationMs`. */
export function useToast(durationMs = 3200): [string | null, (message: string | null) => void] {
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), durationMs);
    return () => clearTimeout(t);
  }, [toast, durationMs]);
  return [toast, setToast];
}

export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      role="status"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-full bg-stone-900/90 dark:bg-stone-100/90 text-white dark:text-stone-900 text-[13px] tracking-tight shadow-[0_8px_24px_rgba(0,0,0,0.18)] backdrop-blur-xl animate-sheet-in"
    >
      {message}
    </div>
  );
}
