import { useEffect, useState } from "react";
import {
  Timestamp,
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "../../firebase";
import { OperationType, handleFirestoreError } from "../../lib/firestore-errors";
import type { Client, Trainer, WorkoutSession } from "../../types";
import { recentlyCoachedFor, type CoachedRow } from "./adapters";

/**
 * The last 30 days of a trainer's completed sessions.
 *
 * The app's global `sessions` array is 24 hours of ONE studio -- that is why
 * "Recently Logged" was empty on a Friday evening for a trainer who had
 * worked all week. This fetches once, on open, scoped to one trainer, capped,
 * and merges whatever is already loaded so a session finished thirty seconds
 * ago appears without a refetch.
 *
 * A one-shot getDocs rather than a listener on purpose: a profile is a page
 * you look at, not a screen you work from, and a live subscription per open
 * profile is a cost with no reader.
 *
 * NOTE: queries `trainerId` only. Sessions where the trainer appears solely as
 * `startedByTrainerId` are picked up from the loaded window instead of buying
 * a second composite index for a rare shape.
 */
export function useRecentlyCoached(
  trainer: Trainer | null,
  clients: Client[],
  loadedSessions: WorkoutSession[],
  options: { enabled?: boolean; days?: number } = {},
): { rows: CoachedRow[]; loading: boolean } {
  const enabled = options.enabled ?? true;
  const days = options.days ?? 30;
  const trainerId = trainer?.id ?? null;

  const [fetched, setFetched] = useState<WorkoutSession[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !trainerId) {
      setFetched([]);
      return;
    }
    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const cutoff = Timestamp.fromMillis(Date.now() - days * 86_400_000);
        const snap = await getDocs(
          query(
            collection(db, "sessions"),
            where("trainerId", "==", trainerId),
            where("createdAt", ">=", cutoff),
            orderBy("createdAt", "desc"),
            limit(40),
          ),
        );
        if (cancelled) return;
        setFetched(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as WorkoutSession));
      } catch (error) {
        if (!cancelled) {
          handleFirestoreError(error, OperationType.GET, "sessions");
          setFetched([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, trainerId, days]);

  if (!trainer) return { rows: [], loading: false };

  // De-duplicate by id: a session can be in both the fetch and the loaded
  // window, and showing a client twice reads as two sessions.
  const merged = new Map<string, WorkoutSession>();
  for (const s of [...fetched, ...loadedSessions]) {
    if (s.id) merged.set(s.id, s);
  }

  return { rows: recentlyCoachedFor([...merged.values()], trainer, clients), loading };
}
