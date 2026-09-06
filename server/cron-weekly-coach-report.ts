/**
 * Render Cron Job: Sunday-night summary for each coach.
 *
 * Schedule: 0 0 * * 1  (00:00 UTC Monday = 8pm Eastern Sunday in summer,
 *                       7pm Sunday in winter)
 *
 * Counts the whole Monday-to-Sunday week each trainer worked - completed
 * sessions, no-shows, cancellations, distinct clients, busiest day - and queues
 * one weekly_coach_report notification per trainer for the worker to send.
 *
 * The window is the full week, deliberately including the few hours after the
 * job fires on Sunday evening. Ending it at the fire time would lose every
 * late-Sunday session from every report forever.
 *
 * The numbers come from the schedules collection, which is the one place a
 * session's outcome is recorded (Completed / No-Show / Cancelled / Scheduled).
 * Nothing is inferred: a trainer with no bookings gets no email rather than an
 * email full of zeroes.
 */

import { Timestamp } from "firebase-admin/firestore";
import { runCron } from "./cron-runtime.ts";
import { getDb } from "./firebase-admin.ts";
import { startOfDaysAgoIn, startOfDaysAheadIn, startOfWeekIn, ymdIn } from "./time-zone.ts";

const TZ = process.env.REMINDER_TIMEZONE || "America/New_York";
const QUEUE = "notificationQueue";

interface CoachWeek {
  trainerId: string;
  trainerName: string;
  completed: number;
  noShows: number;
  cancelled: number;
  stillScheduled: number;
  clientIds: Set<string>;
  perDay: Record<string, number>;
}

async function queueWeeklyCoachReports(): Promise<void> {
  const db = getDb();

  const now = new Date();
  let weekStart = startOfWeekIn(TZ, now);

  // Two things this guards against. First, the window must be the WHOLE
  // Monday-to-Monday week, not Monday-to-right-now: ending it at the fire time
  // drops Sunday-evening sessions out of this week's report, and the next run
  // starts from the following Monday, so they are never counted at all.
  // Second, if REMINDER_TIMEZONE is ever set to a zone at or east of UTC, then
  // at 00:00 UTC Monday it is already Monday there, startOfWeekIn returns the
  // week that has not happened yet, and the job cheerfully reports nothing at
  // all with a green tick. Stepping back a week is the honest answer.
  if (now.getTime() - weekStart.getTime() < 24 * 60 * 60 * 1000) {
    console.log(
      `[coach-report] only ${Math.round((now.getTime() - weekStart.getTime()) / 3600000)}h ` +
        `into the local week - reporting the previous week instead`,
    );
    weekStart = startOfDaysAgoIn(TZ, 7, weekStart);
  }

  const weekEnd = startOfDaysAheadIn(TZ, 7, weekStart);
  const weekStartYmd = ymdIn(TZ, weekStart);

  console.log(
    `[coach-report] week of ${weekStartYmd} (${TZ}): ` +
      `${weekStart.toISOString()} -> ${weekEnd.toISOString()}`,
  );

  const snap = await db
    .collection("schedules")
    .where("startTime", ">=", Timestamp.fromDate(weekStart))
    .where("startTime", "<", Timestamp.fromDate(weekEnd))
    .get();

  console.log(`[coach-report] ${snap.size} booking(s) in the window`);
  if (snap.empty) return;

  const byCoach = new Map<string, CoachWeek>();

  for (const doc of snap.docs) {
    const s = doc.data();
    // Bookings that never resolved to a trainer id still belong to a named
    // trainer; grouping on the name keeps them in someone's report instead of
    // dropping them silently.
    const key = String(s.trainerId || s.trainerName || "unassigned");

    let coach = byCoach.get(key);
    if (!coach) {
      coach = {
        trainerId: String(s.trainerId || ""),
        trainerName: String(s.trainerName || "Unassigned"),
        completed: 0,
        noShows: 0,
        cancelled: 0,
        stillScheduled: 0,
        clientIds: new Set(),
        perDay: {},
      };
      byCoach.set(key, coach);
    }

    switch (s.status) {
      case "Completed":
        coach.completed++;
        break;
      case "No-Show":
        coach.noShows++;
        break;
      case "Cancelled":
        coach.cancelled++;
        break;
      default:
        coach.stillScheduled++;
    }

    if (s.clientId) coach.clientIds.add(String(s.clientId));

    const startedAt = s.startTime?.toDate?.();
    if (startedAt) {
      const day = ymdIn(TZ, startedAt);
      coach.perDay[day] = (coach.perDay[day] || 0) + 1;
    }
  }

  const trainers = await db.collection("trainers").get();
  const emailById = new Map(trainers.docs.map((d) => [d.id, d.get("email") || null]));
  const nameById = new Map(trainers.docs.map((d) => [d.id, d.get("fullName") || null]));

  let queued = 0;
  let already = 0;

  for (const coach of byCoach.values()) {
    const busiest = Object.entries(coach.perDay).sort(([, a], [, b]) => b - a)[0];
    const docId = `coachreport_${coach.trainerId || coach.trainerName.replace(/[^\w-]/g, "_")}_${weekStartYmd}`;

    try {
      await db
        .collection(QUEUE)
        .doc(docId)
        .create({
          type: "weekly_coach_report",
          trainerId: coach.trainerId || null,
          trainerName: nameById.get(coach.trainerId) || coach.trainerName,
          trainerEmail: emailById.get(coach.trainerId) || null,
          status: "queued",
          attempts: 0,
          source: "cron-weekly-coach-report",
          createdAt: Timestamp.now(),
          payload: {
            weekStart: weekStartYmd,
            weekEnd: ymdIn(TZ, new Date(weekEnd.getTime() - 1000)),
            sessionsCompleted: coach.completed,
            noShows: coach.noShows,
            cancelled: coach.cancelled,
            stillScheduled: coach.stillScheduled,
            uniqueClients: coach.clientIds.size,
            busiestDay: busiest ? { date: busiest[0], sessions: busiest[1] } : null,
          },
        });
      queued++;
      console.log(
        `[coach-report] ${coach.trainerName}: ${coach.completed} completed, ` +
          `${coach.noShows} no-show, ${coach.clientIds.size} clients`,
      );
    } catch (err: any) {
      if (err?.code === 6) already++;
      else throw err;
    }
  }

  console.log(`[coach-report] queued ${queued} report(s), ${already} already queued`);
}

void runCron("cron-weekly-coach-report", queueWeeklyCoachReports);
