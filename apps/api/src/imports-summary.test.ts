import { describe, expect, test } from "bun:test";
import { appliedNotices, largeArchiveNotice } from "@scope/shared";

describe("an applied import's notices describe what was applied", () => {
  const preview = ["Every showtime in this file is in the past.", largeArchiveNotice(4, 5)];

  test("archives all unticked: the 'would archive 4 of 5' warning is dropped, other notices stay", () => {
    expect(appliedNotices(preview, 0, 5)).toEqual(["Every showtime in this file is in the past."]);
  });

  test("most of the schedule still archived: said in the past tense with the applied count", () => {
    expect(appliedNotices(preview, 3, 5)).toEqual(["Every showtime in this file is in the past.", "Archived 3 of 5 showtimes in the schedule."]);
  });
});
