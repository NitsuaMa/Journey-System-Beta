/**
 * HUB ANNOUNCEMENTS, read by the one bell.
 *
 * Round: Sep 6 2026 UI pass.
 *
 * WHY THIS HOOK EXISTS AT ALL
 * ---------------------------
 * The header used to carry two bells. One was `NotificationBell` - the quiet
 * per-trainer feed added in the Task Board round - and the other was
 * `HubAnnouncementsWidget`, an older component that streamed
 * `hub_announcements` and opened its own dialog. Two bells side by side is not
 * a design, it is an archaeological layer: nobody could tell from the glyph
 * which one held the thing they were looking for, so both got ignored.
 *
 * Deleting the older bell outright would have taken announcements off the
 * trainer UI with it - Admin can still author them, and they would have gone
 * nowhere. So the STREAM moved here and the RENDERING moved into the
 * notification sheet. One bell, two sections, nothing lost.
 *
 * THE FILTERING IS UNCHANGED, DELIBERATELY
 * ----------------------------------------
 * Scope targeting, the expiry check and the read-tracking are lifted verbatim
 * from the widget. This round was about where announcements appear, not about
 * who sees which one, and quietly changing the targeting rules in the same
 * commit would make any resulting "why can't I see it" report untraceable.
 *
 * READS ARE MARKED ON OPEN, NOT ON RENDER
 * ---------------------------------------
 * `markAnnouncementsRead` is exported rather than run inside an effect. An
 * announcement that flashes past because the sheet mounted behind another
 * screen has not been read by anybody, and marking it so is how a studio-wide
 * notice silently stops being new to a trainer who never saw it.
 */

import { useEffect, useMemo, useState } from "react";
import {
  arrayUnion,
  collection,
  doc,
  onSnapshot,
  query,
  updateDoc,
} from "firebase/firestore";
import { db } from "../../firebase";
import type { HubAnnouncement, Trainer } from "../../types";

/** Milliseconds out of whatever shape the field happens to be in. */
function millis(v: unknown): number {
  if (!v) return 0;
  const ts = v as { toMillis?: () => number; toDate?: () => Date };
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (typeof ts.toDate === "function") return ts.toDate().getTime();
  if (typeof v === "number") return v;
  if (v instanceof Date) return v.getTime();
  return 0;
}

/** Whether this trainer is inside an announcement's target scope. */
function isTargeted(a: HubAnnouncement, trainer: Trainer): boolean {
  const accessible = trainer.accessibleStudioIds ?? [];
  return (
    a.targetScope === "universal" ||
    a.studioId === "all" ||
    a.studioId === trainer.primaryHomeStudioId ||
    accessible.includes(a.studioId) ||
    (a.targetScope === "studio" &&
      (a.targetId === trainer.primaryHomeStudioId ||
        (Boolean(a.targetId) && accessible.includes(a.targetId as string)))) ||
    (a.targetScope === "network" &&
      (trainer.role === "Owner" ||
        trainer.role === "FranchiseOwner" ||
        trainer.role === "StudioOwner"))
  );
}

export interface UseHubAnnouncementsResult {
  /** Active, in-scope, unexpired. Newest first. */
  announcements: HubAnnouncement[];
  /** Of those, the ones this trainer has not opened yet. */
  unread: HubAnnouncement[];
  unreadCount: number;
}

export function useHubAnnouncements(
  trainer: Trainer | null | undefined,
): UseHubAnnouncementsResult {
  const [all, setAll] = useState<HubAnnouncement[]>([]);

  useEffect(() => {
    if (!trainer) {
      setAll([]);
      return;
    }
    const unsub = onSnapshot(
      query(collection(db, "hub_announcements")),
      (snap) => {
        setAll(
          snap.docs.map((d) => ({ ...(d.data() as HubAnnouncement), id: d.id })),
        );
      },
      (err) => {
        console.error("Error streaming hub announcements:", err);
        setAll([]);
      },
    );
    return () => unsub();
  }, [trainer]);

  const announcements = useMemo(() => {
    if (!trainer) return [];
    const now = Date.now();
    return all
      .filter((a) => a.isActive !== false)
      .filter((a) => {
        const expires = millis(a.expiresAt);
        return expires === 0 || expires >= now;
      })
      .filter((a) => isTargeted(a, trainer))
      .sort((a, b) => millis(b.createdAt) - millis(a.createdAt));
  }, [all, trainer]);

  const unread = useMemo(() => {
    const id = trainer?.id ?? "";
    if (!id) return [];
    return announcements.filter((a) => !a.readBy?.includes(id));
  }, [announcements, trainer]);

  return { announcements, unread, unreadCount: unread.length };
}

/**
 * Stamp this trainer into `readBy` on every announcement passed.
 *
 * Fire-and-forget on purpose, and per-document rather than batched: a failed
 * write leaves the item looking new, which is the safe direction to fail, and
 * one rejected document must not take the rest of the set with it.
 */
export function markAnnouncementsRead(
  trainerId: string | undefined,
  items: HubAnnouncement[],
): void {
  if (!trainerId) return;
  for (const a of items) {
    if (!a.id) continue;
    updateDoc(doc(db, "hub_announcements", a.id), {
      readBy: arrayUnion(trainerId),
    }).catch((err) => {
      console.error("Failed to mark announcement as read:", a.id, err);
    });
  }
}
