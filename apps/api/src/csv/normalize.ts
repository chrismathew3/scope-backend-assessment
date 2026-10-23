/**
 * Text cleaning and match keys for partner CSV values.
 * Pure functions, no I/O. Used by the CSV parser, the reconciler and search.
 */

export interface Normalized {
  value: string;
  warning?: string;
}

const ZERO_WIDTH = /[​-‍⁠﻿­]/g;
// Bidirectional controls (LRE/RLE/PDF/LRO/RLO, LRI/RLI/FSI/PDI, LRM/RLM): invisible, and can make text display reversed.
const BIDI = /[\u202A-\u202E\u2066-\u2069\u200E\u200F]/g;
// Control characters. Tabs and newlines inside a cell become spaces instead.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const SPACES = /[\t\n\r    - 　]/g;
const DASHES = /[‐-―−﹘﹣－]/g;
const SINGLE_QUOTES = /[‘’‚‛′]/g;
const DOUBLE_QUOTES = /[“”„‟″]/g;

/** Display-safe cleanup: same text, minus invisible junk and inconsistent spacing. */
export function cleanText(input: string): string {
  return input
    .normalize("NFKC")
    .replace(ZERO_WIDTH, "")
    .replace(BIDI, "")
    .replace(SPACES, " ")
    .replace(CONTROL, "")
    .replace(DASHES, "-")
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(/ {2,}/g, " ")
    .trim();
}

const NUMBER_WORDS: Record<string, string> = {
  one: "1", two: "2", three: "3", four: "4", five: "5",
  six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
  eleven: "11", twelve: "12", thirteen: "13", fourteen: "14", fifteen: "15",
  sixteen: "16", seventeen: "17", eighteen: "18", nineteen: "19", twenty: "20",
};

// Multi-letter numerals only. "i", "v" and "x" are skipped on purpose:
// "I, Tonya", "V for Vendetta" and "Malcolm X" are words, not numbers.
const ROMAN: Record<string, string> = {
  ii: "2", iii: "3", iv: "4", vi: "6", vii: "7", viii: "8", ix: "9",
  xi: "11", xii: "12", xiii: "13", xiv: "14", xv: "15", xvi: "16",
  xvii: "17", xviii: "18", xix: "19", xx: "20",
};

function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "");
}

/** Words of a lowercased, accent-free string, split on anything that isn't a letter or digit. */
function words(s: string): string[] {
  return s
    .replace(/['`]/g, "") // "don't" -> "dont", not "don t"
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter(Boolean);
}

/**
 * Match key for a movie title. Two spellings of the same title should give the same key:
 * "Spider‑Man: Homecoming" and "  Spider Man - Homecoming  " -> "spider man homecoming",
 * "DUNE PART 2" and "Dune: Part Two" -> "dune part 2".
 */
export function titleKey(input: string): string {
  const base = stripDiacritics(cleanText(input).toLowerCase()).replace(/&/g, " and ");
  const tokens = words(base).map((w) => NUMBER_WORDS[w] ?? ROMAN[w] ?? w);
  if (tokens[0] === "the" && tokens.length > 1) tokens.shift();
  return tokens.join(" ");
}

const AUDITORIUM_RE =
  /^(auditorium|aud|screen|theater|theatre|house|cinema)\s*#?\s*(\d+|[a-z]|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b(.*)$/;

/**
 * Grouping key for an auditorium name: "Aud 1", "Auditorium One", "Screen #1" -> "auditorium 1".
 * Trailing qualifiers stay: "Auditorium 1 (Laser)" -> "auditorium 1 laser".
 */
export function auditoriumKey(input: string): string {
  const s = words(stripDiacritics(cleanText(input).toLowerCase())).join(" ");
  const m = AUDITORIUM_RE.exec(s);
  if (!m) return s;
  const id = NUMBER_WORDS[m[2]!] ?? m[2]!;
  const rest = (m[3] ?? "").trim();
  return rest ? `auditorium ${id} ${rest}` : `auditorium ${id}`;
}

const compact = (s: string) => cleanText(s).toLowerCase().replace(/[\s\-_.]+/g, "");

const LANGUAGES: Record<string, string> = {
  en: "EN", eng: "EN", english: "EN",
  es: "ES", spa: "ES", spanish: "ES", espanol: "ES",
  fr: "FR", fre: "FR", fra: "FR", french: "FR",
  ja: "JA", jpn: "JA", japanese: "JA",
  ko: "KO", kor: "KO", korean: "KO",
  de: "DE", ger: "DE", deu: "DE", german: "DE",
  zh: "ZH", chi: "ZH", zho: "ZH", chinese: "ZH", mandarin: "ZH",
  it: "IT", ita: "IT", italian: "IT",
  hi: "HI", hin: "HI", hindi: "HI",
  pt: "PT", por: "PT", portuguese: "PT",
};

export function normalizeLanguage(input: string): Normalized {
  const key = stripDiacritics(compact(input));
  const known = LANGUAGES[key];
  if (known) return { value: known };
  if (/^[a-z]{2,3}$/.test(key)) return { value: key.toUpperCase() };
  return { value: cleanText(input).toUpperCase(), warning: `Unrecognized language "${cleanText(input)}"` };
}

const FORMATS: Record<string, string> = {
  "2d": "2D", standard: "2D", digital: "2D",
  "3d": "3D", reald3d: "3D", real3d: "3D",
  imax: "IMAX", imax2d: "IMAX", imax3d: "IMAX 3D",
  "4dx": "4DX", dolby: "DOLBY", dolbycinema: "DOLBY", dolbyatmos: "DOLBY",
  screenx: "SCREENX", "70mm": "70MM",
};

export function normalizeFormat(input: string): Normalized {
  const known = FORMATS[compact(input)];
  if (known) return { value: known };
  return { value: cleanText(input).toUpperCase(), warning: `Unrecognized format "${cleanText(input)}"` };
}

const RATINGS: Record<string, string> = {
  g: "G", pg: "PG", pg13: "PG-13", r: "R", nc17: "NC-17",
  nr: "NR", unrated: "NR", notrated: "NR",
};

export function normalizeRating(input: string): Normalized {
  const known = RATINGS[compact(input)];
  if (known) return { value: known };
  return { value: cleanText(input).toUpperCase(), warning: `Unrecognized rating "${cleanText(input)}"` };
}

/** Same trigram set pg_trgm builds: each word padded with two leading spaces and one trailing. */
function trigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (const w of words(stripDiacritics(s.toLowerCase()))) {
    const padded = `  ${w} `;
    for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3));
  }
  return out;
}

/** pg_trgm `similarity()`: shared trigrams / all trigrams. 0..1. */
export function trigramSimilarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 && tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

/** Numeric tokens of a key, sorted. "kung fu panda 4" -> ["4"]. Used to stop sequels matching. */
export function digitTokens(key: string): string[] {
  return key
    .split(" ")
    .filter((t) => /^\d+$/.test(t))
    .sort();
}
