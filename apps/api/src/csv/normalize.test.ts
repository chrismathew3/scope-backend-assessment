import { describe, expect, test } from "bun:test";
import {
  auditoriumKey,
  cleanText,
  digitTokens,
  normalizeFormat,
  normalizeLanguage,
  normalizeRating,
  titleKey,
  trigramSimilarity,
} from "./normalize";

describe("cleanText", () => {
  test("trims, collapses spaces, maps unicode dashes and quotes, strips invisible characters", () => {
    expect(cleanText("  Spider Man - Homecoming  ")).toBe("Spider Man - Homecoming");
    expect(cleanText("Inside   Out  2")).toBe("Inside Out 2");
    expect(cleanText("Spider‑Man")).toBe("Spider-Man");
    expect(cleanText("A—B−C")).toBe("A-B-C");
    expect(cleanText("“Hi” ‘there’")).toBe("\"Hi\" 'there'");
    expect(cleanText("Wo​nka﻿")).toBe("Wonka");
    expect(cleanText("Past Lives")).toBe("Past Lives");
    expect(cleanText("Two\nLines\tHere\u0007")).toBe("Two Lines Here");
    expect(cleanText("Ｗｏｎｋａ")).toBe("Wonka"); // full-width (NFKC)
  });

  test("strips bidirectional control characters, which can make a title display reversed", () => {
    expect(cleanText("\u202EakNoW\u202C")).toBe("akNoW"); // RLO ... PDF
    expect(cleanText("Wo\u2066n\u2069ka\u200E\u200F")).toBe("Wonka"); // LRI/PDI, LRM/RLM
    expect(cleanText("\u202A\u202B\u202D\u2067\u2068Dune")).toBe("Dune");
    expect(titleKey("\u202EWonka")).toBe(titleKey("Wonka"));
  });
});

describe("titleKey", () => {
  test("spellings of the same title share a key", () => {
    const spider = ["Spider‑Man: Homecoming", "  Spider Man - Homecoming  ", "Spider-Man: Homecoming"];
    for (const t of spider) expect(titleKey(t)).toBe("spider man homecoming");
    expect(titleKey("DUNE PART 2")).toBe("dune part 2");
    expect(titleKey("Dune: Part Two")).toBe("dune part 2");
    expect(titleKey("Inside   Out  2")).toBe("inside out 2");
  });

  test("accents, ampersands, apostrophes, roman numerals, leading 'the'", () => {
    expect(titleKey("Amélie")).toBe("amelie");
    expect(titleKey("Fast & Furious")).toBe("fast and furious");
    expect(titleKey("Schindler's List")).toBe("schindlers list");
    expect(titleKey("Rocky II")).toBe("rocky 2");
    expect(titleKey("Star Wars: Episode IV")).toBe("star wars episode 4");
    expect(titleKey("The Holdovers")).toBe("holdovers");
    expect(titleKey("The")).toBe("the");
  });

  test("single-letter numerals stay words", () => {
    expect(titleKey("I, Tonya")).toBe("i tonya");
    expect(titleKey("V for Vendetta")).toBe("v for vendetta");
    expect(titleKey("Malcolm X")).toBe("malcolm x");
  });
});

describe("auditoriumKey", () => {
  test("names for the same room share a key", () => {
    for (const a of ["Auditorium 1", "Aud 1", "aud. 1", "Screen #1", "Auditorium One", "AUD1"]) {
      expect(auditoriumKey(a)).toBe("auditorium 1");
    }
    expect(auditoriumKey("Auditorium Two")).toBe("auditorium 2");
    expect(auditoriumKey("Auditorium 1 (Laser)")).toBe("auditorium 1 laser");
    expect(auditoriumKey("Auditorium A")).toBe("auditorium a");
    expect(auditoriumKey("The Big Room")).toBe("the big room");
  });
});

describe("value normalizers", () => {
  test("language", () => {
    expect(normalizeLanguage("en")).toEqual({ value: "EN" });
    expect(normalizeLanguage("English")).toEqual({ value: "EN" });
    expect(normalizeLanguage("Español")).toEqual({ value: "ES" });
    expect(normalizeLanguage("jpn")).toEqual({ value: "JA" });
    expect(normalizeLanguage("tl")).toEqual({ value: "TL" });
    expect(normalizeLanguage("Klingon").warning).toContain("Unrecognized language");
  });

  test("format", () => {
    expect(normalizeFormat("3-d").value).toBe("3D");
    expect(normalizeFormat("RealD 3D").value).toBe("3D");
    expect(normalizeFormat("imax").value).toBe("IMAX");
    expect(normalizeFormat("IMAX 3D").value).toBe("IMAX 3D");
    expect(normalizeFormat("4dx").value).toBe("4DX");
    const odd = normalizeFormat("Hologram");
    expect(odd.value).toBe("HOLOGRAM");
    expect(odd.warning).toContain("Unrecognized format");
  });

  test("rating", () => {
    expect(normalizeRating("pg13").value).toBe("PG-13");
    expect(normalizeRating("PG 13").value).toBe("PG-13");
    expect(normalizeRating("nc-17").value).toBe("NC-17");
    expect(normalizeRating("Unrated").value).toBe("NR");
    expect(normalizeRating("TV-MA").warning).toContain("Unrecognized rating");
  });
});

describe("trigramSimilarity (pg_trgm semantics)", () => {
  test("identical strings score 1, unrelated score low", () => {
    expect(trigramSimilarity("wonka", "wonka")).toBe(1);
    expect(trigramSimilarity("wonka", "oppenheimer")).toBeLessThan(0.1);
    expect(trigramSimilarity("", "")).toBe(0);
  });

  test("matches pg_trgm for a known pair", () => {
    // SELECT similarity('word', 'two words') = 0.363636
    expect(trigramSimilarity("word", "two words")).toBeCloseTo(0.363636, 5);
  });

  test("sequels look alike, which is why digit tokens gate fuzzy matches", () => {
    expect(trigramSimilarity("kung fu panda 4", "kung fu panda 3")).toBeGreaterThan(0.6);
    expect(digitTokens("kung fu panda 4")).toEqual(["4"]);
    expect(digitTokens("kung fu panda 3")).toEqual(["3"]);
  });
});
