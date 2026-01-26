"use client";

import type {
  PreviewChanges,
  ShowtimeAdd,
  ShowtimeUpdate,
  ShowtimeArchive,
} from "~/types/assessment";

interface PreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  changes: PreviewChanges;
  isApplying: boolean;
}

export function PreviewModal({
  isOpen,
  onClose,
  onConfirm,
  changes,
  isApplying,
}: PreviewModalProps) {
  if (!isOpen) return null;

  const formatDateTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const totalChanges =
    changes.adds.length + changes.updates.length + changes.archives.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-xl bg-gray-900 shadow-2xl">
        <div className="sticky top-0 z-10 border-b border-gray-700 bg-gray-900 px-6 py-4">
          <h2 className="text-2xl font-bold text-white">
            Preview Changes
            {totalChanges > 0 && (
              <span className="ml-2 text-sm text-gray-400">
                ({totalChanges} total)
              </span>
            )}
          </h2>
        </div>

        <div className="p-6">
          {totalChanges === 0 ? (
            <p className="text-center text-gray-400">
              No changes detected. The schedule is already up to date.
            </p>
          ) : (
            <div className="space-y-6">
              {/* Adds */}
              {changes.adds.length > 0 && (
                <div>
                  <h3 className="mb-3 flex items-center text-lg font-semibold text-green-400">
                    <span className="mr-2 flex h-6 w-6 items-center justify-center rounded-full bg-green-900 text-xs">
                      {changes.adds.length}
                    </span>
                    New Showtimes
                  </h3>
                  <div className="space-y-2">
                    {changes.adds.map((add: ShowtimeAdd, idx: number) => (
                      <div
                        key={idx}
                        className="rounded-lg border border-green-900 bg-green-950 bg-opacity-30 p-4"
                      >
                        <div className="font-semibold text-white">
                          {add.movieTitle}
                        </div>
                        <div className="mt-1 text-sm text-gray-300">
                          {formatDateTime(add.startTime)} –{" "}
                          {formatDateTime(add.endTime)}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-400">
                          <span>{add.auditorium}</span>
                          <span>•</span>
                          <span>{add.language}</span>
                          <span>•</span>
                          <span>{add.format}</span>
                          <span>•</span>
                          <span>{add.rating}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Updates */}
              {changes.updates.length > 0 && (
                <div>
                  <h3 className="mb-3 flex items-center text-lg font-semibold text-yellow-400">
                    <span className="mr-2 flex h-6 w-6 items-center justify-center rounded-full bg-yellow-900 text-xs">
                      {changes.updates.length}
                    </span>
                    Updated Showtimes
                  </h3>
                  <div className="space-y-2">
                    {changes.updates.map((update: ShowtimeUpdate) => (
                      <div
                        key={update.id}
                        className="rounded-lg border border-yellow-900 bg-yellow-950 bg-opacity-30 p-4"
                      >
                        <div className="font-semibold text-white">
                          {update.movieTitle}
                        </div>
                        <div className="mt-1 text-sm text-gray-300">
                          {formatDateTime(update.startTime)} –{" "}
                          {formatDateTime(update.endTime)}
                        </div>
                        <div className="mt-2 space-y-1">
                          {update.diffs.map((diff, idx) => (
                            <div
                              key={idx}
                              className="text-sm"
                            >
                              <span className="text-gray-400">
                                {diff.field}:
                              </span>{" "}
                              <span className="text-red-400 line-through">
                                {diff.oldValue}
                              </span>{" "}
                              →{" "}
                              <span className="text-green-400">
                                {diff.newValue}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Archives */}
              {changes.archives.length > 0 && (
                <div>
                  <h3 className="mb-3 flex items-center text-lg font-semibold text-red-400">
                    <span className="mr-2 flex h-6 w-6 items-center justify-center rounded-full bg-red-900 text-xs">
                      {changes.archives.length}
                    </span>
                    Archived Showtimes
                  </h3>
                  <div className="space-y-2">
                    {changes.archives.map((archive: ShowtimeArchive) => (
                      <div
                        key={archive.id}
                        className="rounded-lg border border-red-900 bg-red-950 bg-opacity-30 p-4"
                      >
                        <div className="font-semibold text-white">
                          {archive.movieTitle}
                        </div>
                        <div className="mt-1 text-sm text-gray-300">
                          {formatDateTime(archive.startTime)} –{" "}
                          {formatDateTime(archive.endTime)}
                        </div>
                        <div className="mt-1 text-xs text-gray-400">
                          Not present in new drop
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="sticky bottom-0 border-t border-gray-700 bg-gray-900 px-6 py-4">
          <div className="flex justify-end gap-3">
            <button
              onClick={onClose}
              disabled={isApplying}
              className="rounded-lg border border-gray-600 px-6 py-2 font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={isApplying || totalChanges === 0}
              className="rounded-lg bg-purple-600 px-6 py-2 font-medium text-white transition hover:bg-purple-700 disabled:opacity-50"
            >
              {isApplying ? "Applying..." : "Confirm Changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
