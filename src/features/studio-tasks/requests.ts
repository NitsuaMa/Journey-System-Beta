/**
 * FLOATING REQUESTS — the ad-hoc half of the board.
 *
 * Round: Settings tiers & Task Board, Sep 2026.
 *
 * WHY THIS IS NOT A TASK TEMPLATE
 * -------------------------------
 * The brief describes two things that sound like one:
 *
 *   "daily machine cleaning, taking out the trash, birthday calendar setups"
 *       a CHECKLIST. It repeats, it resets, it is the same every Tuesday, and
 *       the question worth answering is "was it done today".
 *
 *   "Can someone cover these clients for me?"
 *       a CONVERSATION. It happens once, it has replies, it is never done
 *       again, and the question worth answering is "who answered".
 *
 * Modelling both as one document is the trap. The template/instance split in
 * types.ts exists for exactly one reason: the checklist has to RESET nightly
 * without erasing who did what last Tuesday. A shift-cover request never
 * resets. Forcing it through a template with recurrence "once" would hand it a
 * recurrence engine it does not use, a shift it does not have, and nowhere to
 * hold a reply thread.
 *
 * So requests are their own collection, and the UI merges the two into one
 * board. Two lifecycles, two shapes, one screen.
 *
 * NOT PER-DAY, UNLIKE AN INSTANCE
 * -------------------------------
 * A task belongs to a date. A request belongs to the studio until somebody
 * deals with it: "can anyone cover Thursday?" posted on Tuesday must still be
 * on the board on Wednesday. So requests are read by status, not by localDate,
 * and resolved ones age off via expiresOn instead of being deleted — the
 * answer to "who covered my 5pm last month" is worth keeping.
 */

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  increment,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "../../firebase";
import { studioDateKey } from "../../lib/studio-time";
import type { TaskAuthor } from "./mutations";

/**
 * What kind of ask this is.
 *
 * Drives an icon and a default priority and NOTHING else. The brief asked for
 * something "fluid and customizable, not rigidly confined to strict
 * categories", so this deliberately does not gate fields or behaviour — a
 * request typed as a question that turns into a cover request needs no
 * migration, just a different icon.
 */
export type RequestKind = "cover" | "question" | "heads-up" | "help" | "other";

export const REQUEST_KIND_LABEL: Record<RequestKind, string> = {
  cover: "Cover",
  question: "Question",
  "heads-up": "Heads-up",
  help: "Help",
  other: "Other",
};

export const REQUEST_KIND_HINT: Record<RequestKind, string> = {
  cover: "Can someone take a session or a client for me?",
  question: "Something I want another trainer's read on",
  "heads-up": "Something the studio should know",
  help: "A hand with something physical or right now",
  other: "Anything else",
};

export type RequestPriority = "low" | "normal" | "urgent";
export type RequestStatus = "open" | "resolved" | "cancelled";

/** studios/{studioId}/taskRequests/{requestId} */
export interface TaskRequest {
  id: string;
  studioId: string;

  kind: RequestKind;
  title: string;
  detail?: string;

  /** Optional links that make a request actionable rather than chatty. */
  clientId?: string;
  machineId?: string;
  /** Studio-local 'YYYY-MM-DD', for cover requests. */
  sessionDate?: string;

  createdBy: TaskAuthor;
  createdAt?: unknown;

  /** Same advisory semantics as a task claim — see TaskInstance.claimedBy. */
  claimedBy?: TaskAuthor | null;
  claimedAt?: unknown;

  status: RequestStatus;
  resolvedBy?: TaskAuthor | null;
  resolvedAt?: unknown;
  resolution?: string;

  /**
   * Denormalized. The board renders every open request; if this count lived
   * only in the subcollection, drawing twelve requests would cost twelve extra
   * reads on every snapshot. One integer, incremented on reply, and the
   * subcollection is read only when someone opens the thread.
   */
  replyCount: number;
  lastReplyAt?: unknown;

  priority: RequestPriority;
  /** Studio-local 'YYYY-MM-DD'. Resolved requests drop off the board after. */
  expiresOn?: string;
}

/** studios/{studioId}/taskRequests/{requestId}/replies/{replyId} */
export interface TaskRequestReply {
  id: string;
  body: string;
  author: TaskAuthor;
  createdAt?: unknown;
}

export function requestsRef(studioId: string) {
  return collection(db, "studios", studioId, "taskRequests");
}

export function requestDocRef(studioId: string, requestId: string) {
  return doc(db, "studios", studioId, "taskRequests", requestId);
}

export function repliesRef(studioId: string, requestId: string) {
  return collection(db, "studios", studioId, "taskRequests", requestId, "replies");
}

/** Studio-local date N days from today, for expiry. */
function studioDatePlus(days: number): string | undefined {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return studioDateKey(d) ?? undefined;
}

export interface CreateRequestInput {
  studioId: string;
  author: TaskAuthor;
  kind: RequestKind;
  title: string;
  detail?: string;
  clientId?: string;
  machineId?: string;
  sessionDate?: string;
  priority?: RequestPriority;
}

export async function createRequest(input: CreateRequestInput): Promise<string> {
  const { studioId, author, kind, title } = input;
  if (!studioId) throw new Error("No active studio — cannot post a request.");
  if (!title.trim()) throw new Error("A request needs something to say.");

  const ref = await addDoc(requestsRef(studioId), {
    studioId,
    kind,
    title: title.trim().slice(0, 200),
    ...(input.detail?.trim() ? { detail: input.detail.trim().slice(0, 2000) } : {}),
    ...(input.clientId ? { clientId: input.clientId } : {}),
    ...(input.machineId ? { machineId: input.machineId } : {}),
    ...(input.sessionDate ? { sessionDate: input.sessionDate } : {}),

    createdBy: author,
    createdAt: serverTimestamp(),

    claimedBy: null,
    claimedAt: null,

    status: "open",
    replyCount: 0,
    // Low by default: this is the FLOATING lane. A board where everything
    // arrives as normal priority teaches people to ignore priority.
    priority: input.priority ?? "low",
  });
  return ref.id;
}

/** Advisory claim, identical in spirit to a task claim. */
export async function setRequestClaim(params: {
  studioId: string;
  requestId: string;
  author: TaskAuthor | null;
  claimed: boolean;
}): Promise<void> {
  const { studioId, requestId, author, claimed } = params;
  if (claimed && !author) {
    throw new Error("Cannot claim a request without a signed-in trainer.");
  }
  await updateDoc(requestDocRef(studioId, requestId), {
    claimedBy: claimed ? author : null,
    claimedAt: claimed ? serverTimestamp() : null,
  });
}

export async function resolveRequest(params: {
  studioId: string;
  requestId: string;
  author: TaskAuthor | null;
  resolution?: string;
  status?: Extract<RequestStatus, "resolved" | "cancelled">;
}): Promise<void> {
  const { studioId, requestId, author, resolution, status = "resolved" } = params;
  await updateDoc(requestDocRef(studioId, requestId), {
    status,
    resolvedBy: author ?? null,
    resolvedAt: serverTimestamp(),
    ...(resolution?.trim() ? { resolution: resolution.trim().slice(0, 500) } : {}),
    // Kept for a fortnight rather than deleted: "who covered my 5pm last
    // month" is a real question, and the board filters on status anyway.
    expiresOn: studioDatePlus(14),
  });
}

export async function reopenRequest(studioId: string, requestId: string) {
  await updateDoc(requestDocRef(studioId, requestId), {
    status: "open",
    resolvedBy: null,
    resolvedAt: null,
    expiresOn: null,
  });
}

/**
 * Post a reply and bump the denormalized count.
 *
 * Two writes rather than a transaction on purpose. increment() is a server-side
 * atomic operator, so concurrent replies cannot lose a count, and the worst
 * case if the second write fails is a thread showing one fewer reply than it
 * holds — visibly wrong to nobody, and self-correcting on the next reply. A
 * transaction here would cost a read on every reply to buy nothing.
 */
export async function addRequestReply(params: {
  studioId: string;
  requestId: string;
  author: TaskAuthor;
  body: string;
}): Promise<void> {
  const { studioId, requestId, author, body } = params;
  const text = body.trim();
  if (!text) return;

  await addDoc(repliesRef(studioId, requestId), {
    body: text.slice(0, 2000),
    author,
    createdAt: serverTimestamp(),
  });

  await setDoc(
    requestDocRef(studioId, requestId),
    { replyCount: increment(1), lastReplyAt: serverTimestamp() },
    { merge: true },
  );
}

export async function deleteRequest(studioId: string, requestId: string) {
  // Replies are a subcollection and Firestore does not cascade. Deleting is
  // reserved for a request posted in error, where the thread is empty or
  // irrelevant; resolveRequest is the normal path and keeps everything.
  await deleteDoc(requestDocRef(studioId, requestId));
}
