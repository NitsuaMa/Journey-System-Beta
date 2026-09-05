/**
 * The studio's open requests, live.
 *
 * Round: Settings tiers & Task Board, Sep 2026.
 *
 * Read by status rather than by date — see the header of requests.ts for why a
 * request is not per-day. Ordered client-side so this needs no composite index
 * beyond the one on (status, createdAt) that the board's default query uses:
 * a studio's open requests are a handful of documents, and a query that fails
 * on a missing index fails quietly in the console and loudly on the floor.
 */

import { useEffect, useMemo, useState } from "react";
import { onSnapshot, query, where } from "firebase/firestore";
import { studioDateKey } from "../../lib/studio-time";
import { repliesRef, requestsRef } from "./requests";
import type { TaskRequest, TaskRequestReply } from "./requests";

function millis(v: unknown): number {
  return (v as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
}

export interface UseStudioRequestsResult {
  /** Everything still needing someone. Newest first. */
  open: TaskRequest[];
  /** Recently resolved, for the "what happened to my ask" question. */
  recentlyResolved: TaskRequest[];
  loading: boolean;
}

export function useStudioRequests(
  studioId: string | null,
): UseStudioRequestsResult {
  const [requests, setRequests] = useState<TaskRequest[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!studioId) {
      setRequests([]);
      return;
    }
    setLoading(true);
    // Two equality reads would need two listeners; one unfiltered read of a
    // studio's requests is a small collection and lets the board show resolved
    // items without a second subscription.
    const unsub = onSnapshot(
      requestsRef(studioId),
      (snap) => {
        setRequests(
          snap.docs.map(
            (d) => ({ ...(d.data() as Omit<TaskRequest, "id">), id: d.id }),
          ),
        );
        setLoading(false);
      },
      (err) => {
        console.error("Error loading studio requests:", err);
        setRequests([]);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [studioId]);

  const today = studioDateKey(new Date()) ?? "";

  const open = useMemo(
    () =>
      requests
        .filter((r) => r.status === "open")
        // Urgent floats, then newest. A "floating request" lane that buries a
        // cover request for tomorrow under three chatty questions is not doing
        // its job.
        .sort((a, b) => {
          const rank = (r: TaskRequest) => (r.priority === "urgent" ? 0 : 1);
          return rank(a) - rank(b) || millis(b.createdAt) - millis(a.createdAt);
        }),
    [requests],
  );

  const recentlyResolved = useMemo(
    () =>
      requests
        .filter(
          (r) =>
            r.status !== "open" &&
            // expiresOn is a studio-local date key, so a string compare is the
            // correct comparison — no parsing, no timezone to get wrong.
            (!r.expiresOn || !today || r.expiresOn >= today),
        )
        .sort((a, b) => millis(b.resolvedAt) - millis(a.resolvedAt)),
    [requests, today],
  );

  return { open, recentlyResolved, loading };
}

/**
 * One request's replies. Subscribed only while a thread is open.
 *
 * Passing null unsubscribes, which is the point: the board can show twelve
 * requests with a reply count each and hold exactly zero reply listeners until
 * somebody taps one.
 */
export function useRequestReplies(
  studioId: string | null,
  requestId: string | null,
) {
  const [replies, setReplies] = useState<TaskRequestReply[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!studioId || !requestId) {
      setReplies([]);
      return;
    }
    setLoading(true);
    const unsub = onSnapshot(
      repliesRef(studioId, requestId),
      (snap) => {
        setReplies(
          snap.docs
            .map((d) => ({ ...(d.data() as Omit<TaskRequestReply, "id">), id: d.id }))
            .sort((a, b) => millis(a.createdAt) - millis(b.createdAt)),
        );
        setLoading(false);
      },
      (err) => {
        console.error("Error loading request replies:", err);
        setReplies([]);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [studioId, requestId]);

  return { replies, loading };
}
