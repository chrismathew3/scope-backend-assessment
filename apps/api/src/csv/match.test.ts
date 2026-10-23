import { describe, expect, test } from "bun:test";
import { sameShowtime, similarTitles, titlesConflict } from "./match";
import { titleKey } from "./normalize";

const conflict = (a: string, b: string) => titlesConflict(titleKey(a), titleKey(b));
const similar = (a: string, b: string) => similarTitles(titleKey(a), titleKey(b));

describe("titlesConflict", () => {
  test("a subtitle word on each side that the other lacks means different films", () => {
    expect(conflict("Spider-Man: Across the Spider-Verse", "Spider-Man: Into the Spider-Verse")).toBe(true);
    expect(conflict("Dune: Prophecy", "Dune: Messiah")).toBe(true);
    expect(conflict("Star Wars: The Force Awakens", "Star Wars: The Last Jedi")).toBe(true);
    expect(conflict("Spider-Woman: Homecoming", "Spider-Man: Homecoming")).toBe(true);
  });

  test("typos, joined words and abbreviations are not conflicts", () => {
    expect(conflict("Spiderman Homecomming", "Spider-Man: Homecoming")).toBe(false);
    expect(conflict("Spider Man Homecoming", "Spiderman: Homecoming")).toBe(false);
    expect(conflict("Dune Pt. II", "Dune: Part Two")).toBe(false);
    expect(conflict("Mission Impossible Dead Reckoning", "Mission: Impossible - Dead Reckoning Part One")).toBe(false);
  });

  test("words missing on one side only are a short or long form, not a conflict", () => {
    expect(conflict("Dune", "Dune: Prophecy Night")).toBe(false);
  });
});

describe("similarTitles", () => {
  test("keeps the sequel guard and the threshold", () => {
    expect(similar("Kung Fu Panda 4", "Kung Fu Panda 3")).toBe(false);
    expect(similar("Kung Fu Panda", "Kung Fu Panda 4")).toBe(false);
    expect(similar("Dune: Prophecy", "Dune: Part Two")).toBe(false); // numbers differ
    expect(similar("Spider-Man: Across the Spider-Verse", "Spider-Man: Into the Spider-Verse")).toBe(false);
    expect(similar("Spiderman Homecomming", "Spider-Man: Homecoming")).toBe(true);
    expect(similar("Dune", "Dune: Prophecy Night")).toBe(false); // similarity 0.25
  });

  test("sameShowtime also needs the same start", () => {
    const at = new Date("2025-03-20T18:00:00Z");
    const a = { movieTitleKey: titleKey("Spiderman Homecoming"), startTime: at };
    expect(sameShowtime(a, { movieTitleKey: titleKey("Spider-Man: Homecoming"), startTime: at })).toBe(true);
    expect(sameShowtime(a, { movieTitleKey: titleKey("Spider-Man: Homecoming"), startTime: new Date(at.getTime() + 60_000) })).toBe(false);
  });
});
