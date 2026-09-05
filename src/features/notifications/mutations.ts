/**
 * Writing a notification into somebody else's tree.
 *
 * Round: Settings tiers & Task Board, Sep 2026.
 *
 * WRITTEN BY THE CLIENT, NOT A CLOUD FUNCTION
 * -------------------------------------------
 * When Michael ticks a task, HIS device writes one document into the creator's
 * notification subcollection. That keeps this feature function-free, like the
 * rest of studio-tasks: no deploy step, no cold start, and nothing riding on
 * the Cloud Run packaging pipeline that has already cost this project time.
 *
 * The consequence, stated rather than buried: one trainer's device writes into
 * another trainer's document tree, so the rule has to allow it. The rule is
 * create-only and self-read (see firestore.rules) — a signed-in user may
 * CREATE a notification, must stamp themselves as the actor, cannot read,
 * update or delete anyone else's, and cannot mark one pre-read. The worst a
 * bad actor can do is write a truthfully-attributed notification into a
 * colleague's bell, which is what the feature is for.
 *
 * EVERY WRITE HERE IS BEST-EFFORT
 * -------------------------------
 * notify() never throws. A failed notification must not roll back the thing it
 * was announcing: a trainer who ticked the last closing task and saw an error
 * would tick it again, and the task is what matters. Failures are logged.
 */

import { addDoc, collection, doc, serverTimestamp, updateDoc, writeBatch } from "firebase/firestore";
import { db } from "../../firebase";
import type { NotificationKind, NotificationLink, TrainerNotification } from "./types";

export function notificationsRef(trainerId: string) {
  return collection(db, "trainers", trainerId, "notifications");
}

export interface NotifyParams {
  /** Auth uid of the recipient. */
  to: string | null | undefined;
  actor: { id: string; name: string } | null;
  kind: NotificationKind;
  title: string;
  body?: string;
  studioId: string;
  link?: NotificationLink;
}

/**
 * Send one notification. Silently does nothing when it would be noise.
 *
 * Returns true only if a document was written, so callers can be honest in
 * tests without inspecting Firestore.
 */
export async function notify(params: NotifyParams): Promise<boolean> {
  const { to, actor, kind, title, body, studioId, link } = params;

  if (!to || !actor) return false;
  // Nobody needs telling they did their own task. This single line removes
  // most of the volume a naive implementation would generate, because the
  // person who creates a task is very often the one who closes it.
  if (to === actor.id) return false;

  try {
    await addDoc(notificationsRef(to), {
      kind,
      title: title.slice(0, 200),
      ...(body ? { body: body.slice(0, 500) } : {}),
      studioId,
      ...(link ? { link } : {}),
      actor,
      createdAt: serverTimestamp(),
      readAt: null,
    });
    return true;
  } catch (err) {
    // Deliberately swallowed. See the file header.
    console.error("Could not send notification:", err);
    return false;
  }
}

export async function markNotificationRead(
  trainerId: string,
  notificationId: string,
): Promise<void> {
  await updateDoc(doc(db, "trainers", trainerId, "notifications", notificationId), {
    readAt: serverTimestamp(),
  });
}

/** Batched: a trainer returning from a week off should not fire 60 writes. */
export async function markAllNotificationsRead(
  trainerId: string,
  notifications: TrainerNotification[],
): Promise<number> {
  const unread = notifications.filter((n) => !n.readAt);
  if (unread.length === 0) return 0;

  const LIMIT = 450; // Firestore caps a batch at 500 operations.
  let written = 0;
  for (let i = 0; i < unread.length; i += LIMIT) {
    const batch = writeBatch(db);
    for (const n of unread.slice(i, i + LIMIT)) {
      batch.update(doc(db, "trainers", trainerId, "notifications", n.id), {
        readAt: serverTimestamp(),
      });
    }
    await batch.commit();
    written += Math.min(LIMIT, unread.length - i);
  }
  return written;
}
