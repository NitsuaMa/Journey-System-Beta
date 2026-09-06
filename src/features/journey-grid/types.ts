/**
 * Journey Grid — shared types
 *
 * These are deliberately *view models*, not Firestore documents. The adapter
 * in `adapters.ts` turns your existing `WorkoutSession` / `ExerciseLog` /
 * `Machine` records into these shapes once, so the grid itself never has to
 * parse strings ("116") or guess whether a log is reps or a static hold.
 */

/** Matches the existing `RepQuality` in src/types.ts: 1 = poor, 2 = completed, 3 = max strength. */
export type RepQuality = 1 | 2 | 3;

export type MovementGroup = "Neck" | "Lower Body" | "Push" | "Pull" | "Core";

/** One column of the timeline. Always sorted oldest → newest before it reaches the grid. */
export interface JourneySession {
  id: string;
  sessionNumber: number;
  /** ISO date (YYYY-MM-DD). Display formatting happens in the grid. */
  date: string;
  trainerInitials: string;
  trainerName?: string;
}

/** One completed set = one cell. */
export interface JourneySet {
  sessionId: string;
  /** Load in lb. */
  weight: number;
  /** Reps to failure — absent when the set was a timed static contraction. */
  reps?: number;
  /** Seconds under tension for a TSC / static hold. */
  seconds?: number;
  isTSC?: boolean;
  quality: RepQuality;
  /** Unilateral machines log a side. Kept so a cell can show "L 12 · R 10". */
  side?: "L" | "R";
  note?: string;
}

export interface JourneyMachine {
  id: string;
  name: string;
  group: MovementGroup;
  /** e.g. { G: "9", S: "8" } — rendered as the settings rail under the name.
   *  Keys are the short forms orderMachineSettings() produces, already in
   *  the app's canonical order (Gap first, then the machine's own order). */
  settings?: Record<string, string>;
  /** Short key → full name, e.g. { G: "Gap", B: "Back Pad" }. The rail shows
   *  the short key and speaks the full one, so "B 6" is never a guess. */
  settingLabels?: Record<string, string>;
  /** The ★ "core lift" flag in the current UI. */
  starred?: boolean;
  /** True when the client has an important machine note — shows an alert glyph. */
  alert?: boolean;
  /** Number of machine notes on file — shows the note button when > 0 (or when onMachineNote is wired). */
  noteCount?: number;
  /** Unilateral machine (Torso Rotation): today's input logs Left and Right separately. */
  sides?: boolean;
}

export interface JourneyRow {
  machine: JourneyMachine;
  /** Keyed by session id. */
  sets: Record<string, JourneySet>;
  /** First weight ever recorded (falls back to the earliest set). */
  startingWeight?: number;
  startingWeightDate?: string;
  /** The prescribed weight from clientMachineSettings.currentWeight. Pre-fills Today. */
  prescribedWeight?: number;
}

/**
 * The Analytics column's metric. The column header cycles through these in
 * this order; every row shows the same metric at once.
 */
export type StatMetric = "first" | "low" | "high" | "mostReps" | "fewestReps";

/** Live (today) values for one machine while a session is running. */
export interface LiveSet {
  weight: number | null;
  reps: number | null;
  seconds: number | null;
  isTSC: boolean;
  quality: RepQuality | null;
  /** Right side, only for machines with `sides` (the fields above are then the Left side). */
  repsR?: number | null;
  secondsR?: number | null;
  qualityR?: RepQuality | null;
}

export interface LiveColumn {
  /** Today's session header. */
  session: JourneySession;
  /** Machine ids in routine order. Rows not listed here render as "not in today's routine". */
  routineMachineIds: string[];
  values: Record<string, LiveSet>;
  onChange: (machineId: string, patch: Partial<LiveSet>) => void;
  /** Adds a non-routine machine to today's session. */
  onAddMachine?: (machineId: string) => void;
  /** Machine currently in focus (the set being performed right now). */
  focusMachineId?: string | null;
  onFocusMachine?: (machineId: string) => void;
  /** Weight stepper increment in lb (MedX-style machines move in 2 lb steps). */
  weightStep?: number;
  /**
   * Reorder mode: today's routine rows grow move/remove controls in place.
   *
   * Controls rather than drag, and that is forced by the grid's own
   * architecture as much as chosen. `.jg-row` is `display: contents` so that
   * every row's columns align against one shared `grid-template-columns` and
   * three of its cells can be independently sticky. An element with
   * `display: contents` generates no box, so dnd-kit's transform lands on
   * nothing and its collision measurement has no rect to read. Making rows
   * draggable would mean giving each one a real box and rebuilding the
   * column alignment on subgrid — a large change to the one screen a trainer
   * uses with a client standing in front of them.
   *
   * Two arrows and an X in a cell that already exists cost nothing, work
   * under a thumb, and are the whole of what was asked for.
   */
  reorder?: boolean;
  onMoveMachine?: (machineId: string, direction: -1 | 1) => void;
  onRemoveMachine?: (machineId: string) => void;
}
