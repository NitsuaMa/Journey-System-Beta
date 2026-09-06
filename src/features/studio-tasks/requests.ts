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
  deleteField,
  doc,
  FieldPath,
  increment,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "../../firebase";
import { endOfStudioDay, studioDateKey } from "../../lib/studio-time";
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

/**
 * PRESET REACTIONS - the cheapest possible reply.
 *
 * Round: Sep 6 2026.
 *
 * Most answers to a floating request are not a sentence. "Got it" and "on it"
 * are the entire content of the reply, and asking someone to open a thread,
 * type two words and hit send to say them is why a board like this quietly
 * loses to the group text it was meant to replace: the group text costs one
 * thumb-tap and this cost six.
 *
 * A FIXED LIST, NOT FREE EMOJI
 * ----------------------------
 * Open reactions turn into decoration. These five are each a STATE someone
 * can be in with respect to the ask, so the row of them is readable as
 * status - "two people saw it, one is on it, one can't" - rather than as
 * applause. "On it" deliberately overlaps with claiming: a claim is a commitment
 * the board tracks, a reaction is a nod, and people reach for the nod first.
 *
 * THE SHAPE: reactions[reactionId][uid] = { name, at }
 * ---------------------------------------------------
 * A map of maps rather than an array of {id, uid} rows, because the write we
 * care about is a TOGGLE by one person on one reaction. As a map that is a
 * single-field update at a known path, which two people tapping at the same
 * moment cannot lose - arrayUnion/arrayRemove would need the exact object
 * back, including its timestamp, to remove it again. Names are denormalized
 * so the row renders without a second read per reactor.
 */
export const REQUEST_REACTIONS = [
  { id: "got-it", label: "Got it" },
  { id: "on-it", label: "On it" },
  { id: "done", label: "Done" },
  { id: "thanks", label: "Thanks" },
  { id: "cant", label: "Can't" },
] as const;

export type ReactionId = (typeof REQUEST_REACTIONS)[number]["id"];

export const REACTION_LABEL: Record<ReactionId, string> = Object.fromEntries(
  REQUEST_REACTIONS.map((r) => [r.id, r.label]),
) as Record<ReactionId, string>;

/** One reactor, stamped at the moment they tapped. */
export interface Reactor {
  name: string;
  at?: unknown;
}

/** reactions[reactionId][uid]. Absent keys simply mean nobody. */
export type ReactionMap = Partial<Record<ReactionId, Record<string, Reactor>>>;

/** How long a request stays on the board, offered as a choice at post time. */
export type ExpiryChoice = "today" | "3d" | "1w" | "none";

export const EXPIRY_LABEL: Record<ExpiryChoice, string> = {
  today: "Today",
  "3d": "3 days",
  "1w": "A week",
  none: "No expiry",
};

/**
 * Resolve a choice to an instant, in STUDIO time.
 *
 * "Today" means the end of the studio's day, not 24 hours from now and not
 * the end of the day on the iPad's clock. A trainer posting "covering the
 * front desk until close" at 8pm means tonight; a device left on Pacific time
 * would keep that on the board through tomorrow morning's opening shift.
 */
export function expiryInstant(choice: ExpiryChoice): Date | null {
  if (choice === "none") return null;
  if (choice === "today") return endOfStudioDay(new Date());
  const days = choice === "3d" ? 3 : 7;
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

/** Milliseconds out of a Firestore Timestamp, a Date, or a number. */
export function expiryMillis(v: unknown): number {
  if (!v) return 0;
  const ts = v as { toMillis?: () => number; toDate?: () => Date };
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (typeof ts.toDate === "function") return ts.toDate().getTime();
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  return 0;
}

/** Has this request's own expiry passed? Absent expiry never expires. */
export function isExpired(r: { expiresAt?: unknown }, now = Date.now()): boolean {
  const ms = expiryMillis(r.expiresAt);
  return ms > 0 && ms < now;
}

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

  /**
   * When this stops mattering, chosen by whoever posted it.
   *
   * Distinct from expiresOn, which is set BY the system when a request is
   * resolved so the record ages out of the "recently resolved" list. This one
   * applies to an OPEN request and is the author's own statement that it has
   * a shelf life: "anyone free to spot me at 2" is noise at 4pm, and a board
   * that keeps showing it teaches people to stop reading the board.
   *
   * A real Timestamp rather than a date key, because the useful granularity
   * here is hours. Absent means it stands until somebody deals with it, which
   * stays the default - an expiry is a claim about the future and most asks
   * do not warrant one.
   */
  expiresAt?: unknown | null;

  /** Preset one-tap replies. See REQUEST_REACTIONS. */
  reactions?: ReactionMap;
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
  /** Defaults to "none" - most asks stand until dealt with. */
  expiry?: ExpiryChoice;
}

export async function createRequest(input: CreateRequestInput): Promise<string> {
  const { studioId, author, kind, title } = input;
  if (!studioId) throw new Error("No active studio — cannot post a request.");
  if (!title.trim()) throw new Error("A request needs something to say.");

  const expiresAt = expiryInstant(input.expiry ?? "none");

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

    // Only written when the author actually chose one. An explicit null on
    // every document would be indistinguishable from "expires, at no time",
    // and the absent case is the common one.
    ...(expiresAt ? { expiresAt: Timestamp.fromDate(expiresAt) } : {}),
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

/**
 * Toggle one person's preset reaction on one request.
 *
 * ONE FIELD, AT A KNOWN PATH
 * --------------------------
 * `new FieldPath("reactions", reactionId, uid)` rather than a dotted string:
 * the string form is parsed, and a path is not the place to discover that a
 * segment contained a character the parser did not like. It also means two
 * people tapping "Got it" in the same second write two different fields and
 * neither can lose the other, which is the whole reason for a map of maps
 * instead of an array (see REQUEST_REACTIONS).
 *
 * Removing writes deleteField() rather than false or null, so an untapped
 * reaction leaves nothing behind and the map is exactly its reactors.
 */
export async function toggleRequestReaction(params: {
  studioId: string;
  requestId: string;
  reaction: ReactionId;
  author: TaskAuthor;
  on: boolean;
}): Promise<void> {
  const { studioId, requestId, reaction, author, on } = params;
  if (!studioId || !author?.id) return;
  await updateDoc(
    requestDocRef(studioId, requestId),
    new FieldPath("reactions", reaction, author.id),
    on
      ? ({ name: author.name, at: serverTimestamp() } as Reactor)
      : deleteField(),
  );
}

/** Who reacted with what, flattened for rendering. Empty buckets dropped. */
export function reactionSummary(
  r: Pick<TaskRequest, "reactions">,
): { id: ReactionId; label: string; names: string[]; ids: string[] }[] {
  const out: { id: ReactionId; label: string; names: string[]; ids: string[] }[] =
    [];
  for (const { id, label } of REQUEST_REACTIONS) {
    const bucket = r.reactions?.[id];
    if (!bucket) continue;
    const ids = Object.keys(bucket);
    if (ids.length === 0) continue;
    out.push({ id, label, ids, names: ids.map((k) => bucket[k]?.name ?? "") });
  }
  return out;
}

/**
 * Change or clear an open request's shelf life after the fact.
 *
 * Separate from resolveRequest on purpose. "This stops mattering at close"
 * is not the same statement as "this is handled", and collapsing the two
 * would lose the difference between a request that was answered and one that
 * simply aged out - which is the only interesting question when a manager
 * asks why nobody covered Thursday.
 */
export async function setRequestExpiry(params: {
  studioId: string;
  requestId: string;
  choice: ExpiryChoice;
}): Promise<void> {
  const { studioId, requestId, choice } = params;
  const at = expiryInstant(choice);
  await updateDoc(requestDocRef(studioId, requestId), {
    expiresAt: at ? Timestamp.fromDate(at) : null,
  });
}

export async function deleteRequest(studioId: string, requestId: string) {
  // Replies are a subcollection and Firestore does not cascade. Deleting is
  // reserved for a request posted in error, where the thread is empty or
  // irrelevant; resolveRequest is the normal path and keeps everything.
  await deleteDoc(requestDocRef(studioId, requestId));
}
