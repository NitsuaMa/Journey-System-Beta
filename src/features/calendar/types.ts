/**
 * CALENDAR — view models.
 *
 * Round: Calendar redesign, Sep 2026.
 *
 * The calendar's job is a fast, scannable read of schedule VOLUME and SHAPE:
 * how many sessions, spread across whom, at what times. It is not a booking
 * tool and it is not the Hub — the Hub owns "what is happening right now".
 *
 * Components here consume only these types. `selectors.ts` derives them from
 * ScheduleEntry, so the fuzzy Mindbody trainer matching stays in exactly one
 * place upstream and never leaks into a view.
 */

export interface CalendarSession {
  id: string;
  clientId?: string;
  clientName: string;
  /** Resolved trainer id, or null when the booking names nobody we know. */
  trainerId: string | null;
  trainerName: string;
  start: Date;
  end: Date;
  /** Minutes. Clamped to at least one slot so a zero-length row still draws. */
  durationMin: number;
  serviceName?: string;
  /** A "Unavailability" block rather than a real session. */
  isUnavailability?: boolean;
}

export interface CalendarEvent {
  id: string;
  title: string;
  clientId?: string;
  clientName?: string;
  date: Date;
  endDate?: Date;
  priority?: "High" | "Medium" | "Low" | string;
  type?: string;
}

/** One trainer as the calendar draws them: identity + a stable colour. */
export interface TrainerRef {
  id: string;
  name: string;
  /** First name, or the whole name when there is only one word. */
  shortName: string;
  initials: string;
  /** Index into the palette. Stable for the life of the trainer id. */
  tone: number;
  /**
   * Mindbody staff photo, when there is one. Most staff have none, so the
   * tone-coloured initials are the primary renderer, not a fallback state.
   */
  photoUrl?: string | null;
}

/** A trainer's share of some period. */
export interface TrainerCount {
  trainer: TrainerRef;
  count: number;
}

/** One square on the month grid. */
export interface DayCell {
  date: Date;
  /** yyyy-mm-dd in studio time — the bucket key. */
  key: string;
  dayOfMonth: number;
  inCurrentMonth: boolean;
  isToday: boolean;
  total: number;
  /** Descending by count. The month view shows the top few. */
  byTrainer: TrainerCount[];
  events: CalendarEvent[];
}

/** One bar in the week view's day row. */
export interface DayBar {
  date: Date;
  key: string;
  label: string;
  dayOfMonth: number;
  isToday: boolean;
  count: number;
}

/** One cell of the week view's capacity heatmap. */
export interface HeatCell {
  dayIndex: number;
  bandIndex: number;
  count: number;
  /** 0–1 against the busiest cell of the week. Drives the fill only. */
  intensity: number;
}

export interface TimeBand {
  label: string;
  startHour: number;
  endHour: number;
}

export interface WeekSummary {
  days: DayBar[];
  total: number;
  /** Same seven weekdays, previous week. Null when nothing is loaded there. */
  previousTotal: number | null;
  byTrainer: TrainerCount[];
  bands: TimeBand[];
  heat: HeatCell[];
  /** Busiest single cell, so the heatmap legend can name a real number. */
  peak: number;
  busiestDay: DayBar | null;
}

/** One trainer's row in the day view. */
export interface DayLane {
  trainer: TrainerRef;
  sessions: CalendarSession[];
  count: number;
}

export interface DayPlan {
  lanes: DayLane[];
  /** Whole hours the axis spans, inclusive of start, exclusive of end. */
  startHour: number;
  endHour: number;
  total: number;
  /** Sessions whose trainer could not be resolved. Surfaced, never dropped. */
  unassigned: CalendarSession[];
}
