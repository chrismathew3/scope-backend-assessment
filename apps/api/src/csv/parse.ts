/**
 * Partner CSV -> cleaned, validated rows.
 *
 * File-level problems throw CsvFileError (the whole upload is refused).
 * Row-level problems are collected per row so one bad line never blocks the rest.
 */
import { parse as parseCsv } from "csv-parse/sync";
import {
  auditoriumKey,
  cleanText,
  normalizeFormat,
  normalizeLanguage,
  normalizeRating,
  titleKey,
  type Normalized,
} from "./normalize";
import { parseTimestamp } from "./time";
import type { CleanRow, ParsedFile, ParsedRow, RowIssue } from "./types";

export class CsvFileError extends Error {
  constructor(
    public readonly code:
      | "empty"
      | "not_csv"
      | "unbalanced_quotes"
      | "header_only"
      | "missing_columns"
      | "duplicate_header"
      | "empty_header"
      | "wrong_theater",
    message: string,
  ) {
    super(message);
    this.name = "CsvFileError";
  }
}

export interface ParseOptions {
  /** The theater being uploaded to. Rows naming another theater are rejected. */
  theaterName: string;
  /** IANA timezone used for times written without an offset. */
  timezone: string;
  /** "Now" for past-showtime warnings. Defaults to the current time. */
  now?: Date;
}

export const COLUMNS = [
  "theater_name",
  "movie_title",
  "auditorium",
  "start_time",
  "end_time",
  "language",
  "format",
  "rating",
  "last_updated",
] as const;
export type Column = (typeof COLUMNS)[number];

const REQUIRED: Column[] = ["theater_name", "movie_title", "auditorium", "start_time", "end_time"];

/** Header aliases, compared after lowercasing and removing everything but letters and digits. */
const HEADER_ALIASES: Record<Column, string[]> = {
  theater_name: ["theatername", "theater", "theatre", "theatrename", "cinema", "location", "site", "venue"],
  movie_title: ["movietitle", "title", "movie", "film", "filmtitle", "moviename", "name"],
  auditorium: ["auditorium", "aud", "screen", "room", "hall", "house"],
  start_time: ["starttime", "start", "showtime", "startsat", "startdatetime", "datetime", "showstart"],
  end_time: ["endtime", "end", "endsat", "enddatetime", "showend"],
  language: ["language", "lang", "audio"],
  format: ["format", "presentation", "experience"],
  rating: ["rating", "mpaa", "mparating", "certificate", "cert"],
  last_updated: ["lastupdated", "updated", "updatedat", "modified", "lastmodified"],
};

const ALIAS_TO_COLUMN = new Map<string, Column>();
for (const col of COLUMNS) for (const alias of HEADER_ALIASES[col]) ALIAS_TO_COLUMN.set(alias, col);

export function headerToColumn(header: string): Column | undefined {
  return ALIAS_TO_COLUMN.get(cleanText(header).toLowerCase().replace(/[^a-z0-9]/g, ""));
}

/** Defaults used when an optional column is missing from the file entirely. */
const OPTIONAL_DEFAULTS = { language: "EN", format: "2D", rating: "NR" } as const;

const MAX_CELL = 300;
const MIN_RUNTIME_MS = 30 * 60_000;
const MAX_RUNTIME_MS = 6 * 3600_000;

/* ───────── decoding ───────── */

function decode(bytes: Uint8Array, notices: string[]): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    bytes = bytes.subarray(3);
  } else if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    notices.push("File is UTF-16 encoded; converted to UTF-8.");
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    notices.push("File is UTF-16 encoded; converted to UTF-8.");
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  }

  // Zip (xlsx/docx) and other binaries.
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    throw new CsvFileError("not_csv", "This looks like an Excel or zip file. Export it as CSV and upload that.");
  }
  if (bytes.includes(0)) {
    throw new CsvFileError("not_csv", "This file isn't a text CSV (it contains binary data).");
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    notices.push(
      "File isn't valid UTF-8; read it as Windows-1252 (typical of Excel on Windows). Check accented titles in the preview.",
    );
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/* ───────── delimiter ───────── */

const DELIMITERS = [",", ";", "\t", "|"] as const;

/** Counts delimiter characters outside quotes in the first few non-empty lines. */
function sniffDelimiter(text: string): string {
  const lines = text.split("\n").filter((l) => l.trim() !== "").slice(0, 5);
  let best: string = ",";
  let bestCount = 0;
  for (const d of DELIMITERS) {
    let count = 0;
    for (const line of lines) {
      let inQuotes = false;
      for (const ch of line) {
        if (ch === '"') inQuotes = !inQuotes;
        else if (ch === d && !inQuotes) count++;
      }
    }
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

const DELIMITER_NAMES: Record<string, string> = { ";": "semicolons", "\t": "tabs", "|": "pipes" };

/* ───────── main ───────── */

interface RawRecord {
  line: number;
  cells: string[];
}

function isBlank(cells: string[]): boolean {
  return cells.every((c) => cleanText(c) === "");
}

const sameTheater = (a: string, b: string) =>
  cleanText(a).toLowerCase().replace(/\s+/g, "") === cleanText(b).toLowerCase().replace(/\s+/g, "");

export function parseShowtimeCsv(bytes: Uint8Array, opts: ParseOptions): ParsedFile {
  const notices: string[] = [];
  const now = opts.now ?? new Date();

  if (bytes.length === 0) throw new CsvFileError("empty", "The file is empty.");
  const text = decode(bytes, notices).replace(/\r\n?/g, "\n");
  if (text.trim() === "") throw new CsvFileError("empty", "The file is empty.");

  const delimiter = sniffDelimiter(text);
  if (delimiter !== ",") notices.push(`Columns are separated by ${DELIMITER_NAMES[delimiter]}, not commas.`);

  let records: RawRecord[];
  try {
    const parsed = parseCsv(text, {
      delimiter,
      relax_column_count: true,
      relax_quotes: true, // a stray quote inside an unquoted title is fine
      skip_empty_lines: false,
      info: true,
      raw: true,
    }) as unknown as { record: string[]; info: { lines: number }; raw: string }[];
    records = parsed.map(({ record, info, raw }) => {
      // info.lines is the record's LAST line; step back over quoted newlines.
      const inner = (raw.match(/\n/g)?.length ?? 0) - (raw.endsWith("\n") ? 1 : 0);
      return { line: info.lines - inner, cells: record };
    });
  } catch (err) {
    const e = err as { code?: string; lines?: number; message?: string };
    if (e.code === "CSV_QUOTE_NOT_CLOSED") {
      throw new CsvFileError(
        "unbalanced_quotes",
        `A quote is opened but never closed (starting near line ${e.lines ?? "?"}).`,
      );
    }
    throw new CsvFileError("not_csv", `Couldn't read this file as CSV: ${e.message ?? "unknown error"}`);
  }

  /* ── header detection: first of the first 5 non-blank rows with 3+ known columns ── */
  const nonBlank = records.filter((r) => !isBlank(r.cells));
  if (nonBlank.length === 0) throw new CsvFileError("empty", "The file is empty.");

  const headerIdx = nonBlank
    .slice(0, 5)
    .findIndex((r) => r.cells.filter((c) => headerToColumn(c) !== undefined).length >= 3);
  if (headerIdx === -1) {
    const found = nonBlank[0]!.cells.map((c) => cleanText(c)).filter(Boolean);
    throw new CsvFileError(
      "missing_columns",
      `Couldn't find a header row. Expected columns like ${REQUIRED.join(", ")}; found: ${found.join(", ") || "nothing"}.`,
    );
  }
  if (headerIdx > 0) notices.push(`Skipped ${headerIdx} title row${headerIdx > 1 ? "s" : ""} above the header.`);
  const headerRecord = nonBlank[headerIdx]!;
  const dataRecords = records.filter((r) => r.line > headerRecord.line);

  let headers = headerRecord.cells.map((c) => cleanText(c));
  // Trailing empty header cells (a trailing comma) are fine if their column is empty too.
  while (
    headers.length > 0 &&
    headers[headers.length - 1] === "" &&
    dataRecords.every((r) => cleanText(r.cells[headers.length - 1] ?? "") === "")
  ) {
    headers = headers.slice(0, -1);
  }
  if (headers.some((h) => h === "")) {
    throw new CsvFileError("empty_header", "A column in the header row has no name.");
  }

  const seenNames = new Set<string>();
  const columnIndex = new Map<Column, number>();
  const ignored: string[] = [];
  headers.forEach((h, i) => {
    const lower = h.toLowerCase();
    if (seenNames.has(lower)) throw new CsvFileError("duplicate_header", `The column "${h}" appears twice.`);
    seenNames.add(lower);
    const col = headerToColumn(h);
    if (!col) {
      ignored.push(h);
      return;
    }
    if (columnIndex.has(col)) {
      const other = headers[columnIndex.get(col)!]!;
      throw new CsvFileError("duplicate_header", `"${other}" and "${h}" both look like the ${col} column.`);
    }
    columnIndex.set(col, i);
  });

  const missing = REQUIRED.filter((c) => !columnIndex.has(c));
  if (missing.length > 0) {
    throw new CsvFileError(
      "missing_columns",
      `Missing required column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Found: ${headers.join(", ")}.`,
    );
  }
  if (ignored.length > 0) notices.push(`Ignored columns: ${ignored.join(", ")}.`);
  for (const col of ["language", "format", "rating"] as const) {
    if (!columnIndex.has(col)) {
      notices.push(`No ${col} column; every row uses "${OPTIONAL_DEFAULTS[col]}".`);
    }
  }

  const dataRows = dataRecords.filter((r) => !isBlank(r.cells));
  if (dataRows.length === 0) {
    throw new CsvFileError(
      "header_only",
      "The file has a header but no showtimes. Importing it would archive the whole schedule; use Clear Schedule if that's what you want.",
    );
  }

  const rows = dataRows.map((r) => parseRow(r, headers, columnIndex, opts, now));

  // If not one row is for this theater, the wrong file (or wrong theater) was picked.
  const theaterValues = rows
    .map((r) => cleanText(r.raw[headers[columnIndex.get("theater_name")!]!] ?? ""))
    .filter(Boolean);
  if (theaterValues.length > 0 && !theaterValues.some((t) => sameTheater(t, opts.theaterName))) {
    throw new CsvFileError(
      "wrong_theater",
      `This file is for "${theaterValues[0]}", but you're uploading to "${opts.theaterName}".`,
    );
  }

  return { notices, headerLine: headerRecord.line, rows };
}

function parseRow(
  record: RawRecord,
  headers: string[],
  columnIndex: Map<Column, number>,
  opts: ParseOptions,
  now: Date,
): ParsedRow {
  const errors: RowIssue[] = [];
  const warnings: RowIssue[] = [];

  const raw: Record<string, string> = {};
  headers.forEach((h, i) => (raw[h] = record.cells[i] ?? ""));
  const extras = record.cells.slice(headers.length);
  extras.forEach((c, i) => {
    if (c !== "") raw[`(extra ${i + 1})`] = c;
  });

  if (record.cells.length < headers.length) {
    errors.push({
      column: "*",
      message: `Row has ${record.cells.length} cells but the header has ${headers.length} (missing-cell).`,
    });
  } else if (extras.some((c) => cleanText(c) !== "")) {
    errors.push({
      column: "*",
      message: `Row has ${record.cells.length} cells but the header has ${headers.length} (extra-cell).`,
    });
  }

  const cell = (col: Column): string | undefined => {
    const i = columnIndex.get(col);
    return i === undefined ? undefined : cleanText(record.cells[i] ?? "");
  };

  for (const col of COLUMNS) {
    const v = cell(col);
    if (v !== undefined && v.length > MAX_CELL) {
      errors.push({ column: col, message: `Longer than ${MAX_CELL} characters.` });
    }
  }
  for (const col of REQUIRED) {
    if (!cell(col)) errors.push({ column: col, message: "Required." });
  }

  const theaterName = cell("theater_name") ?? "";
  if (theaterName && !sameTheater(theaterName, opts.theaterName)) {
    errors.push({
      column: "theater_name",
      message: `Row is for theater "${theaterName}", not "${opts.theaterName}".`,
    });
  }

  const movieTitle = cell("movie_title") ?? "";
  const movieTitleKey = titleKey(movieTitle);
  if (movieTitle && !movieTitleKey) {
    errors.push({ column: "movie_title", message: "Title has no letters or digits." });
  }
  const auditorium = cell("auditorium") ?? "";
  for (const [col, v] of [
    ["movie_title", movieTitle],
    ["auditorium", auditorium],
  ] as const) {
    if (/^[=+@]/.test(v)) {
      warnings.push({
        column: col,
        message: "Starts with a spreadsheet formula character; stored as plain text.",
      });
    }
  }

  // Times
  let startTime: Date | null = null;
  let endTime: Date | null = null;
  for (const col of ["start_time", "end_time"] as const) {
    const v = cell(col);
    if (!v) continue;
    const parsed = parseTimestamp(v, opts.timezone);
    if (!parsed.ok) {
      errors.push({ column: col, message: parsed.error });
      continue;
    }
    if (parsed.warning) warnings.push({ column: col, message: parsed.warning });
    if (col === "start_time") startTime = parsed.date;
    else endTime = parsed.date;
  }
  if (startTime && endTime) {
    const runtime = endTime.getTime() - startTime.getTime();
    if (runtime <= 0) {
      errors.push({ column: "end_time", message: "Ends before (or when) it starts." });
    } else if (runtime < MIN_RUNTIME_MS || runtime > MAX_RUNTIME_MS) {
      const minutes = Math.round(runtime / 60_000);
      warnings.push({ column: "end_time", message: `Unusual runtime: ${minutes} minutes.` });
    }
  }
  if (startTime && startTime.getTime() < now.getTime()) {
    warnings.push({ column: "start_time", message: "Start time is in the past." });
  }

  let lastUpdated: Date | null = null;
  const lu = cell("last_updated");
  if (lu) {
    const parsed = parseTimestamp(lu, opts.timezone);
    if (parsed.ok) lastUpdated = parsed.date;
    else warnings.push({ column: "last_updated", message: `${parsed.error}; ignored.` });
  }

  const optional = (col: "language" | "format" | "rating", fn: (s: string) => Normalized): string => {
    const v = cell(col);
    if (v === undefined) return OPTIONAL_DEFAULTS[col];
    if (v === "") {
      warnings.push({ column: col, message: `Empty; used "${OPTIONAL_DEFAULTS[col]}".` });
      return OPTIONAL_DEFAULTS[col];
    }
    const n = fn(v);
    if (n.warning) warnings.push({ column: col, message: n.warning });
    return n.value;
  };
  const language = optional("language", normalizeLanguage);
  const format = optional("format", normalizeFormat);
  const rating = optional("rating", normalizeRating);

  let value: CleanRow | null = null;
  if (errors.length === 0 && startTime && endTime) {
    value = {
      theaterName,
      movieTitle,
      movieTitleKey,
      auditorium,
      auditoriumKey: auditoriumKey(auditorium),
      startTime,
      endTime,
      language,
      format,
      rating,
      lastUpdated,
    };
  }

  return { lineNumber: record.line, raw, value, errors, warnings };
}
