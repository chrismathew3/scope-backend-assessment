import type { MovieStatus, ShowtimeStatus } from "@scope/shared";

export const movieStatusLabel: Record<MovieStatus, string> = {
  approved: "Approved",
  draft: "Draft",
  flagged: "Flagged",
  "needs-review": "Needs review",
};

export const statusLabel: Record<ShowtimeStatus, string> = {
  active: "Active",
  inactive: "Inactive",
  archived: "Archived",
};
