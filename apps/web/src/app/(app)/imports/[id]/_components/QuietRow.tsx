/** An unchanged, duplicate or rejected row: shown dimmed, nothing to approve. */
export function QuietRow({ title, when, text, tone }: { title: string; when: string; text: string; tone?: "error" }) {
  return (
    <li className="flex gap-3.5 border-b border-line py-3.5 text-[13px]">
      <input type="checkbox" disabled aria-hidden tabIndex={-1} className="mt-0.5 size-4 rounded opacity-30" />
      <div className="min-w-0 flex-1">
        <p className="text-ink-3">
          <span className={`font-semibold ${tone === "error" ? "text-remove" : ""}`}>{title}</span>
          {when && <span className="tnum ml-2">{when}</span>}
        </p>
        <p className="mt-0.5 text-pretty text-ink-3">{text}</p>
      </div>
    </li>
  );
}
