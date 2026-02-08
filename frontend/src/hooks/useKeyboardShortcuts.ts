import { useEffect, useCallback } from 'react';

type ShortcutHandler = (e: KeyboardEvent) => void;

interface Shortcut {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  handler: ShortcutHandler;
  description: string;
}

interface UseKeyboardShortcutsOptions {
  shortcuts: Shortcut[];
  enabled?: boolean;
}

/**
 * Hook for managing keyboard shortcuts
 * 
 * Usage:
 * ```ts
 * useKeyboardShortcuts({
 *   shortcuts: [
 *     { key: 'k', ctrl: true, handler: openSearch, description: 'Open search' },
 *     { key: 'Enter', ctrl: true, handler: submitQuery, description: 'Submit query' },
 *   ]
 * });
 * ```
 */
export function useKeyboardShortcuts({ shortcuts, enabled = true }: UseKeyboardShortcutsOptions) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!enabled) return;

    // Don't trigger shortcuts when typing in inputs (unless it's a global shortcut with ctrl/cmd)
    const target = e.target as HTMLElement;
    const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

    for (const shortcut of shortcuts) {
      const ctrlOrMeta = e.ctrlKey || e.metaKey;
      const matchesCtrl = shortcut.ctrl ? ctrlOrMeta : !ctrlOrMeta;
      const matchesShift = shortcut.shift ? e.shiftKey : !e.shiftKey;
      const matchesAlt = shortcut.alt ? e.altKey : !e.altKey;
      const matchesKey = e.key.toLowerCase() === shortcut.key.toLowerCase();

      if (matchesKey && matchesCtrl && matchesShift && matchesAlt) {
        // Skip non-ctrl shortcuts when in input
        if (isInput && !shortcut.ctrl) continue;

        e.preventDefault();
        shortcut.handler(e);
        break;
      }
    }
  }, [shortcuts, enabled]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}

// Common shortcuts registry for displaying in help modal
export const COMMON_SHORTCUTS = [
  { key: 'k', ctrl: true, description: 'Focus search / query input' },
  { key: 'Enter', ctrl: true, description: 'Submit query' },
  { key: 'Escape', description: 'Close modal / clear search' },
  { key: '?', shift: true, description: 'Show keyboard shortcuts help' },
] as const;

/**
 * Hook for Ctrl+K to focus an element
 */
export function useFocusShortcut(ref: React.RefObject<HTMLElement | null>, key = 'k') {
  useKeyboardShortcuts({
    shortcuts: [
      {
        key,
        ctrl: true,
        handler: () => {
          ref.current?.focus();
        },
        description: 'Focus element',
      },
    ],
  });
}

/**
 * Hook for Escape to call a handler
 */
export function useEscapeKey(handler: () => void, enabled = true) {
  useKeyboardShortcuts({
    shortcuts: [
      {
        key: 'Escape',
        handler,
        description: 'Close/cancel',
      },
    ],
    enabled,
  });
}
