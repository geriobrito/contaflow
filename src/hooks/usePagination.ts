'use client';

import { useState } from 'react';

/**
 * Paginação em memória. Volta à primeira página sempre que `resetKey` muda (filtro, busca,
 * período, cliente) e nunca aponta além da última, mesmo se a lista encolher.
 */
export function usePagination<T>(items: readonly T[], pageSize: number, resetKey: string) {
  const [page, setPage] = useState(0);
  const [lastKey, setLastKey] = useState(resetKey);
  if (lastKey !== resetKey) {
    setLastKey(resetKey);
    setPage(0);
  }
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const rows = items.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  return { currentPage, pageCount, rows, setPage };
}
