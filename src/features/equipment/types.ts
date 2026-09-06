/**
 * EQUIPMENT TAB — view model.
 *
 * Round: Equipment Dual-Pane, Sep 2026.
 *
 * Components in this folder consume ONLY the types below. They never touch a
 * `Machine`, a `MachineCatalogEntry` or `MACHINE_DATABASE` directly — adapters.ts
 * merges those three into `EquipmentMachine` so that when the roster backfill
 * lands and the catalog becomes the single source, exactly one file changes.
 */

import type { MachineNote } from "../../types";

/** Coarse grouping for the summary sentence. Derived, never stored. */
export type EquipmentRegion = "upper" | "lower" | "core" | "neck" | "other";

export const REGION_LABELS: Record<EquipmentRegion, string> = {
  upper: "Upper",
  lower: "Lower",
  core: "Core",
  neck: "Neck",
  other: "Other",
};

/** Order the summary sentence reads in. */
export const REGION_ORDER: EquipmentRegion[] = [
  "upper",
  "lower",
  "core",
  "neck",
  "other",
];

/**
 * One adjustable dial on a machine.
 *
 * `key` is the STORAGE key — whatever `clientMachineSettings.settings` is
 * already keyed by for this machine. For legacy machines that is the human
 * label ("Back Pad"); for catalog machines it is the slug ("back-pad"). The
 * adapter preserves whichever the existing data uses so a redesign never
 * orphans a value a trainer saved last week.
 */
export interface SettingFieldSpec {
  key: string;
  label: string;
  type: "enum" | "number" | "text";
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
  /**
   * Studio standard, shown GHOSTED as placeholder text in an empty field.
   * Never written on save — a ghost is a suggestion, not a value.
   */
  ghost: string | null;
  helpText?: string;
  /**
   * True when this dial is the same for every client on this machine, so it
   * is safe to pre-fill for real (today: Gap = 0). Everything else stays a ghost.
   */
  absolute: boolean;
  absoluteValue?: string;
}

/** Everything we can teach a trainer about setting this machine up. */
export interface MachineGuide {
  setupSummary: string | null;
  executionSummary: string | null;
  setupCues: string[];
  executionCues: string[];
  clinicalWarnings: string[];
  target: string | null;
  posture: string | null;
  requiresHandoff: boolean;
  imageUrl?: string;
}

/**
 * What the client has actually done on a machine, as opposed to what is
 * prescribed. Comes from `client.machineStats` (rolled up on every session
 * save and by the one-time history backfill); until that exists it is
 * reconstructed from whatever sessions the profile has loaded and flagged
 * `partial` so the UI can say so.
 */
export interface MachineUsage {
  /** ISO day of the first logged set, or null if never performed. */
  firstPerformed: string | null;
  lastPerformed: string | null;
  /** Sessions in which the machine was performed (not sets). */
  timesPerformed: number;
  /** Load of the very first set, in lb. */
  firstWeight: number | null;
  /** Most recent load performed, in lb. */
  lastWeight: number | null;
  /**
   * Current load vs the first one ever performed, as a percentage. Null when
   * either end is unknown or the first weight was zero. "Current" is the
   * prescribed current weight when there is one, else the last performed.
   */
  progressionPct: number | null;
  /**
   * Mean seconds under tension per set on this machine, across the logs on
   * hand, or null when nothing has been captured.
   *
   * Always computed from logs, never from the lifetime rollup — the rollup
   * (ClientMachineStat) carries first/last weight and a session count and
   * nothing about time. So this figure can be narrower than `timesPerformed`
   * beside it, and `tutSamples` says how many sets it actually averages.
   */
  averageTutSeconds: number | null;
  tutSamples: number;
  /** True when built from loaded sessions only, not the lifetime rollup. */
  partial: boolean;
}

/** A machine, plus this client's prescription for it. */
export interface EquipmentMachine {
  id: string;
  name: string;
  order: number;
  /** "Simple Pull", "Compound Push" — the chip under the name. */
  kinematic: string | null;
  category: string | null;
  region: EquipmentRegion;

  fields: SettingFieldSpec[];
  guide: MachineGuide | null;
  baselineLoad: { male: number; female: number };
  standardWeights?: { Beginner?: number | string; Intermediate?: number | string; Advanced?: number | string };

  /* ---- this client ---- */
  startingWeight: number | null;
  currentWeight: number | null;
  settings: Record<string, string>;
  notes: MachineNote[];
  /** A note someone ticked "Flag for Maintenance" on. */
  hasMaintenanceFlag: boolean;
  loggedSetCount: number;
  /** First performed · times performed · progression. */
  usage: MachineUsage;
  /**
   * The client trains on this machine: a weight, a setting, or a logged set.
   * Drives both the rail's sections and the summary sentence.
   */
  inUse: boolean;
  /** Has at least one saved setting value — "set up" in the settings sense. */
  isConfigured: boolean;
}

export interface RegionCount {
  region: EquipmentRegion;
  label: string;
  count: number;
}

export interface EquipmentSummary {
  total: number;
  inUse: number;
  /** In-use machines only, non-zero groups only, in REGION_ORDER. */
  byRegion: RegionCount[];
}

/** Which pane the drill-in layout is showing. Ignored when the panes are split. */
export type PaneMode = "list" | "detail";
