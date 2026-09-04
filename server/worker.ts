/**
 * Background Worker - drains the notificationQueue collection.
 *
 * WHY THIS EXISTS
 * ---------------
 * functions/src/index.ts writes documents into `notificationQueue` and nothing
 * has ever read them back out. Two producers write there today:
 *
 *   onBookingReminderWrite  -> { type: "booking_reminder" } the INSTANT a
 *                              booking is created, whenever that booking is
 *                              for. A booking made three weeks ahead queues a
 *                              "reminder" three weeks ahead of the session.
 *   sendDailySummary        -> { type: "daily_summary" } at 6am ET, one per
 *                              studio with dailySummaryEnabled.
 *
 * plus, now, server/cron-daily-reminders.ts, which queues day-of reminders in
 * the morning. Both reminder producers can describe the same session, so this
 * worker checks for an already-delivered sibling before sending, and refuses
 * to send a "reminder" for a session that is not close enough to remind
 * anyone about. Neither of those guards is optional: without them the first
 * deploy texts every client with a future booking, twice.
 *
 * WHY A SEPARATE SERVICE AND NOT A ROUTE ON THE WEB SERVER
 * -------------------------------------------------------
 * Node runs your JavaScript on one thread. A five-year export that spends four
 * seconds stitching records together is four seconds during which the web
 * service answers nobody - the trainer on the floor logging a set watches a
 * spinner. A worker is a second machine with its own CPU.
 *
 * HOW IT PICKS UP WORK
 * --------------------
 * A Firestore listener, not a polling loop: pushed to within about a second,
 * one read per changed document, where polling every ten seconds would cost
 * 8,640 mostly-empty queries a day. A slower sweep rescues documents left
 * claimed by a crash or a deploy mid-job.
 *
 * DELIVERY IS DELIBERATELY STUBBED
 * --------------------------------
 * There is no SMS or email provider in this project yet. Everything around the
 * send is real; deliver() logs what would go out and the document is parked as
 * "dry_run" rather than "sent", so nothing is consumed and the backlog can be
 * replayed once a provider exists (see RENDER-DEPLOYMENT.md).
 */

import dotenv from "dotenv";

dotenv.config();

import {
  FieldValue,
  type DocumentData,
  type DocumentSnapshot,
  type Timestamp,
} from "firebase-admin/firestore";
import { getDb } from "./firebase-admin.ts";

const QUEUE = "notificationQueue";

/** How many queued documents to hold in the listener's window at once. */
const BATCH_SIZE = Number(process.env.WORKER_BATCH_SIZE || 25);
/** Give up (status: "failed") after this many tries. */
const MAX_ATTEMPTS = Number(process.env.WORKER_MAX_ATTEMPTS || 5);
/** A claim older than this is assumed dead and is put back. */
const STUCK_AFTER_MS = Number(process.env.WORKER_STUCK_AFTER_MS || 10 * 60 * 1000);
/** How often to look for those dead claims. */
const SWEEP_EVERY_MS = Number(process.env.WORKER_SWEEP_EVERY_MS || 5 * 60 * 1000);
/** A single delivery may not take longer than this. See runWithTimeout. */
const DELIVER_TIMEOUT_MS = Number(process.env.WORKER_DELIVER_TIMEOUT_MS || 30_000);
/** How far ahead a session may be and still be worth reminding someone about. */
const REMINDER_WINDOW_HOURS = Number(process.env.REMINDER_WINDOW_HOURS || 24);
/** Set to "false" only once deliver() actually talks to a provider. */
const DRY_RUN = (process.env.NOTIFICATION_DRY_RUN ?? "true") !== "false";

const db = getDb();

let draining = false;
let drainRequested = false;
let shuttingDown = false;
const inFlight = new Set<string>();

/** An error that retrying cannot fix. Fails the document on the first try. */
class PermanentError extends Error {}
/** Not an error at all: this document should not be delivered. */
class SkipDelivery extends Error {}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  const maybe = value as Timestamp;
  return typeof maybe.toDate === "function" ? maybe.toDate() : null;
}

/**
 * A provider call with no timeout is how a queue stops forever behind a green
 * service light: one hung HTTP request and drain() never returns, so no later
 * snapshot is ever processed and nothing crashes for the platform to restart.
 */
function runWithTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

/**
 * Has this session already had a reminder delivered by the other producer?
 * Equality-only query, so Firestore serves it from single-field indexes and no
 * composite index is needed.
 */
async function alreadyDelivered(scheduleId: string, selfId: string): Promise<boolean> {
  const snap = await db.collection(QUEUE).where("scheduleId", "==", scheduleId).limit(20).get();
  return snap.docs.some(
    (d) => d.id !== selfId && (d.get("status") === "sent" || d.get("status") === "dry_run"),
  );
}

/**
 * THE ACTUAL SEND - currently a stub.
 * Returns a one-line summary stored on the document, so the record itself says
 * what happened without anyone digging through logs.
 */
async function deliver(id: string, data: DocumentData): Promise<string> {
  const type = String(data.type || "unknown");

  switch (type) {
    case "booking_reminder": {
      const when = toDate(data.startTime);
      if (!when) {
        throw new PermanentError("booking_reminder has no usable startTime");
      }

      const hoursAway = (when.getTime() - Date.now()) / 3_600_000;
      if (hoursAway < 0) {
        throw new SkipDelivery(
          `session was ${Math.abs(Math.round(hoursAway))}h ago - nothing to remind anyone about`,
        );
      }
      if (hoursAway > REMINDER_WINDOW_HOURS) {
        // This is the shape onBookingReminderWrite produces: queued at the
        // moment of booking, for a session that may be weeks out. Sending it
        // would be a "reminder" about a session nobody has got to yet.
        throw new SkipDelivery(
          `session is ${Math.round(hoursAway)}h away (window ${REMINDER_WINDOW_HOURS}h) - ` +
            "queued at booking time, not day-of; the daily cron will queue the real reminder",
        );
      }

      if (data.scheduleId && (await alreadyDelivered(String(data.scheduleId), id))) {
        throw new SkipDelivery("another notification for this booking was already delivered");
      }

      const summary =
        `reminder -> ${data.clientName || "unknown client"} ` +
        `(${data.serviceName || "session"} with ${data.trainerName || "a trainer"} ` +
        `at ${when.toISOString()})`;
      const channel = data.clientPhone
        ? `sms ${data.clientPhone}`
        : data.clientEmail
          ? `email ${data.clientEmail}`
          : "NO CONTACT ON FILE";

      if (DRY_RUN) {
        console.log(`[worker] DRY RUN ${id}: would send ${summary}`);
        console.log(`[worker]   channel=${channel}`);
        return `dry-run: ${summary}`;
      }

      // >>> WIRE A PROVIDER IN HERE <<<
      // Pass the document id as the provider's idempotency key if it supports
      // one - it is the only thing that makes a retry after a half-failed send
      // safe. See the note on markSent() below.
      throw new PermanentError(
        "NOTIFICATION_DRY_RUN is false but no provider is wired into deliver().",
      );
    }

    case "daily_summary": {
      // Written by sendDailySummary in functions/src/index.ts at 6am ET, one
      // per studio with notificationSettings.dailySummaryEnabled.
      const summary =
        `daily summary -> ${data.studioName || data.studioId || "a studio"} ` +
        `(${data.totalBookingsCount ?? 0} booking(s) on ${data.summaryDate || "today"})`;

      if (DRY_RUN) {
        console.log(`[worker] DRY RUN ${id}: would send ${summary}`);
        return `dry-run: ${summary}`;
      }

      // >>> WIRE A PROVIDER IN HERE <<<
      throw new PermanentError(
        "NOTIFICATION_DRY_RUN is false but no provider is wired into deliver().",
      );
    }

    case "weekly_coach_report": {
      const p = (data.payload || {}) as Record<string, unknown>;
      const summary =
        `weekly report -> ${data.trainerName || "coach"} ` +
        `(${p.sessionsCompleted ?? 0} completed, ${p.uniqueClients ?? 0} clients, ` +
        `${p.noShows ?? 0} no-shows, week of ${p.weekStart ?? "?"})`;

      if (DRY_RUN) {
        console.log(`[worker] DRY RUN ${id}: would send ${summary}`);
        console.log(`[worker]   channel=${data.trainerEmail ? "email " + data.trainerEmail : "NO EMAIL ON FILE"}`);
        return `dry-run: ${summary}`;
      }

      // >>> WIRE A PROVIDER IN HERE <<<
      throw new PermanentError(
        "NOTIFICATION_DRY_RUN is false but no provider is wired into deliver().",
      );
    }

    default:
      // A type nobody handles is a bug upstream, not a transient failure, so
      // it must not burn five attempts on its way to the same conclusion.
      throw new PermanentError(`No handler for notification type "${type}"`);
  }
}

/**
 * Move a document from queued to processing, but only if it is still queued.
 * The transaction is what makes a second worker (or a redeploy overlap) safe:
 * whichever reads "queued" first wins and the other walks away. Without it the
 * same client gets two texts.
 */
async function claim(id: string): Promise<DocumentData | null> {
  const ref = db.collection(QUEUE).doc(id);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const data = snap.data()!;
    if (data.status !== "queued") return null;

    tx.update(ref, {
      status: "processing",
      claimedAt: FieldValue.serverTimestamp(),
      attempts: FieldValue.increment(1),
    });
    return { ...data, attempts: (data.attempts || 0) + 1 };
  });
}

/**
 * Record the outcome of a delivery that already happened.
 *
 * This write is retried hard and deliberately never re-queues on failure. The
 * message is gone; putting the document back would send it again. If every
 * attempt fails the document stays "processing" and the sweep will eventually
 * re-queue it - which is the one remaining double-send hole in this design,
 * and the reason deliver() should hand the provider an idempotency key.
 */
async function markSent(
  doc: DocumentSnapshot,
  status: "sent" | "dry_run",
  result: string,
): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await doc.ref.update({
        status,
        sentAt: FieldValue.serverTimestamp(),
        result,
        lastError: FieldValue.delete(),
      });
      return;
    } catch (err) {
      if (attempt === 3) {
        console.error(
          `[worker] CRITICAL: delivered ${doc.id} but could not record it after 3 tries. ` +
            "It may be delivered again by the stuck-document sweep. Error:",
          err,
        );
        return;
      }
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
}

async function handle(doc: DocumentSnapshot): Promise<void> {
  const id = doc.id;
  if (inFlight.has(id)) return;
  inFlight.add(id);

  try {
    const data = await claim(id);
    if (!data) return; // someone else took it, or it moved on

    try {
      const result = await runWithTimeout(deliver(id, data), DELIVER_TIMEOUT_MS, `deliver(${id})`);
      await markSent(doc, DRY_RUN ? "dry_run" : "sent", result);
      console.log(`[worker] ${DRY_RUN ? "dry-run" : "sent"} ${id} (${data.type})`);
    } catch (err: any) {
      if (err instanceof SkipDelivery) {
        await doc.ref.update({
          status: "skipped",
          skippedAt: FieldValue.serverTimestamp(),
          result: `skipped: ${err.message}`,
        });
        console.log(`[worker] skipped ${id} (${data.type}): ${err.message}`);
        return;
      }

      const attempts = Number(data.attempts || 1);
      const permanent = err instanceof PermanentError;
      const giveUp = permanent || attempts >= MAX_ATTEMPTS;

      await doc.ref.update({
        status: giveUp ? "failed" : "queued",
        lastError: String(err?.message || err).slice(0, 500),
        lastFailedAt: FieldValue.serverTimestamp(),
      });
      console.error(
        `[worker] ${giveUp ? "FAILED" : "will retry"} ${id} ` +
          `(attempt ${attempts}/${MAX_ATTEMPTS}${permanent ? ", permanent" : ""}): ` +
          `${err?.message || err}`,
      );
    }
  } finally {
    inFlight.delete(id);
  }
}

/**
 * Process documents one at a time. A snapshot that arrives mid-drain sets
 * drainRequested; the loop below then re-reads the collection rather than
 * trusting another snapshot to turn up. With limit(BATCH_SIZE) and a backlog
 * bigger than that, waiting for a new snapshot means the rest of the backlog
 * sits there until some unrelated write happens to poke the listener.
 */
async function drain(initial: DocumentSnapshot[]): Promise<void> {
  if (draining) {
    drainRequested = true;
    return;
  }
  draining = true;

  try {
    let docs = initial;
    while (docs.length > 0 && !shuttingDown) {
      for (const doc of docs) {
        if (shuttingDown) break;
        await handle(doc);
      }
      if (shuttingDown) break;

      drainRequested = false;
      const next = await db
        .collection(QUEUE)
        .where("status", "==", "queued")
        .limit(BATCH_SIZE)
        .get();
      docs = next.docs;
    }
  } catch (err) {
    console.error("[worker] drain failed:", err);
  } finally {
    draining = false;
    drainRequested = false;
  }
}

/**
 * Rescue documents stuck in "processing". A deploy can stop this worker
 * mid-send: Render sends SIGTERM, the process leaves, and the document sits
 * claimed forever with nobody coming back for it.
 */
async function sweepStuck(): Promise<void> {
  try {
    const snap = await db.collection(QUEUE).where("status", "==", "processing").limit(100).get();
    const cutoff = Date.now() - STUCK_AFTER_MS;
    let recovered = 0;

    for (const doc of snap.docs) {
      const claimedAt = toDate(doc.get("claimedAt"));
      if (!claimedAt || claimedAt.getTime() > cutoff) continue;
      await doc.ref.update({
        status: "queued",
        lastError: `Reclaimed: still processing ${Math.round((Date.now() - claimedAt.getTime()) / 60000)}m after claim.`,
      });
      recovered++;
    }

    if (recovered > 0) console.log(`[worker] sweep put ${recovered} stuck document(s) back in the queue`);
  } catch (err) {
    console.error("[worker] sweep failed:", err);
  }
}

function start(): void {
  console.log(
    `[worker] watching ${QUEUE} (batch=${BATCH_SIZE}, maxAttempts=${MAX_ATTEMPTS}, ` +
      `deliverTimeout=${DELIVER_TIMEOUT_MS}ms, reminderWindow=${REMINDER_WINDOW_HOURS}h, ` +
      `dryRun=${DRY_RUN})`,
  );
  if (DRY_RUN) {
    console.log(
      '[worker] DRY RUN: nothing is sent. Delivered documents are parked as "dry_run", ' +
        "not \"sent\", so the backlog can be replayed once a provider is wired in.",
    );
  }

  const unsubscribe = db
    .collection(QUEUE)
    .where("status", "==", "queued")
    .limit(BATCH_SIZE)
    .onSnapshot(
      (snap) => {
        if (snap.empty || shuttingDown) return;
        console.log(`[worker] ${snap.size} queued document(s)`);
        void drain(snap.docs);
      },
      (err) => {
        // A listener that dies silently is the classic way a queue "stops
        // working" with a green service light. Exit and let Render restart.
        console.error("[worker] listener error, exiting so the platform restarts us:", err);
        process.exit(1);
      },
    );

  const sweepTimer = setInterval(() => void sweepStuck(), SWEEP_EVERY_MS);
  void sweepStuck();

  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[worker] ${signal} received, finishing in-flight work...`);
    unsubscribe();
    clearInterval(sweepTimer);

    const waitedFrom = Date.now();
    const check = setInterval(() => {
      if (inFlight.size === 0 || Date.now() - waitedFrom > 20_000) {
        clearInterval(check);
        console.log("[worker] bye");
        process.exit(0);
      }
    }, 250);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

start();
