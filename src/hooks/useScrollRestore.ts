import { useCallback, useEffect, useRef } from "react";

/**
 * Preserve the window scroll position across a dialog/drawer open→close cycle.
 *
 * Radix dialogs lock body scroll while open; on some browsers (notably mobile)
 * the page jumps back to the top once the dialog closes. This hook captures the
 * scroll position right before opening (call the returned `save()` in the click
 * handler) and restores it after the dialog closes and the list re-renders.
 */
export function useScrollRestore(open: boolean) {
  const yRef = useRef(0);
  const prevOpen = useRef(open);

  const save = useCallback(() => {
    yRef.current = window.scrollY;
  }, []);

  useEffect(() => {
    // Closed transition: restore where the user was.
    if (prevOpen.current && !open) {
      const y = yRef.current;
      if (y > 0) {
        // Restore across multiple frames to survive late re-renders (data reload).
        requestAnimationFrame(() => {
          requestAnimationFrame(() => window.scrollTo(0, y));
        });
        window.setTimeout(() => window.scrollTo(0, y), 150);
        window.setTimeout(() => window.scrollTo(0, y), 350);
      }
    }
    prevOpen.current = open;
  }, [open]);

  return save;
}
