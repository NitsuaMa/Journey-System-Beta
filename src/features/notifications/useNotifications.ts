/**
 * This trainer's bell.
 *
 * Round: Settings tiers & Task Board, Sep 2026.
 *
 * Reads only the signed-in trainer's own subcollection, which is also the only
 * thing firestore.rules will allow. Sorted and capped client-side: a bell is a
 * recent-activity list, not an archive, and 50 documents is more than anyone
 * scrolls.
 */

import { useEffect, useMemo, useState } from "react";
import { onSnapshot } from "firebase/firestore";
import { notificationsRef } from "./mutations";
import type { TrainerNotification } from "./types";

function millis(v: unknown): number {
  return (v as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
}

export function useNotifications(trainerId: string | null | undefined) {
  const [all, setAll] = useState<TrainerNotification[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!trainerId) {
      setAll([]);
      return;
    }
    setLoading(true);
    const unsub = onSnapshot(
      notificationsRef(trainerId),
      (snap) => {
        setAll(
          snap.docs.map(
            (d) => ({ ...(d.data() as Omit<TrainerNotification, "id">), id: d.id }),
          ),
        );
        setLoading(false);
      },
      (err) => {
        console.error("Error loading notifications:", err);
        setAll([]);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [trainerId]);

  const notifications = useMemo(
    () =>
      [...all]
        .sort((a, b) => millis(b.createdAt) - millis(a.createdAt))
        .slice(0, 50),
    [all],
  );

  // Counted over ALL of them, not the visible 50: a badge that says 50 when
  // there are 80 is a lie, and the number is the only thing anyone reads.
  const unreadCount = useMemo(() => all.filter((n) => !n.readAt).length, [all]);

  return { notifications, unreadCount, loading };
}
