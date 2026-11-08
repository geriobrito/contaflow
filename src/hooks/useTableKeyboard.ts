import { useEffect, useState } from 'react';

export interface UseTableKeyboardOptions<T> {
  items: readonly T[];
  getId: (item: T) => string;
  onOpenClassify?: (item: T) => void;
  onOpenSplit?: (item: T) => void;
  onOpenInvoice?: (item: T) => void;
  onToggleSelect?: (id: string) => void;
  onToggleSelectAll?: () => void;
  onApprove?: (item: T) => void;
  onPrevPage?: () => void;
  onNextPage?: () => void;
  onClearSelection?: () => void;
  onFocusSearch?: () => void;
  onToggleHelp?: () => void;
  disabled?: boolean;
}

export function isInputElement(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  return Boolean((el as HTMLElement).isContentEditable);
}

export function useTableKeyboard<T>({
  items,
  getId,
  onOpenClassify,
  onOpenSplit,
  onOpenInvoice,
  onToggleSelect,
  onToggleSelectAll,
  onApprove,
  onPrevPage,
  onNextPage,
  onClearSelection,
  onFocusSearch,
  onToggleHelp,
  disabled = false,
}: UseTableKeyboardOptions<T>) {
  const [rawIndex, setFocusedIndex] = useState<number>(-1);
  const focusedIndex = items.length === 0 ? -1 : Math.min(Math.max(-1, rawIndex), items.length - 1);

  const focusedItem = focusedIndex >= 0 && focusedIndex < items.length ? items[focusedIndex] : null;
  const focusedId = focusedItem ? getId(focusedItem) : null;

  useEffect(() => {
    if (!focusedId || typeof document === 'undefined') return;
    const row = document.getElementById(`row-tx-${focusedId}`);
    row?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [focusedId]);

  useEffect(() => {
    if (disabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Combinações com Ctrl/⌘/Alt são de outros atalhos (ex.: Ctrl+K abre a busca rápida, não sobe a linha).
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // Ignora se estiver digitando em campo de texto
      if (isInputElement(document.activeElement)) {
        if (e.key === 'Escape') {
          (document.activeElement as HTMLElement)?.blur();
          onClearSelection?.();
        }
        return;
      }

      // Atalho de foco na busca
      if (e.key === '/') {
        e.preventDefault();
        onFocusSearch?.();
        return;
      }

      // Atalho de ajuda
      if (e.key === '?') {
        e.preventDefault();
        onToggleHelp?.();
        return;
      }

      // Paginação rápida
      if (e.key === '[') {
        e.preventDefault();
        onPrevPage?.();
        return;
      }

      if (e.key === ']') {
        e.preventDefault();
        onNextPage?.();
        return;
      }

      if (items.length === 0) return;

      // Selecionar todos da página
      if ((e.shiftKey && (e.key === 'x' || e.key === 'X')) || e.key === '*') {
        e.preventDefault();
        onToggleSelectAll?.();
        return;
      }

      if (e.key === 'ArrowDown' || e.key === 'j' || e.key === 'J') {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const next = prev < 0 ? 0 : Math.min(items.length - 1, prev + 1);
          return next;
        });
        return;
      }

      if (e.key === 'ArrowUp' || e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const next = prev <= 0 ? 0 : prev - 1;
          return next;
        });
        return;
      }

      // Ações no item focado
      if (focusedIndex >= 0 && focusedIndex < items.length) {
        const item = items[focusedIndex];
        const id = getId(item);

        if (e.key === 'Enter' || e.key === 'c' || e.key === 'C') {
          e.preventDefault();
          onOpenClassify?.(item);
          return;
        }

        if (e.key === 's' || e.key === 'S') {
          e.preventDefault();
          onOpenSplit?.(item);
          return;
        }

        if (e.key === 'v' || e.key === 'V' || e.key === 'n' || e.key === 'N') {
          e.preventDefault();
          onOpenInvoice?.(item);
          return;
        }

        if (e.key === ' ' || e.key === 'x' || e.key === 'X') {
          e.preventDefault();
          onToggleSelect?.(id);
          return;
        }

        if (e.key === 'a' || e.key === 'A') {
          e.preventDefault();
          onApprove?.(item);
          return;
        }
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        onClearSelection?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    items,
    focusedIndex,
    getId,
    onOpenClassify,
    onOpenSplit,
    onOpenInvoice,
    onToggleSelect,
    onToggleSelectAll,
    onApprove,
    onPrevPage,
    onNextPage,
    onClearSelection,
    onFocusSearch,
    onToggleHelp,
    disabled,
  ]);

  return {
    focusedIndex,
    focusedId,
    setFocusedIndex,
  };
}
