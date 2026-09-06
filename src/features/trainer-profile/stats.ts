/**
 * COACHING LOAD — reading the counters, and being honest when they are not
 * there yet.
 *
 * Everything here comes off `trainer.rollups`, which a Cloud Function
 * maintains (functions/src/trainerRollups.ts). Nothing is counted on this
 * side, because the client only ever holds 24 hours of sessions for one
 * studio — which is exactly why the old profile said "0 Logged Sessions" for
 * a trainer with years of history.
 *
 * The one judgement call in this file: what to show BEFORE the admin backfill
 * has run. A lifetime total computed from an unbackfilled counter would be
 * "sessions since we deployed the trigger" wearing the label "Sessions
 * Coached" — a wrong number, presented confidently. So `lifetime` is null
 * until `rollupVersion` is stamped, and the UI leads with the 30-day figure
 * and says why.
 */
import { toDate } from "../../lib/studio-time";
import type { Trainer } from "../../types";

export interface TrainerStats {
  /** Lifetime sessions. Null until the backfill has stamped rollupVersion. */
  lifetime: number | null;
  last30: number | null;
  last90: number | null;
  clients90: number | null;
  avgPerWeek: number | null;
  lastSessionAt: Date | null;
  firstSessionAt: Date | null;
  /** False = the lifetime figure cannot be trusted and is withheld. */
  backfilled: boolean;
  /** The nightly job has not run in over two days; windows may be stale. */
  windowsStale: boolean;
}

/** Windows are recomputed nightly; two missed nights is a real problem. */
const STALE_AFTER_MS = 48 * 60 * 60 * 1000;

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export function deriveTrainerStats(
  trainer: Trainer | null | undefined,
  nowMs: number = Date.now(),
): TrainerStats {
  const rollups = trainer?.rollups;
  const backfilled = typeof rollups?.rollupVersion === "number";

  const windowsUpdatedAt = toDate(rollups?.windowsUpdatedAt);
  const last30 = num(rollups?.sessionsCoached30d);

  return {
    lifetime: backfilled ? (num(rollups?.sessionsCoached) ?? 0) : null,
    last30,
    last90: num(rollups?.sessionsCoached90d),
    clients90: num(rollups?.clientsCoached90d),
    avgPerWeek: num(rollups?.avgPerWeek),
    lastSessionAt: toDate(rollups?.lastSessionAt),
    firstSessionAt: toDate(rollups?.firstSessionAt),
    backfilled,
    // Never called stale before the job has ever run: an unbackfilled trainer
    // has nothing to be stale about, and two warnings about the same missing
    // setup is one warning too many.
    windowsStale:
      last30 !== null && !!windowsUpdatedAt && nowMs - windowsUpdatedAt.getTime() > STALE_AFTER_MS,
  };
}

/** "3 days ago", "today". Null when there is nothing to date. */
export function relativeDay(date: Date | null, nowMs: number = Date.now()): string | null {
  if (!date) return null;
  const days = Math.round((nowMs - date.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}
