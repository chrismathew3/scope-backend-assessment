"use client";

import { MAX_CSV_BYTES } from "@scope/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { matchTheater, theaterNameFromCsv } from "~/lib/csvTheater";
import { errorMessage, useTRPC } from "~/lib/trpc";
import { button, column, h1, selectField } from "~/lib/ui";
import { useShell } from "../../../_components/AppShell";

/** Sample drops in apps/web/public/samples, keyed by the theater they're written for. */
const SAMPLES: Record<string, { file: string; about: string }[]> = {
  "theater-downtown": [
    { file: "new-drop.csv", about: "The brief's sample: renamed auditoriums, reformatted titles, a duplicate" },
    { file: "tricky-drop.csv", about: "Typos, a moved showtime, a restored film, a row for the wrong theater" },
  ],
  "theater-riverside": [
    {
      file: "riverside-drop.csv",
      about: "A renamed auditorium, a title typo, a new film, a duplicate, one showtime dropped",
    },
  ],
  "theater-uptown": [{ file: "uptown-drop.csv", about: "A moved showtime, restyled titles, a new film listed twice" }],
};

const MAX_SIZE = `${MAX_CSV_BYTES / (1024 * 1024)} MB`;
const TOO_BIG = `Files must be ${MAX_SIZE} or smaller (about 30,000 rows).`;

function toBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export default function NewImportPage() {
  const trpc = useTRPC();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { me, theaters, setTheaterId, selected } = useShell();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [pickedFromFile, setPickedFromFile] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const adminTheaters = theaters.filter((t) => me.theaterRoles[t.id] === "admin");
  const canImportHere = !!selected && me.theaterRoles[selected.id] === "admin";

  const create = useMutation(
    trpc.imports.create.mutationOptions({
      onSuccess: (detail) => {
        // The review page opens on the detail we already have.
        queryClient.setQueryData(trpc.imports.get.queryKey({ id: detail.summary.id }), detail);
        void queryClient.invalidateQueries({ queryKey: trpc.imports.list.pathKey() });
        router.push(`/imports/${detail.summary.id}`);
      },
    }),
  );

  // The server doesn't stream progress, so just count the seconds honestly.
  useEffect(() => {
    if (!create.isPending) return;
    const start = Date.now();
    setElapsed(0);
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [create.isPending]);

  const send = (name: string, buffer: ArrayBuffer) => {
    setFileName(name);
    if (buffer.byteLength === 0) return setLocalError("That file is empty.");
    if (buffer.byteLength > MAX_CSV_BYTES) return setLocalError(TOO_BIG);

    // No theater chosen yet: take it from the file's theater column. The server still checks every row.
    let target = canImportHere ? selected : undefined;
    if (!target) {
      const named = theaterNameFromCsv(buffer);
      target = named ? matchTheater(named, adminTheaters) : undefined;
      if (!target) {
        return setLocalError(
          named
            ? `The file is for ${named}, which isn't a theater you manage. Choose a theater above.`
            : "Couldn't tell which theater this file is for. Choose one above.",
        );
      }
      setTheaterId(target.id);
      setPickedFromFile(target.id);
    } else {
      setPickedFromFile(null);
    }

    setLocalError(null);
    create.mutate({ theaterId: target.id, filename: name, contentBase64: toBase64(buffer) });
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_CSV_BYTES) {
      setFileName(file.name);
      return setLocalError(TOO_BIG);
    }
    send(file.name, await file.arrayBuffer());
  };

  const onSample = async (name: string) => {
    try {
      const res = await fetch(`/samples/${name}`);
      if (!res.ok) throw new Error(`Couldn't load ${name}`);
      send(name, await res.arrayBuffer());
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Couldn't load the sample");
    }
  };

  if (adminTheaters.length === 0) {
    return (
      <div className={`${column} pt-8`}>
        <h1 className={h1}>Imports are for theater admins</h1>
        <p className="mt-2 text-ink-2">
          Your role can read schedules but not change them. Switch to an admin role to try an import.
        </p>
      </div>
    );
  }

  const error = localError ?? (create.error ? errorMessage(create.error) : null);
  const target = canImportHere ? selected : undefined;
  const samples = target
    ? (SAMPLES[target.id] ?? []).map((s) => ({ ...s, theater: null }))
    : adminTheaters.flatMap((t) => (SAMPLES[t.id] ?? []).map((s) => ({ ...s, theater: t.name })));

  return (
    <div className={`${column} pt-8 pb-24`}>
      <h1 className={h1}>Import a partner CSV</h1>

      {target ? (
        <p className="mt-2 text-[15px] text-pretty text-ink-2">
          Into <span className="text-ink">{target.name}</span>
          {pickedFromFile === target.id ? ", the theater named in the file" : ""}. An AI agent compares every row with
          the current schedule and proposes changes. Nothing is saved until you approve it.
        </p>
      ) : (
        <>
          <p className="mt-2 text-[15px] text-pretty text-ink-2">
            An AI agent compares every row with the current schedule and proposes changes. Nothing is saved until you
            approve it.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2">
            <select
              aria-label="Theater"
              className={`${selectField} max-w-60`}
              value=""
              onChange={(e) => setTheaterId(e.target.value)}
            >
              <option value="" disabled>
                Choose a theater
              </option>
              {adminTheaters.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <span className="text-[13px] text-ink-2">or drop a file and it&apos;s picked from the theater column</span>
          </div>
        </>
      )}

      {create.isPending ? (
        <div aria-live="polite" className="settle mt-10 rounded-xl border border-line px-6 py-7">
          <p className="font-medium">{fileName}</p>
          <p className="mt-3 flex items-start gap-2.5 text-[13px] text-ink-2">
            <Loader2 aria-hidden className="mt-0.5 size-3.5 shrink-0 animate-spin text-ink" />
            <span>
              Reading the file and asking the agent to review it. This usually takes 5 to 10 seconds.
              {elapsed > 0 && (
                <span className="tnum mt-1 block text-ink-3">
                  {elapsed === 1 ? "1 second" : `${elapsed} seconds`} so far
                </span>
              )}
            </span>
          </p>
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={() => input.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void onFile(e.dataTransfer.files[0]);
            }}
            className={`${target ? "mt-10" : "mt-6"} flex w-full flex-col items-center justify-center rounded-xl border border-dashed px-6 py-14 text-center transition-colors duration-150 ${
              dragging ? "border-ink bg-wash" : "border-line-strong hover:border-ink-3 hover:bg-wash-soft"
            }`}
          >
            <Upload aria-hidden className="size-5 text-ink-2" />
            <span className="mt-3 font-medium">Drop a CSV here, or choose a file</span>
            <span className="mt-1 text-[13px] text-ink-2">
              Columns like theater, title, auditorium, start and end time. Up to {MAX_SIZE}.
            </span>
          </button>
          {error && (
            <div role="alert" className="mt-4">
              <p className="text-[13px] font-medium text-remove">
                {fileName ? `${fileName} couldn't be imported` : "That file couldn't be read"}
              </p>
              <p className="mt-0.5 text-[13px] text-ink-2">{error}</p>
            </div>
          )}
          <input
            ref={input}
            type="file"
            accept=".csv,text/csv,text/plain"
            className="hidden"
            onChange={(e) => {
              void onFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />

          {samples.length > 0 && (
            <div className="mt-10">
              <h2 className="text-[13px] font-medium">No file handy? Try a sample</h2>
              <ul className="mt-2 border-t border-line">
                {samples.map((s) => (
                  <li key={s.file} className="flex items-center gap-4 border-b border-line py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium">{s.file}</p>
                      <p className="text-[13px] text-ink-2">
                        {s.theater ? `${s.theater}. ` : ""}
                        {s.about}
                      </p>
                    </div>
                    <a href={`/samples/${s.file}`} download className={button.link}>
                      Download
                    </a>
                    <button type="button" onClick={() => void onSample(s.file)} className={button.secondary}>
                      Use
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
