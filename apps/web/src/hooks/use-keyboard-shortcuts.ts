import { useEffect } from "react";

interface Shortcut {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  handler: () => void;
}

export function useKeyboardShortcuts(shortcuts: Shortcut[]) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      for (const shortcut of shortcuts) {
        const metaMatch =
          shortcut.metaKey === undefined
            ? e.metaKey || e.ctrlKey
            : shortcut.metaKey
              ? e.metaKey
              : true;
        const ctrlMatch =
          shortcut.ctrlKey === undefined
            ? true
            : shortcut.ctrlKey
              ? e.ctrlKey
              : true;
        const shiftMatch =
          shortcut.shiftKey === undefined
            ? true
            : shortcut.shiftKey === e.shiftKey;

        if (e.key === shortcut.key && metaMatch && ctrlMatch && shiftMatch) {
          e.preventDefault();
          shortcut.handler();
          return;
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [shortcuts]);
}
