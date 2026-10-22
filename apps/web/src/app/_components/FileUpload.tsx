"use client";

import { MAX_CSV_BYTES } from "@scope/shared";
import { useRef } from "react";
import { primaryButton } from "~/lib/ui";

interface Props {
  onFile: (file: { name: string; base64: string }) => void;
  onError: (message: string) => void;
  disabled?: boolean;
  busy?: boolean;
}

/** Reads the file as raw bytes (base64) so the server can detect its encoding. */
function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = typeof reader.result === "string" ? reader.result : "";
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Couldn't read the file"));
    reader.readAsDataURL(file);
  });
}

export function FileUpload({ onFile, onError, disabled, busy }: Props) {
  const input = useRef<HTMLInputElement>(null);

  const handleChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (input.current) input.current.value = ""; // allow picking the same file again
    if (!file) return;
    if (file.size === 0) return onError("That file is empty.");
    if (file.size > MAX_CSV_BYTES) return onError("Files must be 20 MB or smaller.");
    try {
      onFile({ name: file.name, base64: await readAsBase64(file) });
    } catch (e) {
      onError(e instanceof Error ? e.message : "Couldn't read the file");
    }
  };

  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".csv,text/csv,text/plain"
        onChange={handleChange}
        className="hidden"
        disabled={disabled}
      />
      <button onClick={() => input.current?.click()} disabled={!!disabled || !!busy} className={primaryButton}>
        {busy ? "Reading file…" : "Upload CSV"}
      </button>
    </>
  );
}
