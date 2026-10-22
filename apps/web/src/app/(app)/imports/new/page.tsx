"use client";

import { MAX_CSV_BYTES } from "@scope/shared";
import { useMutation } from "@tanstack/react-query";
import { Check, Loader2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { errorMessage, useTRPC } from "~/lib/trpc";
import { button, column, h1, selectField } from "~/lib/ui";
import { useShell } from "../../../_components/AppShell";

const SAMPLES = [
  { file: "new-drop.csv", about: "The brief's sample: renamed auditoriums, reformatted titles, a duplicate" },
  { file: "tricky-drop.csv", about: "Typos, a moved showtime, a restored film, a row for the wrong theater" },
];

const STAGES = [
  "Reading the file",
  "Cleaning rows and matching columns",
  "Agent comparing with the schedule",
  "Checking every proposal",
];

function toBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export default function NewImportPage() {
  const trpc = useTRPC();
  const router = useRouter();
  const { me, theaters, theaterId, setTheaterId, selected } = useShell();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [stage, setStage] = useState(0);
  const [localError, setLocalError] = useState<string | null>(null);

  const adminTheaters = theaters.filter((t) => me.theaterRoles[t.id] === "admin");
  const canImportHere = !!selected && me.theaterRoles[selected.id] === "admin";

  const create = useMutation(
    trpc.imports.create.mutationOptions({
      onSuccess: (detail) => router.push(`/imports/${detail.summary.id}`),
    }),
  );

  // Walk through the stages while the request runs; the last one waits for the server.
  useEffect(() => {
    if (!create.isPending) return;
    setStage(0);
    const timers = [500, 1300, 4200].map((ms, i) => setTimeout(() => setStage(i + 1), ms));
    return () => timers.forEach(clearTimeout);
  }, [create.isPending]);

  const send = (name: string, buffer: ArrayBuffer) => {
    if (!selected) return;
    setFileName(name);
    if (buffer.byteLength === 0) return setLocalError("That file is empty.");
    if (buffer.byteLength > MAX_CSV_BYTES) return setLocalError("Files must be 3 MB or smaller (about 30,000 rows).");
    setLocalError(null);
    create.mutate({ theaterId: selected.id, filename: name, contentBase64: toBase64(buffer) });
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
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

  return (
    <div className={`${column} pt-8 pb-24`}>
      <h1 className={h1}>Import a partner CSV</h1>

      {!canImportHere ? (
        <div className="mt-4">
          <p className="text-ink-2">Pick the theater this file is for.</p>
          <select
            aria-label="Theater"
            className={`${selectField} mt-3 max-w-xs`}
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
        </div>
      ) : (
        <>
          <p className="mt-2 text-[15px] text-pretty text-ink-2">
            Into <span className="text-ink">{selected.name}</span>. An AI agent compares every row with the current
            schedule and proposes changes. Nothing is saved until you approve it.
          </p>

          {create.isPending ? (
            <div aria-live="polite" className="mt-10 rounded-xl border border-line px-6 py-7">
              <p className="font-medium">{fileName}</p>
              <ol className="mt-4 space-y-2.5">
                {STAGES.map((s, i) => (
                  <li
                    key={s}
                    className={`flex items-center gap-2.5 text-[13px] transition-colors duration-300 ${i <= stage ? "text-ink" : "text-ink-3"}`}
                  >
                    {i < stage ? (
                      <Check aria-hidden className="size-3.5" />
                    ) : i === stage ? (
                      <Loader2 aria-hidden className="size-3.5 animate-spin" />
                    ) : (
                      <span aria-hidden className="size-3.5" />
                    )}
                    {s}
                  </li>
                ))}
              </ol>
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
                className={`mt-10 flex w-full flex-col items-center justify-center rounded-xl border border-dashed px-6 py-14 text-center transition-colors duration-150 ${
                  dragging ? "border-ink bg-wash" : "border-line-strong hover:border-ink-3 hover:bg-[#fcfcfc]"
                }`}
              >
                <Upload aria-hidden className="size-5 text-ink-2" />
                <span className="mt-3 font-medium">Drop a CSV here, or choose a file</span>
                <span className="mt-1 text-[13px] text-ink-2">
                  Columns like theater, title, auditorium, start and end time. Up to 3 MB.
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

              {selected.name === "Downtown Cinema 7" && (
                <div className="mt-10">
                  <h2 className="text-[13px] font-medium">No file handy? Try a sample</h2>
                  <ul className="mt-2 border-t border-line">
                    {SAMPLES.map((s) => (
                      <li key={s.file} className="flex items-center gap-4 border-b border-line py-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-medium">{s.file}</p>
                          <p className="text-[13px] text-ink-2">{s.about}</p>
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

        </>
      )}
      {theaterId === "all" && canImportHere === false && adminTheaters.length > 0 && null}
    </div>
  );
}
