/**
 * The reports this trainer has filed, for the Trainer Settings hero card.
 *
 * Round: Settings tiers & Task Board, Sep 2026.
 *
 * Showing a trainer their own reports, and whether they were fixed, is the
 * difference between a form and a feedback loop. Beta testers stop reporting
 * when reports feel like they go nowhere.
 *
 * Ordered client-side rather than with orderBy so this needs no composite
 * index: `userId ==` alone is covered by Firestore's automatic single-field
 * index, and a report list is a handful of documents.
 */

import { useEffect, useMemo, useState } from "react";
import { onSnapshot, query, where } from "firebase/firestore";
import { collection } from "firebase/firestore";
import { db } from "../../firebase";
import type { FeedbackReport } from "./types";

export function useMyFeedback(userId: string | null | undefined) {
  const [reports, setReports] = useState<FeedbackReport[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!userId) {
      setReports([]);
      return;
    }
    setLoading(true);
    const unsub = onSnapshot(
      query(collection(db, "bug_reports"), where("userId", "==", userId)),
      (snap) => {
        setReports(
          snap.docs.map((d) => ({ ...(d.data() as FeedbackReport), id: d.id })),
        );
        setLoading(false);
      },
      (err) => {
        console.error("Error loading your feedback:", err);
        setReports([]);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [userId]);

  const sorted = useMemo(() => {
    const millis = (r: FeedbackReport) =>
      (r.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
    return [...reports].sort((a, b) => millis(b) - millis(a));
  }, [reports]);

  const counts = useMemo(() => {
    let open = 0;
    let resolved = 0;
    for (const r of reports) {
      if (r.status === "fixed" || r.status === "wont-fix") resolved += 1;
      else open += 1;
    }
    return { open, resolved, total: reports.length };
  }, [reports]);

  return { reports: sorted, counts, loading };
}
