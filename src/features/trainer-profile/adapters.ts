/**
 * TRAINER PROFILE — view models.
 *
 * The old view did all of this inline, three times over, with a different
 * hand-rolled timestamp reader in each section. Pulling it out means the
 * fuzzy trainer matching and the four shapes a Firestore date can arrive in
 * are handled once and can be tested.
 */
import { toDate } from "../../lib/studio-time";
import { parseSessionDate } from "../../lib/utils";
import type {
  Client,
  ScheduleEntry,
  Studio,
  Trainer,
  WorkoutSession,
} from "../../types";

export interface ScheduleRow {
  id: string;
  clientId?: string;
  clientName: string;
  at: Date;
  isToday: boolean;
  sessionNumber?: number;
  remaining?: number | null;
}

export interface CoachedRow {
  id: string;
  clientId?: string;
  clientName: string;
  at: Date;
}

/**
 * Does this schedule entry or session belong to this trainer?
 *
 * Mindbody bookings frequently carry a trainer NAME and no id, so the name
 * comparison has to stay. It is deliberately last: an id match is certain, a
 * name match is a guess, and "Chris" must not claim "Christine"'s sessions,
 * which is why this is a normalised equality rather than a substring test.
 */
export function isTrainersEntry(
  entry: { trainerId?: string; startedByTrainerId?: string; trainerName?: string; trainerInitials?: string },
  trainer: Trainer,
): boolean {
  if (entry.trainerId && entry.trainerId === trainer.id) return true;
  if (entry.startedByTrainerId && entry.startedByTrainerId === trainer.id) return true;

  const norm = (v?: string) => (v || "").trim().toLowerCase();
  if (entry.trainerInitials && trainer.initials) {
    if (norm(entry.trainerInitials) === norm(trainer.initials)) return true;
  }
  if (entry.trainerName && trainer.fullName) {
    if (norm(entry.trainerName) === norm(trainer.fullName)) return true;
    if (trainer.nickname && norm(entry.trainerName) === norm(trainer.nickname)) return true;
  }
  return false;
}

/** A schedule entry's start, whichever field and shape it arrived in. */
export function scheduleInstant(entry: ScheduleEntry): Date | null {
  return toDate(entry.startTime) || toDate((entry as any).date);
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function upcomingFor(
  schedules: ScheduleEntry[],
  trainer: Trainer,
  clients: Client[],
  now: Date = new Date(),
): ScheduleRow[] {
  const byId = new Map(clients.map((c) => [c.id, c]));

  return schedules
    .filter((s) => s.status !== "Cancelled" && s.status !== "Completed")
    .filter((s) => isTrainersEntry(s as any, trainer))
    .map((s) => {
      const at = scheduleInstant(s);
      if (!at) return null;
      const client = s.clientId ? byId.get(s.clientId) : undefined;
      return {
        id: s.id || `${s.clientId}-${at.getTime()}`,
        clientId: s.clientId,
        clientName: s.clientName || "Unknown client",
        at,
        isToday: isSameDay(at, now),
        sessionNumber: client?.sessionCount,
        remaining: client?.remainingSessions ?? null,
      } as ScheduleRow;
    })
    .filter((row): row is ScheduleRow => row !== null)
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}

export function recentlyCoachedFor(
  sessions: WorkoutSession[],
  trainer: Trainer,
  clients: Client[],
): CoachedRow[] {
  const byId = new Map(clients.map((c) => [c.id, c]));

  return sessions
    .filter((s) => s.status === "Completed" && isTrainersEntry(s, trainer))
    .map((s) => {
      const ms = parseSessionDate(s.date);
      const at = ms > 0 ? new Date(ms) : toDate(s.createdAt);
      if (!at) return null;
      const client = s.clientId ? byId.get(s.clientId) : undefined;
      return {
        id: s.id || `${s.clientId}-${at.getTime()}`,
        clientId: s.clientId,
        clientName: client
          ? `${client.firstName} ${client.lastName}`.trim()
          : s.clientName || "Session",
        at,
      } as CoachedRow;
    })
    .filter((row): row is CoachedRow => row !== null)
    .sort((a, b) => b.at.getTime() - a.at.getTime());
}

/**
 * Studio name for an id, falling back to the id itself.
 *
 * `Studio.id` is optional in the type, so a studio can reach the client
 * without one. Showing the raw id in a muted style is worse than a name and
 * much better than an empty chip nobody can explain.
 */
export function studioNameFor(studios: Studio[], id?: string | null): string | null {
  if (!id) return null;
  const match = studios.find((s) => s.id === id);
  return match?.name || id;
}

/** "Mar 2019" — precise enough for tenure, vague enough not to look like payroll. */
export function monthYear(value: unknown): string | null {
  const d = toDate(value as any);
  if (!d) return null;
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}
