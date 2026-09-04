/**
 * Background Worker — drains the notificationQueue collection.
 *
 * WHY THIS EXISTS
 * ---------------
 * functions/src/index.ts already writes documents into `notificationQueue`
 * ({ type: "booking_reminder", status: "queued", ... }) every time a booking
 * lands for a studio with bookingRemindersEnabled. Nothing has ever read them
 * back out. This process is the missing consumer: it watches the collection,
 * claims one document at a time, hands it to deliver(), and marks it sent or
 * failed.
 *
 * WHY A SEPARATE SERVICE AND NOT A ROUTE ON THE WEB SERVER
 * -------------------------------------------------------
 * Node runs your JavaScript on one thread. A five-year export that spends four
 * seconds stitching records together is four seconds during which the web
 * service answers nobody - the trainer on the floor logging a set watches a
 * spinner. A worker is a second machine with its own CPU: it can be busy for a
 * minute without the app noticing.
 *
 * HOW IT PICKS UP WORK
 * --------------------
 * A Firestore listener, not a polling loop. The listener is pushed to within
 * about a second of a write and costs one read per changed document; polling
 * every ten seconds would cost 8,640 queries a day to mostly find nothing.
 * A slower sweep still runs on a timer, purely to rescue documents left in
 * "processing" by a crash or a deploy mid-job.
 *
 * DELIVERY IS DELIBERATELY STUBBED
 * --------------------------------
 * There is no SMS or email provider in this project yet. Everything up to the
 * send is real - claiming, retrying, marking state - and deliver() logs exactly
 * what would go out. Fill in the two marked spots when a provider is chosen and
 * nothing else here has to change.
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
/** Set to "false" once a real provider is wired in. */
const DRY_RUN = (process.env.NOTIFICATION_DRY_RUN ?? "true") !== "false";

const db = getDb();

let draining = false;
let drainRequested = false;
let shuttingDown = false;
const inFlight = new Set<string>();

function ts(value: unknown): Date | null {
  if (!value) return null;
  const maybe = value as Timestamp;
  return typeof maybe.toDate === "function" ? maybe.toDate() : null;
}

/**
 * THE ACTUAL SEND — currently a stub.
 *
 * Returns a one-line summary that gets stored on the document, so the Firestore
 * record itself tells you what happened without digging through logs.
 */
async function deliver(id: string, data: DocumentData): Promise<string> {
  const type = String(data.type || "unknown");

  switch (type) {
    case "booking_reminder": {
      const when = ts(data.startTime);
      const summary =
        `reminder -> ${data.clientName || "unknown client"} ` +
        `(${data.serviceName || "session"} with ${data.trainerName || "a trainer"}` +
        `${when ? ` at ${when.toISOString()}` : ""})`;

      if (DRY_RUN) {
        console.log(`[worker] DRY RUN ${id}: would send ${summary}`);
        console.log(
          `[worker]   channel=${data.clientPhone ? "sms " + data.clientPhone : data.clientEmail ? "email " + data.clientEmail : "NO CONTACT ON FILE"}`,
        );
        return `dry-run: ${summary}`;
      }

      // >>> WIRE A PROVIDER IN HERE <<<
      // e.g. await twilio.messages.create({ to: data.clientPhone, from: ..., body: ... })
      throw new Error(
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
      throw new Error(
        "NOTIFICATION_DRY_RUN is false but no provider is wired into deliver().",
      );
    }

    default:
      // Unknown types are a bug somewhere upstream, not a transient failure.
      // Marking them failed immediately keeps them out of the retry loop.
      throw new Error(`No handler for notification type "${type}"`);
  }
}

/**
 * Move a document from queued to processing, but only if it is still queued.
 * The transaction is what makes a second worker (or a redeploy overlap) safe:
 * whichever one reads "queued" first wins, the other sees "processing" and
 * walks away. Without it the same client gets two texts.
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

async function handle(doc: DocumentSnapshot): Promise<void> {
  const id = doc.id;
  if (inFlight.has(id)) return;
  inFlight.add(id);

  try {
    const data = await claim(id);
    if (!data) return; // someone else took it, or it moved on

    try {
      const result = await deliver(id, data);
      await doc.ref.update({
        status: "sent",
        sentAt: FieldValue.serverTimestamp(),
        result,
        lastError: FieldValue.delete(),
      });
      console.log(`[worker] sent ${id} (${data.type})`);
    } catch (err: any) {
      const attempts = Number(data.attempts || 1);
      const giveUp = attempts >= MAX_ATTEMPTS;
      await doc.ref.update({
        status: giveUp ? "failed" : "queued",
        lastError: String(err?.message || err).slice(0, 500),
        lastFailedAt: FieldValue.serverTimestamp(),
      });
      console.error(
        `[worker] ${giveUp ? "FAILED PERMANENTLY" : "will retry"} ${id} ` +
          `(attempt ${attempts}/${MAX_ATTEMPTS}): ${err?.message || err}`,
      );
    }
  } finally {
    inFlight.delete(id);
  }
}

/** Process one snapshot's worth of documents, one at a time. */
async function drain(docs: DocumentSnapshot[]): Promise<void> {
  if (draining) {
    drainRequested = true;
    return;
  }
  draining = true;
  try {
    for (const doc of docs) {
      if (shuttingDown) break;
      await handle(doc);
    }
  } finally {
    draining = false;
    if (drainRequested && !shuttingDown) {
      drainRequested = false;
      // Something arrived while we were busy; the listener will re-fire on its
      // own, so there is nothing to do here but clear the flag.
    }
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
      const claimedAt = ts(doc.get("claimedAt"));
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
      `dryRun=${DRY_RUN})`,
  );

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
