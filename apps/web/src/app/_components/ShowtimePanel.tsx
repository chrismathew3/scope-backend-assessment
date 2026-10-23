"use client";

import {
  fromZonedFields,
  MOVIE_STATUSES,
  type MovieStatus,
  SHOWTIME_STATUSES,
  ShowtimeCreateInput,
  type ShowtimeRow,
  type ShowtimeStatus,
  ShowtimeUpdateInput,
  toZonedFields,
} from "@scope/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { movieStatusLabel, statusLabel } from "~/lib/labels";
import { errorMessage, httpStatusOf, useTRPC } from "~/lib/trpc";
import { button, field, selectField } from "~/lib/ui";
import type { TheaterOption } from "./AppShell";

type AdminRow = Extract<ShowtimeRow, { access: "admin" }>;

export type ShowtimePanelMode = { kind: "edit"; row: AdminRow } | { kind: "new"; theaterId?: string };

export interface Suggestions {
  auditoriums: string[];
  formats: string[];
  languages: string[];
  ratings: string[];
}

interface FormState {
  theaterId: string;
  movieTitle: string;
  auditorium: string;
  date: string;
  start: string;
  end: string;
  language: string;
  format: string;
  rating: string;
  movieStatus: MovieStatus;
  status: ShowtimeStatus;
}

function fromRow(row: AdminRow, timeZone: string): FormState {
  const start = toZonedFields(row.startTime, timeZone);
  return {
    theaterId: row.theaterId,
    movieTitle: row.movieTitle,
    auditorium: row.auditorium,
    date: start.date,
    start: start.time,
    end: toZonedFields(row.endTime, timeZone).time,
    language: row.language,
    format: row.format,
    rating: row.rating,
    movieStatus: row.movieStatus,
    status: row.status,
  };
}

function blank(theaterId: string, timeZone: string): FormState {
  return {
    theaterId,
    movieTitle: "",
    auditorium: "",
    date: toZonedFields(new Date().toISOString(), timeZone).date,
    start: "",
    end: "",
    language: "EN",
    format: "2D",
    rating: "",
    movieStatus: "needs-review",
    status: "active",
  };
}

/** "Eastern Time", falling back to the IANA name. */
function zoneName(timeZone: string) {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longGeneric" })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName");
    return part?.value ?? timeZone;
  } catch {
    return timeZone;
  }
}

/**
 * Side panel (full screen on phones) for adding or editing one showtime.
 * Times are typed in the theater's own timezone; an end earlier than the start
 * means the show runs past midnight.
 */
export function ShowtimePanel({
  mode,
  adminTheaters,
  suggestions,
  onClose,
  onSaved,
  returnFocusTo,
}: {
  mode: ShowtimePanelMode;
  adminTheaters: TheaterOption[];
  suggestions: Suggestions;
  /** Where focus goes back to on close (row clicks open the panel without focusing anything). */
  returnFocusTo?: HTMLElement | null;
  onClose: () => void;
  onSaved: (row: AdminRow, created: boolean) => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const ids = useId();
  const tzOf = useMemo(() => Object.fromEntries(adminTheaters.map((t) => [t.id, t.timezone])), [adminTheaters]);

  const [base, setBase] = useState<AdminRow | null>(mode.kind === "edit" ? mode.row : null);
  const [form, setForm] = useState<FormState>(() => {
    if (mode.kind === "edit") return fromRow(mode.row, tzOf[mode.row.theaterId] ?? "UTC");
    const theaterId = mode.theaterId ?? adminTheaters[0]?.id ?? "";
    return blank(theaterId, tzOf[theaterId] ?? "UTC");
  });
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const timeZone = tzOf[form.theaterId] ?? "UTC";
  const theater = adminTheaters.find((t) => t.id === form.theaterId);
  const endsNextDay = Boolean(form.start && form.end && form.end < form.start);

  // Esc closes; the page behind is inert and doesn't scroll; focus goes back to the opener.
  const rootRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const returnRef = useRef(returnFocusTo);
  useEffect(() => {
    const opener = returnRef.current ?? (document.activeElement as HTMLElement | null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const background = [...document.body.children].filter((el) => el !== rootRef.current && !el.hasAttribute("inert"));
    for (const el of background) el.setAttribute("inert", "");
    // Focus can't stay behind an inert page (in dev, Strict Mode's re-run lands it on the opener).
    if (!rootRef.current?.contains(document.activeElement)) rootRef.current?.querySelector("input")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      for (const el of background) el.removeAttribute("inert");
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  const create = useMutation(trpc.showtimes.create.mutationOptions());
  const update = useMutation(trpc.showtimes.update.mutationOptions());
  const pending = create.isPending || update.isPending;

  const times = () => {
    const start = fromZonedFields(form.date, form.start, timeZone);
    if (!start.ok) return { error: `Start: ${start.error}` } as const;
    const end = fromZonedFields(form.date, form.end, timeZone, endsNextDay ? 1 : 0);
    if (!end.ok) return { error: `End: ${end.error}` } as const;
    return { startTime: start.date.toISOString(), endTime: end.date.toISOString() } as const;
  };

  const onConflict = async (e: unknown, row: AdminRow) => {
    // A 409 is either a stale version (someone else saved first) or a duplicate active showtime.
    void queryClient.invalidateQueries({ queryKey: trpc.showtimes.list.pathKey() });
    const fresh = await queryClient
      .fetchQuery({ ...trpc.showtimes.get.queryOptions({ id: row.id }), staleTime: 0 })
      .catch(() => null);
    if (fresh?.access === "admin" && fresh.version !== row.version) {
      setBase(fresh);
      setForm(fromRow(fresh, timeZone));
      setError(
        "Someone else changed this showtime while you were editing. The latest version is loaded; make your change again.",
      );
    } else {
      setError(errorMessage(e));
    }
  };

  const submit = async () => {
    setError(null);
    if (!form.movieTitle.trim() || !form.auditorium.trim()) {
      setError(!form.movieTitle.trim() ? "Title is required" : "Auditorium is required");
      return;
    }
    if (!form.start || !form.end) {
      setError(!form.start ? "Enter a start time" : "Enter an end time");
      return;
    }
    if (form.start === form.end) {
      setError("End time must be different from the start time");
      return;
    }
    const t = times();
    if ("error" in t) {
      setError(t.error ?? "Check the times");
      return;
    }
    const values = {
      movieTitle: form.movieTitle,
      auditorium: form.auditorium,
      startTime: t.startTime,
      endTime: t.endTime,
      language: form.language,
      format: form.format,
      rating: form.rating,
      movieStatus: form.movieStatus,
      status: form.status,
    };

    if (!base) {
      const parsed = ShowtimeCreateInput.safeParse({ theaterId: form.theaterId, ...values });
      if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Check the form");
      try {
        onSaved(await create.mutateAsync(parsed.data), true);
      } catch (e) {
        setError(errorMessage(e));
      }
      return;
    }

    // Send only what changed.
    const changes: Record<string, string> = {};
    const original: Record<string, string> = {
      movieTitle: base.movieTitle,
      auditorium: base.auditorium,
      startTime: new Date(base.startTime).toISOString(),
      endTime: new Date(base.endTime).toISOString(),
      language: base.language,
      format: base.format,
      rating: base.rating,
      movieStatus: base.movieStatus,
      status: base.status,
    };
    for (const [k, v] of Object.entries(values)) {
      if (v.trim() !== original[k]) changes[k] = v;
    }
    if (Object.keys(changes).length === 0) return onClose();
    const parsed = ShowtimeUpdateInput.safeParse({ id: base.id, expectedVersion: base.version, ...changes });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Check the form");
    try {
      onSaved(await update.mutateAsync(parsed.data), false);
    } catch (e) {
      if (httpStatusOf(e) === 409) await onConflict(e, base);
      else setError(errorMessage(e));
    }
  };

  const titleId = `${ids}-title`;
  const label = "mb-1.5 block text-[13px] font-medium";

  return createPortal(
    <div ref={rootRef} className="fixed inset-0 z-40">
      <div aria-hidden className="scrim-in absolute inset-0 bg-black/15" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="sheet-in absolute inset-y-0 right-0 flex w-full flex-col border-l border-line bg-white shadow-[0_12px_32px_rgba(0,0,0,0.10)] sm:w-[440px]"
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 id={titleId} className="text-[17px] font-semibold tracking-[-0.01em]">
              {base ? "Edit showtime" : "New showtime"}
            </h2>
            <p className="mt-0.5 text-[13px] text-ink-2">
              {theater ? `${theater.name}, times in ${zoneName(timeZone)}` : "Choose a theater"}
            </p>
          </div>
          <button type="button" className={`${button.quiet} -mr-2 w-9 px-0`} onClick={onClose} aria-label="Close">
            <X aria-hidden className="size-4" />
          </button>
        </div>

        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            if (!pending) void submit();
          }}
          onKeyDown={(e) => {
            // Inputs submit on Enter natively; make selects do the same.
            if (e.key === "Enter" && e.target instanceof HTMLSelectElement) {
              e.preventDefault();
              e.currentTarget.requestSubmit();
            }
          }}
        >
          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5 sm:px-6">
            {!base && !(mode.kind === "new" && mode.theaterId) && (
              <label className="block">
                <span className={label}>Theater</span>
                <select
                  className={selectField}
                  value={form.theaterId}
                  onChange={(e) => set("theaterId", e.target.value)}
                >
                  {adminTheaters.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label className="block">
              <span className={label}>Film</span>
              <input
                autoFocus
                className={field}
                value={form.movieTitle}
                onChange={(e) => set("movieTitle", e.target.value)}
                maxLength={200}
                autoComplete="off"
              />
            </label>

            <label className="block">
              <span className={label}>Auditorium</span>
              <input
                className={field}
                list={`${ids}-auditoriums`}
                value={form.auditorium}
                onChange={(e) => set("auditorium", e.target.value)}
                maxLength={100}
                autoComplete="off"
              />
            </label>

            <label className="block">
              <span className={label}>Date</span>
              <input
                type="date"
                className={`${field} tnum`}
                value={form.date}
                onChange={(e) => set("date", e.target.value)}
              />
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="block min-w-0">
                <span className={label}>Starts</span>
                <input
                  type="time"
                  className={`${field} tnum`}
                  value={form.start}
                  onChange={(e) => set("start", e.target.value)}
                />
              </label>
              <label className="block min-w-0">
                <span className={label}>Ends</span>
                <input
                  type="time"
                  className={`${field} tnum`}
                  value={form.end}
                  onChange={(e) => set("end", e.target.value)}
                />
              </label>
            </div>
            {endsNextDay && <p className="-mt-2 text-[13px] text-ink-2">Ends the next day, after midnight.</p>}

            <div className="grid grid-cols-3 gap-2">
              <TextWithSuggestions
                label="Language"
                listId={`${ids}-languages`}
                value={form.language}
                onChange={(v) => set("language", v)}
                max={40}
              />
              <TextWithSuggestions
                label="Format"
                listId={`${ids}-formats`}
                value={form.format}
                onChange={(v) => set("format", v)}
                max={40}
              />
              <TextWithSuggestions
                label="Rating"
                listId={`${ids}-ratings`}
                value={form.rating}
                onChange={(v) => set("rating", v)}
                max={20}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className={label}>Movie status</span>
                <select
                  className={selectField}
                  value={form.movieStatus}
                  onChange={(e) => set("movieStatus", e.target.value as MovieStatus)}
                >
                  {MOVIE_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {movieStatusLabel[s]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={label}>Status</span>
                <select
                  className={selectField}
                  value={form.status}
                  onChange={(e) => set("status", e.target.value as ShowtimeStatus)}
                >
                  {SHOWTIME_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {statusLabel[s]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="text-[13px] text-ink-2">
              Archiving takes a showtime off the schedule. It stays in the audit log and a later import can bring it
              back.
            </p>

            <datalist id={`${ids}-auditoriums`}>
              {suggestions.auditoriums.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
            <datalist id={`${ids}-languages`}>
              {suggestions.languages.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
            <datalist id={`${ids}-formats`}>
              {suggestions.formats.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
            <datalist id={`${ids}-ratings`}>
              {suggestions.ratings.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          </div>

          <div className="border-t border-line px-5 py-3 sm:px-6">
            {error && (
              <p role="alert" className="mb-3 text-[13px] text-remove">
                {error}
              </p>
            )}
            <div className="flex items-center justify-between gap-3">
              <span className="hidden text-[13px] text-ink-3 sm:inline">Enter to save, Esc to close</span>
              <div className="ml-auto flex items-center gap-4">
                <button type="button" className={button.link} onClick={onClose}>
                  Cancel
                </button>
                <button type="submit" className={button.primary} disabled={pending}>
                  {pending ? "Saving…" : base ? "Save changes" : "Add showtime"}
                </button>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

function TextWithSuggestions({
  label,
  listId,
  value,
  onChange,
  max,
}: {
  label: string;
  listId: string;
  value: string;
  onChange: (v: string) => void;
  max: number;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-[13px] font-medium">{label}</span>
      <input
        className={field}
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={max}
        autoComplete="off"
      />
    </label>
  );
}
