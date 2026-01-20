import { normalizeTitle } from "./normalize";

export interface ShowtimeRow {
  theaterName: string;
  movieTitle: string;
  normalizedTitle: string;
  auditorium: string;
  startTime: Date;
  endTime: Date;
  language: string;
  format: string;
  rating: string;
  lastUpdated: Date;
}

/**
 * Parse a CSV line, handling quoted fields properly
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];
    
    if (char === '"' && inQuotes && nextChar === '"') {
      // Escaped quote
      current += '"';
      i++; // Skip next quote
    } else if (char === '"') {
      // Toggle quote mode
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      // Field delimiter
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  
  // Push last field
  result.push(current.trim());
  return result;
}

/**
 * Parse CSV string into structured showtime rows
 */
export function parseCSV(csvContent: string): ShowtimeRow[] {
  const lines = csvContent.trim().split(/\r?\n/);
  
  if (lines.length < 2) {
    throw new Error("CSV must have a header row and at least one data row");
  }

  // Parse header to get column indices
  const headers = parseCSVLine(lines[0]!).map((h) => h.trim().toLowerCase());
  
  const getIndex = (name: string) => {
    const index = headers.findIndex((h) => h.includes(name));
    if (index === -1) throw new Error(`Missing required column: ${name}`);
    return index;
  };

  const indices = {
    theaterName: getIndex("theater"),
    movieTitle: getIndex("movie"),
    auditorium: getIndex("auditorium"),
    startTime: getIndex("start"),
    endTime: getIndex("end"),
    language: getIndex("language"),
    format: getIndex("format"),
    rating: getIndex("rating"),
    lastUpdated: getIndex("updated"),
  };

  // Parse data rows
  const rows: ShowtimeRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;

    const values = parseCSVLine(line);

    const movieTitle = values[indices.movieTitle]!.trim();
    
    rows.push({
      theaterName: values[indices.theaterName]!.trim(),
      movieTitle,
      normalizedTitle: normalizeTitle(movieTitle),
      auditorium: values[indices.auditorium]!.trim(),
      startTime: new Date(values[indices.startTime]!.trim()),
      endTime: new Date(values[indices.endTime]!.trim()),
      language: values[indices.language]!.trim(),
      format: values[indices.format]!.trim(),
      rating: values[indices.rating]!.trim(),
      lastUpdated: new Date(values[indices.lastUpdated]!.trim()),
    });
  }

  return rows;
}

/**
 * Remove duplicate rows based on normalized title and start time
 */
export function dedupeRows(rows: ShowtimeRow[]): ShowtimeRow[] {
  const seen = new Set<string>();
  const dedupedRows: ShowtimeRow[] = [];

  for (const row of rows) {
    const key = `${row.normalizedTitle}|${row.startTime.toISOString()}`;
    
    if (!seen.has(key)) {
      seen.add(key);
      dedupedRows.push(row);
    }
  }

  return dedupedRows;
}

/**
 * Parse and dedupe CSV in one step
 */
export function parseAndDedupeCSV(csvContent: string): ShowtimeRow[] {
  const rows = parseCSV(csvContent);
  return dedupeRows(rows);
}

