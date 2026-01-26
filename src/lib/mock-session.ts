"use client";

import { useEffect, useMemo, useState } from "react";
import { assessmentData } from "~/data/assessment-data";
import type { AssessmentUser } from "~/types/assessment";

const STORAGE_KEY = "scope-assessment-user-id";

const safeGetStoredUserId = () => {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(STORAGE_KEY);
};

export const defaultUserId = assessmentData.users[0]?.id ?? null;

export function useMockSession(initialUserId: string | null = defaultUserId) {
  const [userId, setUserId] = useState<string | null>(initialUserId);

  useEffect(() => {
    const stored = safeGetStoredUserId();
    if (stored) {
      setUserId(stored);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (userId) {
      window.localStorage.setItem(STORAGE_KEY, userId);
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, [userId]);

  const user: AssessmentUser | null = useMemo(() => {
    if (!userId) return null;
    return assessmentData.users.find((candidate) => candidate.id === userId) ?? null;
  }, [userId]);

  return {
    user,
    userId,
    setUserId,
    signOut: () => setUserId(null),
  };
}
