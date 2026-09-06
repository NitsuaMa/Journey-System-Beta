/**
 * CALENDAR — derivations.
 *
 * Round: Calendar redesign, Sep 2026.
 *
 * Pure functions only: ScheduleEntry in, view models out. No React, no
 * Firestore, no formatting decisions a component should own.
 *
 * Everything buckets on `studioDateKey`, never on the browser's local day. A
 * 7:00 AM Cleveland session must not land on the previous day for anyone
 * looking at the calendar from another timezone.
 */

import { studioDateKey, zonedHM } from "../../lib/studio-time";
import type { Trainer } from "../../types";
import { initialsOf, shortNameOf, toneFor } from "./trainer-tone";
import type {
  CalendarEvent,
  CalendarSession,
  DayBar,
  DayCell,
  DayLane,
  DayPlan,
  HeatCell,
  TimeBand,
  TrainerCount,
  TrainerRef,
  WeekSummary,
} from "./types";

/* ------------------------------------------------------------------ *
 * Trainers
 * ------------------------------------------------------------------ */

export function toTrainerRef(trainer: Trainer): TrainerRef {
  const name = trainer.fullName || "Unknown";
  return {
    id: trainer.id || name,
    name,
    shortName: shortNameOf(name),
    initials: trainer.initials || initialsOf(name),
    tone: toneFor(trainer.id || name),
    // A locally set photo beats the Mindbody one; absent both, the tone-coloured
    // initials are what draws, which is the case for most staff.
    photoUrl: trainer.photoUrl || trainer.mindbody?.imageUrl || null,
  };
}

/** A stand-in for a booking whose trainer we could not resolve. */
export function unknownTrainerRef(name: string): TrainerRef {
  return {
    id: `unknown:${name}`,
    name: name || "Unassigned",
    shortName: shortNameOf(name || "Unassigned"),
    initials: initialsOf(name || "?"),
    tone: toneFor(name),
  };
}

/* ------------------------------------------------------------------ *
 * Bucketing
 * ------------------------------------------------------------------ */

export function dayKey(date: Date): string {
  return studioDateKey(date) || "";
}

function bucketByDay(sessions: CalendarSession[]): Map<string, CalendarSession[]> {
  const map = new Map<string, CalendarSession[]>();
  for (const s of sessions) {
    const key = dayKey(s.start);
    if (!key) continue;
    const bucket = map.get(key);
    if (bucket) bucket.push(s);
    else map.set(key, [s]);
  }
  return map;
}

function countByTrainer(
  sessions: CalendarSession[],
  refs: Map<string, TrainerRef>,
): TrainerCount[] {
  const counts = new Map<string, number>();
  for (const s of sessions) {
    if (s.isUnavailability) continue;
    const id = s.trainerId || `unknown:${s.trainerName}`;
    counts.set(id, (counts.get(id) || 0) + 1);
  }

  const out: TrainerCount[] = [];
  for (const [id, count] of counts) {
    const trainer =
      refs.get(id) ||
      unknownTrainerRef(id.startsWith("unknown:") ? id.slice(8) : "Unassigned");
    out.push({ trainer, count });
  }

  // Descending by volume, then alphabetical so equal counts do not shuffle
  // between renders — a list that reorders itself is unreadable at a glance.
  out.sort((a, b) => b.count - a.count || a.trainer.name.localeCompare(b.trainer.name));
  return out;
}

/* ------------------------------------------------------------------ *
 * Month
 * ------------------------------------------------------------------ */

/** The 42-cell month matrix, Sunday-first, with each day's load attached. */
export function buildMonthCells(
  monthAnchor: Date,
  sessions: CalendarSession[],
  events: CalendarEvent[],
  refs: Map<string, TrainerRef>,
  today: Date = new Date(),
): DayCell[] {
  const year = monthAnchor.getFullYear();
  const month = monthAnchor.getMonth();
  const first = new Date(year, month, 1);
  const leading = first.getDay();

  const byDay = bucketByDay(sessions);
  const todayKey = dayKey(today);

  const eventsByDay = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    if (!e.date) continue;
    // An event can span days; register it on each day it covers so a holiday
    // does not vanish from the middle of its own range.
    const last = e.endDate && e.endDate > e.date ? e.endDate : e.date;
    const cursor = new Date(e.date);
    cursor.setHours(12, 0, 0, 0);
    const stop = new Date(last);
    stop.setHours(12, 0, 0, 0);
    let guard = 0;
    while (cursor <= stop && guard < 400) {
      const key = dayKey(cursor);
      const bucket = eventsByDay.get(key);
      if (bucket) bucket.push(e);
      else eventsByDay.set(key, [e]);
      cursor.setDate(cursor.getDate() + 1);
      guard += 1;
    }
  }

  const cells: DayCell[] = [];
  for (let i = 0; i < 42; i++) {
    const date = new Date(year, month, i - leading + 1);
    const key = dayKey(date);
    const daySessions = byDay.get(key) || [];
    cells.push({
      date,
      key,
      dayOfMonth: date.getDate(),
      inCurrentMonth: date.getMonth() === month,
      isToday: key === todayKey,
      total: daySessions.filter((s) => !s.isUnavailability).length,
      byTrainer: countByTrainer(daySessions, refs),
      events: eventsByDay.get(key) || [],
    });
  }
  return cells;
}

/* ------------------------------------------------------------------ *
 * Week
 * ------------------------------------------------------------------ */

export function startOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

export function weekDays(date: Date): Date[] {
  const start = startOfWeek(date);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

/**
 * Four bands rather than 28 half-hour rows.
 *
 * A studio manager asks "are mornings or evenings packed", not "what happens
 * at 2:30". Four rows fit without scrolling and each cell holds enough
 * sessions to actually differ from its neighbours — a 28-row heatmap of a
 * 40-session week is almost entirely 0s and 1s, which shows nothing.
 */
export const TIME_BANDS: TimeBand[] = [
  { label: "Early", startHour: 0, endHour: 9 },
  { label: "Morning", startHour: 9, endHour: 12 },
  { label: "Midday", startHour: 12, endHour: 16 },
  { label: "Evening", startHour: 16, endHour: 24 },
];

function bandIndexFor(date: Date): number {
  const hm = zonedHM(date);
  const hour = hm ? hm.hour : date.getHours();
  for (let i = 0; i < TIME_BANDS.length; i++) {
    if (hour >= TIME_BANDS[i].startHour && hour < TIME_BANDS[i].endHour) return i;
  }
  return TIME_BANDS.length - 1;
}

export function buildWeekSummary(
  anchor: Date,
  sessions: CalendarSession[],
  refs: Map<string, TrainerRef>,
  today: Date = new Date(),
): WeekSummary {
  const days = weekDays(anchor);
  const byDay = bucketByDay(sessions.filter((s) => !s.isUnavailability));
  const todayKey = dayKey(today);

  const bars: DayBar[] = days.map((date) => {
    const key = dayKey(date);
    return {
      date,
      key,
      label: date.toLocaleDateString(undefined, { weekday: "short" }),
      dayOfMonth: date.getDate(),
      isToday: key === todayKey,
      count: (byDay.get(key) || []).length,
    };
  });

  const inWeek: CalendarSession[] = [];
  for (const d of days) inWeek.push(...(byDay.get(dayKey(d)) || []));

  // Previous week, from the same already-loaded set. Null rather than 0 when
  // nothing is loaded back there, so the delta never claims a fake -100%.
  const prevDays = weekDays(new Date(days[0].getTime() - 7 * 86400000));
  let previousTotal: number | null = 0;
  let sawAny = false;
  for (const d of prevDays) {
    const n = (byDay.get(dayKey(d)) || []).length;
    if (n > 0) sawAny = true;
    previousTotal = (previousTotal || 0) + n;
  }
  if (!sawAny) previousTotal = null;

  const heat: HeatCell[] = [];
  const counts = new Map<string, number>();
  for (let di = 0; di < days.length; di++) {
    const dayS = byDay.get(dayKey(days[di])) || [];
    for (const s of dayS) {
      const bi = bandIndexFor(s.start);
      const k = `${di}:${bi}`;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
  }
  let peak = 0;
  for (const n of counts.values()) peak = Math.max(peak, n);
  for (let di = 0; di < days.length; di++) {
    for (let bi = 0; bi < TIME_BANDS.length; bi++) {
      const count = counts.get(`${di}:${bi}`) || 0;
      heat.push({
        dayIndex: di,
        bandIndex: bi,
        count,
        intensity: peak > 0 ? count / peak : 0,
      });
    }
  }

  const busiestDay = bars.reduce<DayBar | null>(
    (best, b) => (b.count > 0 && (!best || b.count > best.count) ? b : best),
    null,
  );

  return {
    days: bars,
    total: inWeek.length,
    previousTotal,
    byTrainer: countByTrainer(inWeek, refs),
    bands: TIME_BANDS,
    heat,
    peak,
    busiestDay,
  };
}

/* ------------------------------------------------------------------ *
 * Day
 * ------------------------------------------------------------------ */

/** Minutes from midnight, in STUDIO time. */
export function studioMinutes(date: Date): number {
  const hm = zonedHM(date);
  return hm ? hm.hour * 60 + hm.minute : date.getHours() * 60 + date.getMinutes();
}

/**
 * One row per trainer, sessions laid along a shared time axis.
 *
 * The axis is derived from the day's real bookings rather than a fixed
 * 6 AM – 8 PM, so a quiet Saturday that runs 8–11 draws three hours wide
 * instead of fourteen mostly-empty ones. Padded to whole hours and floored at
 * a two-hour span so a single booking still gets a readable axis.
 */
export function buildDayPlan(
  date: Date,
  sessions: CalendarSession[],
  refs: Map<string, TrainerRef>,
): DayPlan {
  const key = dayKey(date);
  const today = sessions.filter((s) => dayKey(s.start) === key);

  const laneMap = new Map<string, DayLane>();
  const unassigned: CalendarSession[] = [];

  for (const s of today) {
    const id = s.trainerId;
    if (!id) {
      unassigned.push(s);
      continue;
    }
    const trainer = refs.get(id) || unknownTrainerRef(s.trainerName);
    const lane = laneMap.get(id);
    if (lane) lane.sessions.push(s);
    else laneMap.set(id, { trainer, sessions: [s], count: 0 });
  }

  const lanes = Array.from(laneMap.values());
  for (const lane of lanes) {
    lane.sessions.sort((a, b) => a.start.getTime() - b.start.getTime());
    lane.count = lane.sessions.filter((s) => !s.isUnavailability).length;
  }
  lanes.sort((a, b) => b.count - a.count || a.trainer.name.localeCompare(b.trainer.name));

  let min = Infinity;
  let max = -Infinity;
  for (const s of today) {
    min = Math.min(min, studioMinutes(s.start));
    max = Math.max(max, studioMinutes(s.start) + Math.max(s.durationMin, 30));
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = 6 * 60;
    max = 20 * 60;
  }

  let startHour = Math.max(0, Math.floor(min / 60));
  let endHour = Math.min(24, Math.ceil(max / 60));
  if (endHour - startHour < 2) endHour = Math.min(24, startHour + 2);

  return {
    lanes,
    startHour,
    endHour,
    total: today.filter((s) => !s.isUnavailability).length,
    unassigned,
  };
}
