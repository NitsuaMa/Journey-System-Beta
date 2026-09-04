/**
 * Render Cron Job: today's session reminders.
 *
 * Schedule: 0 11 * * *  (11:00 UTC = 7am Eastern in summer, 6am in winter)
 *
 * WHAT IT DOES
 * ------------
 * Reads every schedule document whose startTime falls inside today (today as
 * the STUDIO reckons it, not as the UTC server clock does), and writes one
 * queued notification per client into notificationQueue. It does not send
 * anything itself - server/worker.ts does the sending, so a slow or flaky
 * provider can never make this job overrun its window.
 *
 * IDEMPOTENCE
 * -----------
 * Each reminder is written at a deterministic document id,
 * reminder_<scheduleId>_<YYYY-MM-DD>, with create() rather than add().
 * create() fails if the id already exists, so running this twice - a retry, a
 * manual run, a schedule you changed your mind about - cannot double-text a
 * client. The second run reports them as "already queued" and exits clean.
 *
 * QUERY SHAPE
 * -----------
 * The range is on startTime alone and status is filtered in memory on purpose.
 * Adding .where("status", "==", "Scheduled") to the query would need a
 * composite index that firestore.indexes.json does not have, and the job would
 * die on a FAILED_PRECONDITION the first morning it ran. Today's bookings are
 * tens of documents; filtering them here costs nothing.
 */

import { Timestamp, type DocumentData } from "firebase-admin/firestore";
import { runCron } from "./cron-runtime.ts";
import { getDb } from "./firebase-admin.ts";
import { startOfDayIn, ymdIn } from "./time-zone.ts";

const TZ = process.env.REMINDER_TIMEZONE || "America/New_York";
const QUEUE = "notificationQueue";

/** Firestore getAll takes at most 300 references per call. */
async function fetchByIds(
  db: FirebaseFirestore.Firestore,
  collection: string,
  ids: string[],
): Promise<Map<string, DocumentData>> {
  const out = new Map<string, DocumentData>();
  const unique = [...new Set(ids.filter(Boolean))];

  for (let i = 0; i < unique.length; i += 300) {
    const refs = unique.slice(i, i + 300).map((id) => db.collection(collection).doc(id));
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) {
      if (snap.exists) out.set(snap.id, snap.data()!);
    }
  }
  return out;
}

async function queueDailyReminders(): Promise<void> {
  const db = getDb();

  const today = ymdIn(TZ);
  const dayStart = startOfDayIn(TZ, today);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  console.log(
    `[reminders] studio day ${today} (${TZ}) = ` +
      `${dayStart.toISOString()} -> ${dayEnd.toISOString()}`,
  );

  const snap = await db
    .collection("schedules")
    .where("startTime", ">=", Timestamp.fromDate(dayStart))
    .where("startTime", "<", Timestamp.fromDate(dayEnd))
    .get();

  const todays = snap.docs.filter((d) => d.get("status") === "Scheduled");
  console.log(
    `[reminders] ${snap.size} booking(s) today, ${todays.length} still Scheduled ` +
      `(${snap.size - todays.length} cancelled/completed/no-show)`,
  );
  if (todays.length === 0) return;

  // Reminders are opt-in per studio - the same flag functions/src/index.ts
  // checks. Without this log, a studio that never set it looks like a broken
  // cron job rather than an unticked box.
  const studiosSnap = await db.collection("studios").get();
  const remindersOn = new Set(
    studiosSnap.docs
      .filter((d) => d.get("notificationSettings")?.bookingRemindersEnabled === true)
      .map((d) => d.id),
  );
  console.log(
    `[reminders] ${remindersOn.size} of ${studiosSnap.size} studio(s) have ` +
      "notificationSettings.bookingRemindersEnabled = true",
  );

  const clients = await fetchByIds(
    db,
    "clients",
    todays.map((d) => String(d.get("clientId") || "")),
  );

  let queued = 0;
  let already = 0;
  let skippedStudio = 0;
  let noContact = 0;

  for (const doc of todays) {
    const s = doc.data();
    const studioId = String(s.studioId || "");

    if (!remindersOn.has(studioId)) {
      skippedStudio++;
      continue;
    }

    const client = s.clientId ? clients.get(String(s.clientId)) : undefined;
    if (!client?.phone && !client?.email) noContact++;

    const id = `reminder_${doc.id}_${today}`;
    try {
      await db.collection(QUEUE).doc(id).create({
        type: "booking_reminder",
        scheduleId: doc.id,
        studioId,
        clientId: s.clientId || null,
        clientName: s.clientName || "Unknown Client",
        clientPhone: client?.phone || null,
        clientEmail: client?.email || null,
        trainerName: s.trainerName || "Unknown Trainer",
        serviceName: s.serviceName || null,
        startTime: s.startTime,
        status: "queued",
        attempts: 0,
        source: "cron-daily-reminders",
        createdAt: Timestamp.now(),
      });
      queued++;
    } catch (err: any) {
      // 6 = ALREADY_EXISTS. Anything else is real and should fail the run.
      if (err?.code === 6) already++;
      else throw err;
    }
  }

  console.log(
    `[reminders] queued ${queued}, already queued ${already}, ` +
      `skipped ${skippedStudio} (studio opted out), ${noContact} queued with no phone or email on file`,
  );
}

void runCron("cron-daily-reminders", queueDailyReminders);
