import { useEffect, useRef } from "react";

/**
 * Keyboard review over the rendered rows: j/k move (arrows too, once a row has focus),
 * Space toggles the focused row, e opens it, Cmd/Ctrl+Enter applies.
 * Returns the ref list each rendered row registers itself in, by position.
 */
export function useReviewKeyboard({
  enabled,
  keys,
  onToggle,
  onExpand,
  onApply,
}: {
  enabled: boolean;
  /** Item keys of the rows on screen, in order. */
  keys: string[];
  onToggle: (key: string) => void;
  onExpand: (key: string) => void;
  onApply: () => void;
}) {
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  // Last row the keyboard or a click landed on; -1 so the first j goes to the first row.
  const last = useRef(-1);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const row = t.closest<HTMLDivElement>("[data-review-row]");
      if (!row && t.closest("input, textarea, select, [contenteditable]")) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        onApply();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const rows = rowRefs.current.slice(0, keys.length);
      const at = row ? rows.indexOf(row) : -1;
      if (at !== -1) last.current = at;
      const move = (d: number) => {
        e.preventDefault();
        const from = at !== -1 ? at : Math.min(last.current, keys.length - 1);
        const next = from === -1 ? 0 : Math.max(0, Math.min(keys.length - 1, from + d));
        last.current = next;
        rows[next]?.focus();
      };

      if (e.key === "j" || (row && e.key === "ArrowDown")) move(1);
      else if (e.key === "k" || (row && e.key === "ArrowUp")) move(-1);
      // Only on the row itself: Space on the checkbox or the chevron keeps its native meaning.
      else if (e.key === " " && t === row && at !== -1) {
        e.preventDefault();
        onToggle(keys[at]!);
      } else if (e.key === "e" && at !== -1) onExpand(keys[at]!);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, keys, onToggle, onExpand, onApply]);

  return rowRefs;
}
