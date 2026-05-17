import { useEffect, useRef } from "react";

const PREFIX = "form_draft_v1::";

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (typeof v === "number") return v === 0;
  if (typeof v === "boolean") return v === false;
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

function hasMeaningfulData(form: Record<string, unknown>): boolean {
  return Object.values(form).some((v) => !isEmpty(v));
}

/**
 * Auto-save form draft to localStorage with debounce.
 * Restores on mount. Call clear() after successful submit.
 *
 * @param key   Stable storage key (e.g. "action-board:tickets")
 * @param form  Current form state
 * @param setForm  Setter to restore the draft
 * @param enabled  Disable when editing existing record
 */
export function useFormDraft(
  key: string,
  form: Record<string, unknown>,
  setForm: (next: Record<string, unknown>) => void,
  enabled = true,
) {
  const storageKey = PREFIX + key;
  const restoredRef = useRef(false);
  const formRef = useRef(form);
  formRef.current = form;

  // Restore on mount (and when key changes)
  useEffect(() => {
    if (!enabled) return;
    restoredRef.current = false;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const draft = JSON.parse(raw) as Record<string, unknown>;
        if (draft && typeof draft === "object" && hasMeaningfulData(draft)) {
          setForm({ ...formRef.current, ...draft });
        }
      }
    } catch { /* ignore */ }
    restoredRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, enabled]);

  // Debounced save on change
  useEffect(() => {
    if (!enabled || !restoredRef.current) return;
    const t = window.setTimeout(() => {
      try {
        if (hasMeaningfulData(form)) {
          localStorage.setItem(storageKey, JSON.stringify(form));
        } else {
          localStorage.removeItem(storageKey);
        }
      } catch { /* quota */ }
    }, 300);
    return () => window.clearTimeout(t);
  }, [form, storageKey, enabled]);

  const clear = () => {
    try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
  };

  return { clear };
}
