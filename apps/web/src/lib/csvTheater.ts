/**
 * Best-effort read of the theater a partner CSV is for, from its first data row.
 * Only used to pre-select a theater in the UI; the server still checks every row.
 */

function splitLine(line: string, delimiter: string) {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      cells.push(cell);
      cell = "";
    } else cell += ch;
  }
  cells.push(cell);
  return cells.map((c) => c.trim());
}

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** The theater name in the first data row, or null if the file has no theater column. */
export function theaterNameFromCsv(buffer: ArrayBuffer): string | null {
  // The first few KB is plenty for a header and one row.
  const text = new TextDecoder("utf-8").decode(buffer.slice(0, 8192)).replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return null;
  const header = lines[0]!;
  const delimiter = [",", ";", "\t"].reduce((best, d) => (header.split(d).length > header.split(best).length ? d : best));
  const columns = splitLine(header, delimiter).map(normalize);
  const index = columns.findIndex((c) => /\b(theater|theatre|cinema|venue|location)\b/.test(c) && !/\bid\b/.test(c));
  if (index === -1) return null;
  const value = splitLine(lines[1]!, delimiter)[index];
  return value === "" ? null : (value ?? null);
}

/** Match a name from a file to one of the given theaters, ignoring case and punctuation. */
export function matchTheater<T extends { name: string }>(name: string, theaters: T[]): T | undefined {
  const target = normalize(name);
  return theaters.find((t) => normalize(t.name) === target);
}
