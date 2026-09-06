/**
 * TRAINER ROLLUPS — the counters behind "Sessions Coached".
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The app only ever holds 24 hours of sessions for one studio in memory
 * (`src/hooks/useSessions.ts` filters on `createdAt >= now - 24h` and
 * `hostedAtStudioId == activeStudioId`). That is the right call for a tablet
 * on the gym floor, but it means a career total can never be counted on the
 * client -- which is why the trainer profile read "0 Logged Sessions" for a
 * trainer with years of history.
 *
 * Counting on the server at read time would be worse: every profile open
 * would read every session that trainer has ever coached.
 *
 * So we count ONCE, at the moment a session is completed, and store the
 * answer on the trainer document. Three pieces:
 *
 *   onSessionRollup      write-time trigger. Lifetime total + lastSessionAt.
 *   recalcTrainerWindows nightly. The rolling windows, which a counter cannot
 *                        express (a 30-day figure has to forget things).
 *   backfillTrainerRollups  admin-only, one-off. History that predates the
 *                        trigger, including the legacy FileMaker import.
 *
 * Division of labour matters: the trigger owns `sessionsCoached` and
 * `lastSessionAt` and touches nothing else, so the nightly job can rewrite
 * every window field without ever racing it.
 */
import { FieldPath, FieldValue, Firestore, Timestamp, getFirestore } from "firebase-admin/firestore";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall, HttpsError } from "firebase-functions/v2/https";

/** The production named database. Same constant the Mindbody webhook uses. */
export const JOURNEY_DATABASE = "ai-studio-32cbbdcc-6e08-4770-9665-867c68878efa";

/** Bumped when the backfill's maths changes, so a stale stamp is detectable. */
export const ROLLUP_VERSION = 1;

const REGION = "us-central1";
const TIME_ZONE = "America/New_York";

/** Only the session fields the rollup cares about. */
export type SessionLike = {
  status?: string;
  trainerId?: string;
  startedByTrainerId?: string;
  trainerInitials?: string;
  clientId?: string;
  date?: string;
  createdAt?: unknown;
  /** Set by this module once a session has been added to a trainer's total. */
  rollupCounted?: boolean;
  /** Which trainer's total it landed in -- so a reversal can find it again. */
  rollupTrainerId?: string;
};

export type RollupPlan =
  | { kind: "count" }
  | { kind: "uncount"; trainerId: string }
  | { kind: "none"; reason: string };

/**
 * Pure decision: what should happen to the counters, given the two versions
 * of the session document. No I/O, so the interesting cases are all testable.
 *
 * The `rollupCounted` flag on the session -- not the status change -- is what
 * makes this safe. Cloud Functions guarantee *at least once* delivery, so the
 * same write can fire this trigger twice; the flag is what stops the second
 * firing from counting the session again.
 */
export function planRollup(
  before: SessionLike | undefined,
  after: SessionLike | undefined,
): RollupPlan {
  if (!after) {
    // Deleted. Only reverse it if it was actually in someone's total.
    if (before?.rollupCounted === true && before.rollupTrainerId) {
      return { kind: "uncount", trainerId: before.rollupTrainerId };
    }
    return { kind: "none", reason: "deleted; never counted" };
  }

  const completed = after.status === "Completed";

  if (completed && after.rollupCounted !== true) {
    return { kind: "count" };
  }

  // Reopened: a completed session was pushed back to In-Progress. Take it out
  // again, or the total drifts up every time a trainer re-enters a session.
  if (!completed && after.rollupCounted === true && after.rollupTrainerId) {
    return { kind: "uncount", trainerId: after.rollupTrainerId };
  }

  return {
    kind: "none",
    reason: completed ? "already counted" : "not completed",
  };
}

/**
 * Which trainer coached this session.
 *
 * Same precedence the old TrainerProfileView used, so the new numbers agree
 * with what trainers were already being shown: explicit id, then the trainer
 * who opened the session, then -- for legacy and imported rows that carry
 * nothing else -- initials.
 *
 * The initials path deliberately refuses to guess: if two trainers share
 * initials the session is left uncounted rather than credited to the wrong
 * person. An uncounted session is a number that is slightly low; a
 * mis-credited one is a number that is wrong.
 */
export async function resolveCoachTrainerId(
  firestore: Firestore,
  session: SessionLike,
): Promise<string | null> {
  const direct = session.rollupTrainerId || session.trainerId || session.startedByTrainerId;
  if (typeof direct === "string" && direct.trim()) return direct.trim();

  const initials = typeof session.trainerInitials === "string" ? session.trainerInitials.trim() : "";
  if (!initials) return null;

  for (const candidate of [initials, initials.toUpperCase()]) {
    const snap = await firestore
      .collection("trainers")
      .where("initials", "==", candidate)
      .limit(2)
      .get();
    if (snap.size === 1) return snap.docs[0].id;
    if (snap.size > 1) return null; // ambiguous -- never guess
  }
  return null;
}

/**
 * Adds one session to a trainer's lifetime total, atomically with the flag
 * that stops it being added twice. Both writes are in one transaction, so
 * there is no window where the counter has moved but the flag has not.
 */
export async function applyCount(
  firestore: Firestore,
  sessionPath: string,
  trainerId: string,
): Promise<{ applied: boolean; reason?: string }> {
  const sessionRef = firestore.doc(sessionPath);
  const trainerRef = firestore.collection("trainers").doc(trainerId);

  return firestore.runTransaction(async (tx) => {
    const snap = await tx.get(sessionRef);
    if (!snap.exists) return { applied: false, reason: "session gone" };

    const data = (snap.data() || {}) as SessionLike;
    if (data.rollupCounted === true) return { applied: false, reason: "already counted" };
    if (data.status !== "Completed") return { applied: false, reason: "no longer completed" };

    tx.set(
      trainerRef,
      {
        rollups: {
          sessionsCoached: FieldValue.increment(1),
          lastSessionAt: FieldValue.serverTimestamp(),
          rollupUpdatedAt: FieldValue.serverTimestamp(),
        },
      },
      { merge: true },
    );
    tx.update(sessionRef, { rollupCounted: true, rollupTrainerId: trainerId });
    return { applied: true };
  });
}

/** Reverses a count. Clamped at zero -- a negative session count helps nobody. */
export async function applyUncount(
  firestore: Firestore,
  trainerId: string,
  sessionPath: string | null,
): Promise<void> {
  const trainerRef = firestore.collection("trainers").doc(trainerId);

  await firestore.runTransaction(async (tx) => {
    const trainerSnap = await tx.get(trainerRef);
    const current = Number((trainerSnap.data() as any)?.rollups?.sessionsCoached ?? 0);
    const next = Math.max(0, current - 1);

    tx.set(
      trainerRef,
      { rollups: { sessionsCoached: next, rollupUpdatedAt: FieldValue.serverTimestamp() } },
      { merge: true },
    );
    if (sessionPath) {
      tx.set(
        firestore.doc(sessionPath),
        { rollupCounted: false, rollupTrainerId: FieldValue.delete() },
        { merge: true },
      );
    }
  });
}

/* ------------------------------------------------------------------ */
/* Write-time trigger                                                  */
/* ------------------------------------------------------------------ */

let dbInstance: Firestore | null = null;
function db(): Firestore {
  if (!dbInstance) dbInstance = getFirestore(JOURNEY_DATABASE);
  return dbInstance;
}

export const onSessionRollup = onDocumentWritten(
  {
    document: "sessions/{sessionId}",
    region: REGION,
    database: JOURNEY_DATABASE,
  },
  async (event) => {
    const before = event.data?.before?.data() as SessionLike | undefined;
    const after = event.data?.after?.data() as SessionLike | undefined;
    const plan = planRollup(before, after);
    if (plan.kind === "none") return;

    const firestore = db();
    const sessionPath = `sessions/${event.params.sessionId}`;

    if (plan.kind === "uncount") {
      await applyUncount(firestore, plan.trainerId, after ? sessionPath : null);
      return;
    }

    const trainerId = await resolveCoachTrainerId(firestore, after as SessionLike);
    if (!trainerId) {
      console.warn(
        `trainerRollups: ${sessionPath} completed but no trainer could be resolved; left uncounted.`,
      );
      return;
    }
    await applyCount(firestore, sessionPath, trainerId);
  },
);

/* ------------------------------------------------------------------ */
/* Rolling windows                                                     */
/* ------------------------------------------------------------------ */

export type WindowTally = {
  sessions30d: number;
  sessions90d: number;
  clients90d: number;
  avgPerWeek: number;
};

/**
 * Pure: turn 90 days of completed sessions for ONE trainer into the four
 * window figures the profile shows.
 *
 * `avgPerWeek` is over the 90-day window rather than lifetime, because a
 * lifetime average silently punishes anyone who has been here a long time
 * and tells a trainer nothing about how they are working now.
 */
export function tallyWindows(
  rows: { atMs: number; clientId?: string }[],
  nowMs: number,
): WindowTally {
  const cutoff30 = nowMs - 30 * 86_400_000;
  const cutoff90 = nowMs - 90 * 86_400_000;
  let sessions30d = 0;
  let sessions90d = 0;
  const clients = new Set<string>();

  for (const row of rows) {
    if (row.atMs < cutoff90) continue;
    sessions90d += 1;
    if (row.clientId) clients.add(row.clientId);
    if (row.atMs >= cutoff30) sessions30d += 1;
  }

  return {
    sessions30d,
    sessions90d,
    clients90d: clients.size,
    avgPerWeek: Math.round((sessions90d / (90 / 7)) * 10) / 10,
  };
}

/** Best-effort instant for a session: `createdAt` first, then the `date` string. */
export function sessionInstantMs(session: SessionLike): number | null {
  const created = session.createdAt as { toMillis?: () => number } | undefined;
  if (created && typeof created.toMillis === "function") return created.toMillis();
  if (typeof session.date === "string" && session.date.trim()) {
    const parsed = Date.parse(session.date);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

export const recalcTrainerWindows = onSchedule(
  { schedule: "0 3 * * *", timeZone: TIME_ZONE, region: REGION },
  async () => {
    const firestore = db();
    const nowMs = Date.now();
    const cutoff = Timestamp.fromMillis(nowMs - 90 * 86_400_000);

    // One range query over 90 days, all studios. Single-field on `createdAt`,
    // so Firestore indexes it automatically -- status is filtered in memory
    // rather than buying a composite index for one nightly job.
    const snap = await firestore.collection("sessions").where("createdAt", ">=", cutoff).get();

    const byTrainer = new Map<string, { atMs: number; clientId?: string }[]>();
    snap.forEach((doc) => {
      const data = doc.data() as SessionLike;
      if (data.status !== "Completed") return;
      const trainerId = data.rollupTrainerId || data.trainerId || data.startedByTrainerId;
      if (!trainerId) return;
      const atMs = sessionInstantMs(data);
      if (atMs === null) return;
      const list = byTrainer.get(trainerId) || [];
      list.push({ atMs, clientId: data.clientId });
      byTrainer.set(trainerId, list);
    });

    // Every trainer gets written, including those with nothing in the window --
    // otherwise a trainer who stopped coaching keeps showing last month's 63.
    const trainers = await firestore.collection("trainers").get();
    let batch = firestore.batch();
    let pending = 0;

    for (const trainerDoc of trainers.docs) {
      const tally = tallyWindows(byTrainer.get(trainerDoc.id) || [], nowMs);
      batch.set(
        trainerDoc.ref,
        {
          rollups: {
            sessionsCoached30d: tally.sessions30d,
            sessionsCoached90d: tally.sessions90d,
            clientsCoached90d: tally.clients90d,
            avgPerWeek: tally.avgPerWeek,
            windowsUpdatedAt: FieldValue.serverTimestamp(),
          },
        },
        { merge: true },
      );
      pending += 1;
      if (pending === 400) {
        await batch.commit();
        batch = firestore.batch();
        pending = 0;
      }
    }
    if (pending > 0) await batch.commit();

    console.log(
      `trainerRollups: windows recalculated for ${trainers.size} trainers from ${snap.size} recent sessions.`,
    );
  },
);

/* ------------------------------------------------------------------ */
/* One-off backfill                                                    */
/* ------------------------------------------------------------------ */

export type BackfillTotals = {
  sessionsCoached: number;
  firstSessionAtMs: number | null;
  lastSessionAtMs: number | null;
};

/**
 * Pure: fold one page of sessions into the running per-trainer totals.
 * `initialsIndex` maps initials to a trainer id, and is only consulted for
 * rows that carry no id at all -- the legacy FileMaker import, mostly.
 */
export function foldBackfillPage(
  totals: Map<string, BackfillTotals>,
  rows: SessionLike[],
  initialsIndex: Map<string, string>,
): { counted: number; unresolved: number } {
  let counted = 0;
  let unresolved = 0;

  for (const row of rows) {
    if (row.status !== "Completed") continue;
    const direct = row.rollupTrainerId || row.trainerId || row.startedByTrainerId;
    let trainerId = typeof direct === "string" && direct.trim() ? direct.trim() : null;
    if (!trainerId && row.trainerInitials) {
      trainerId = initialsIndex.get(row.trainerInitials.trim().toUpperCase()) || null;
    }
    if (!trainerId) {
      unresolved += 1;
      continue;
    }

    const entry = totals.get(trainerId) || {
      sessionsCoached: 0,
      firstSessionAtMs: null,
      lastSessionAtMs: null,
    };
    entry.sessionsCoached += 1;
    const atMs = sessionInstantMs(row);
    if (atMs !== null) {
      if (entry.firstSessionAtMs === null || atMs < entry.firstSessionAtMs) entry.firstSessionAtMs = atMs;
      if (entry.lastSessionAtMs === null || atMs > entry.lastSessionAtMs) entry.lastSessionAtMs = atMs;
    }
    totals.set(trainerId, entry);
    counted += 1;
  }

  return { counted, unresolved };
}

/**
 * Admin-only, run once from Admin > System Backend > System Tools.
 *
 * Authoritative and idempotent: it SETS each total from a full scan rather
 * than incrementing, so running it twice gives the same answer. The one
 * caveat is that a session completed *while* the scan is running can be
 * counted by both the scan and the write-time trigger; re-running it fixes
 * that, which is why it sets rather than adds.
 */
export const backfillTrainerRollups = onCall({ region: REGION }, async (request) => {
  const { auth } = request;
  if (!auth) throw new HttpsError("unauthenticated", "Sign in first.");

  const firestore = db();
  const role =
    (auth.token as Record<string, unknown>).role ??
    (await firestore.collection("trainers").doc(auth.uid).get()).data()?.role;
  if (role !== "Admin" && role !== "Founder" && role !== "Overseer") {
    throw new HttpsError("permission-denied", "Only an Admin or Founder can rebuild trainer rollups.");
  }

  const trainers = await firestore.collection("trainers").get();
  const initialsIndex = new Map<string, string>();
  trainers.forEach((doc) => {
    const initials = (doc.data() as any)?.initials;
    if (typeof initials === "string" && initials.trim()) {
      const key = initials.trim().toUpperCase();
      // A shared set of initials is ambiguous; drop both rather than guess.
      initialsIndex.set(key, initialsIndex.has(key) ? "" : doc.id);
    }
  });
  for (const [key, value] of [...initialsIndex.entries()]) {
    if (!value) initialsIndex.delete(key);
  }

  const totals = new Map<string, BackfillTotals>();
  let scanned = 0;
  let counted = 0;
  let unresolved = 0;
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;

  for (;;) {
    let q = firestore.collection("sessions").orderBy(FieldPath.documentId()).limit(500);
    if (cursor) q = q.startAfter(cursor.id);
    const page = await q.get();
    if (page.empty) break;

    const rows = page.docs.map((d) => d.data() as SessionLike);
    const result = foldBackfillPage(totals, rows, initialsIndex);
    counted += result.counted;
    unresolved += result.unresolved;
    scanned += page.size;
    cursor = page.docs[page.docs.length - 1];
    if (page.size < 500) break;
  }

  let batch = firestore.batch();
  let pending = 0;
  for (const trainerDoc of trainers.docs) {
    const entry = totals.get(trainerDoc.id) || {
      sessionsCoached: 0,
      firstSessionAtMs: null,
      lastSessionAtMs: null,
    };
    const rollups: Record<string, unknown> = {
      sessionsCoached: entry.sessionsCoached,
      rollupVersion: ROLLUP_VERSION,
      rollupUpdatedAt: FieldValue.serverTimestamp(),
    };
    if (entry.firstSessionAtMs !== null) rollups.firstSessionAt = Timestamp.fromMillis(entry.firstSessionAtMs);
    if (entry.lastSessionAtMs !== null) rollups.lastSessionAt = Timestamp.fromMillis(entry.lastSessionAtMs);

    const patch: Record<string, unknown> = { rollups };

    // Repair, while we are here, the one field the Mindbody staff sync depends
    // on. Older trainer documents stored `mindbodyStaffId` as a number, and
    // Firestore's `==` is type-strict: a numeric row is invisible to the
    // string query in staffResolver. Nobody is going to re-open every trainer
    // profile to fix that by hand.
    const rawStaffId = (trainerDoc.data() as any)?.mindbodyStaffId;
    if (typeof rawStaffId === "number" && Number.isFinite(rawStaffId)) {
      patch.mindbodyStaffId = String(rawStaffId);
    }

    batch.set(trainerDoc.ref, patch, { merge: true });
    pending += 1;
    if (pending === 400) {
      await batch.commit();
      batch = firestore.batch();
      pending = 0;
    }
  }
  if (pending > 0) await batch.commit();

  return {
    success: true,
    trainers: trainers.size,
    sessionsScanned: scanned,
    sessionsCounted: counted,
    sessionsUnresolved: unresolved,
    rollupVersion: ROLLUP_VERSION,
  };
});
