/**
 * KAIZEN ROSTER — the clients a trainer has decided to keep an eye on.
 *
 * Kaizen: there is always room for improvement. Applied here to the coaching
 * rather than to a set.
 *
 * A COLOUR RULE THAT IS NOT DECORATION
 * -----------------------------------
 * The RED kaizen mark means "this rep needs work" in the session grid. The
 * roster must never borrow it, or a glance at a client card cannot separate
 * "I am tracking you" from "you are doing it wrong". Roster components use
 * --tp-kaizen (action blue) and --tp-kaizen-quiet (brand slate) and never
 * --tp-alert. See trainer-profile.tokens.css.
 *
 * WHY AN ARRAY ON THE TRAINER DOCUMENT
 * ------------------------------------
 * `useTrainers` already streams every trainer document to every device. Put
 * the roster there and membership badges work everywhere -- client list,
 * client header, calendar -- for zero extra reads. Forty entries is about
 * 8 KB against a 1 MB document limit. A subcollection would be right at 500
 * entries; at 40 it is a second listener for nothing.
 *
 * The functions below are pure so the cap, the de-duplication and the sort
 * can be tested rather than clicked through. `useKaizenRoster` does the I/O.
 */
import { KAIZEN_ROSTER_MAX, type KaizenReason, type KaizenRosterEntry, type Trainer } from "../../types";
import { toDate } from "../../lib/studio-time";

export const NOTE_MAX = 240;

/**
 * A string discriminant, not a boolean one: this project compiles without
 * `strict`, and TypeScript does not narrow a `ok: true | false` union
 * reliably with strictNullChecks off. Same shape as StaffResolution in the
 * functions package.
 */
export type RosterResult =
  | { kind: "ok"; next: KaizenRosterEntry[] }
  | { kind: "duplicate"; message: string }
  | { kind: "full"; message: string };

export function isOnRoster(trainer: Trainer | null | undefined, clientId: string): boolean {
  return !!trainer?.kaizenRoster?.some((e) => e.clientId === clientId);
}

export function rosterEntryFor(
  trainer: Trainer | null | undefined,
  clientId: string,
): KaizenRosterEntry | null {
  return trainer?.kaizenRoster?.find((e) => e.clientId === clientId) ?? null;
}

export function addToRoster(
  current: KaizenRosterEntry[] | undefined,
  entry: KaizenRosterEntry,
  max: number = KAIZEN_ROSTER_MAX,
): RosterResult {
  const list = current ?? [];

  if (list.some((e) => e.clientId === entry.clientId)) {
    return {
      kind: "duplicate",
      message: `${entry.clientName} is already on your Kaizen Roster.`,
    };
  }

  if (list.length >= max) {
    return {
      kind: "full",
      message: `Your Kaizen Roster is full at ${max}. Remove someone before adding ${entry.clientName}.`,
    };
  }

  return {
    kind: "ok",
    next: [...list, { ...entry, note: entry.note?.slice(0, NOTE_MAX) }],
  };
}

export function removeFromRoster(
  current: KaizenRosterEntry[] | undefined,
  clientId: string,
): KaizenRosterEntry[] {
  return (current ?? []).filter((e) => e.clientId !== clientId);
}

export function updateRosterEntry(
  current: KaizenRosterEntry[] | undefined,
  clientId: string,
  patch: Partial<Pick<KaizenRosterEntry, "reason" | "note" | "reviewBy">>,
): KaizenRosterEntry[] {
  return (current ?? []).map((e) =>
    e.clientId === clientId
      ? { ...e, ...patch, note: (patch.note ?? e.note)?.slice(0, NOTE_MAX) }
      : e,
  );
}

/** An entry whose review date has arrived. Drives the "due" marker and the sort. */
export function isDue(entry: KaizenRosterEntry, nowMs: number = Date.now()): boolean {
  const by = toDate(entry.reviewBy);
  return !!by && by.getTime() <= nowMs;
}

/**
 * Due first, then most recently added.
 *
 * Deliberately NOT alphabetical: this is a working list, and the two
 * questions it answers are "who did I say I would check back on" and "who am
 * I currently thinking about". A name sort answers neither.
 */
export function sortRoster(
  entries: KaizenRosterEntry[] | undefined,
  nowMs: number = Date.now(),
): KaizenRosterEntry[] {
  return [...(entries ?? [])].sort((a, b) => {
    const dueA = isDue(a, nowMs);
    const dueB = isDue(b, nowMs);
    if (dueA !== dueB) return dueA ? -1 : 1;

    if (dueA && dueB) {
      const byA = toDate(a.reviewBy)?.getTime() ?? 0;
      const byB = toDate(b.reviewBy)?.getTime() ?? 0;
      if (byA !== byB) return byA - byB; // most overdue first
    }

    const addedA = toDate(a.addedAt)?.getTime() ?? 0;
    const addedB = toDate(b.addedAt)?.getTime() ?? 0;
    return addedB - addedA;
  });
}

/** Reason counts for the panel's summary line. */
export function countByReason(
  entries: KaizenRosterEntry[] | undefined,
): { reason: KaizenReason; count: number }[] {
  const counts = new Map<KaizenReason, number>();
  for (const e of entries ?? []) {
    counts.set(e.reason, (counts.get(e.reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
}
