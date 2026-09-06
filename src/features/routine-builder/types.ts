/**
 * ROUTINE BUILDER — the mode contract.
 *
 * Round: Unified Routine Builder, Sep 2026.
 *
 * Before this round there were four independent machine-sequence editors:
 * EditRoutineDrawer (client profile), the editor embedded in BriefingScreen,
 * SessionRoutineManagerModal (mid-session), and RoutineTemplateForm (admin) —
 * plus RoutineBuilderView, which no button opened. Three of them had their own
 * hand-rolled sortable row. A trainer moving between the client profile and a
 * live session met two different ways to do the same thing.
 *
 * There is now one component. What differs between surfaces is expressed as a
 * mode, not as a fork: a mode changes what is *shown* and what is *asked for*,
 * never how a sequence is built or ordered.
 *
 * The component is CONTROLLED. It owns no persistence — `machineIds` in,
 * `onChange` out — because the five callers genuinely do persist differently:
 * the client profile writes a routine document plus an audit entry, the
 * briefing may create a routine or may scope the change to today's session,
 * the in-session editor writes nothing at all, and the admin form writes a
 * preset. Pushing that into the builder is what produced four editors the
 * first time.
 */

import type { Client, Machine, RoutinePreset } from "../../types";

export type BuilderMode =
  /** Standalone / admin template authoring. No client, so no history and no
   *  rotation analysis — but full rule checking, because a template that
   *  breaks the sequencing rules propagates to every client it is applied to. */
  | "template"
  /** Client profile: editing the persisted Routine A or B. Everything on. */
  | "baseline"
  /** Pre-session briefing: picking and adjusting today's routine. */
  | "briefing"
  /** Live session: on-the-fly changes. Tightest density, no preset picker. */
  | "in-session";

export interface MachineHistoryEntry {
  lastWeight: string | number | null;
  lastReps: string | number | null;
  lastUnit?: "reps" | "sec";
  lastDate: string | null;
}

export interface RoutineBuilderProps {
  mode: BuilderMode;

  /** The sequence. Controlled — the builder never mutates it in place. */
  machineIds: string[];
  onChange: (machineIds: string[]) => void;

  /** Machines on this studio's floor. Suggestions never leave this set. */
  machines: Machine[];

  /** Which half of the rotation this is, when the surface knows. */
  slot?: "A" | "B" | null;

  /**
   * The other routine in the rotation.
   *
   * Present, the builder runs the twice-weekly analysis and the B-routine
   * panel appears. Absent, both are hidden rather than shown empty — a
   * coverage panel with nothing to compare against is noise.
   */
  counterpartMachineIds?: string[] | null;
  counterpartLabel?: string;

  client?: Client | null;

  /** Last weight / reps / date per machine, for the row readout. */
  history?: Record<string, MachineHistoryEntry>;

  /** Company, studio and trainer presets the caller has already filtered. */
  presets?: RoutinePreset[];
  onApplyPreset?: (preset: RoutinePreset) => void;
  /** Which preset the current sequence came from, for the deviation banner. */
  appliedPresetId?: string | null;

  /** Per-machine coaching note attached to the routine. */
  machineNotes?: Record<string, string>;
  onMachineNotesChange?: (notes: Record<string, string>) => void;

  /**
   * Free text from intake / clinical notes. Matched against the Academy's
   * exercise selection templates to bias suggestions toward the client's
   * actual reported conditions and goals.
   */
  purposeText?: string | null;

  /** Trainer-chosen selection templates, overriding keyword matching. */
  templateIds?: string[];
  onTemplateIdsChange?: (ids: string[]) => void;

  /** True once the client is past the 4–6 workout learning curve. */
  established?: boolean;

  disabled?: boolean;
  className?: string;
  /** Rendered in the builder's header, right side — Save, Cancel, etc. */
  headerActions?: React.ReactNode;
}

/** What each mode turns on. Read this table rather than grepping for `mode ===`. */
export interface ModeConfig {
  showFigure: boolean;
  showCoverage: boolean;
  showSuggestions: boolean;
  showPresets: boolean;
  showHistory: boolean;
  showRotation: boolean;
  showNotes: boolean;
  /** Rows get shorter and the rail narrows. */
  dense: boolean;
  emptyHint: string;
}

export const MODE_CONFIG: Record<BuilderMode, ModeConfig> = {
  template: {
    showFigure: true,
    showCoverage: true,
    showSuggestions: true,
    showPresets: false,
    showHistory: false,
    showRotation: false,
    showNotes: true,
    dense: false,
    emptyHint: "Add machines to build the template. Seven is the Academy's target.",
  },
  baseline: {
    showFigure: true,
    showCoverage: true,
    showSuggestions: true,
    showPresets: true,
    showHistory: true,
    showRotation: true,
    showNotes: true,
    dense: false,
    emptyHint: "Start from a preset, or add machines one at a time.",
  },
  briefing: {
    showFigure: true,
    showCoverage: true,
    showSuggestions: true,
    showPresets: true,
    showHistory: true,
    showRotation: true,
    showNotes: false,
    dense: false,
    emptyHint: "Pick a routine above, or build today's session from scratch.",
  },
  "in-session": {
    showFigure: true,
    showCoverage: true,
    showSuggestions: true,
    showPresets: false,
    showHistory: true,
    showRotation: false,
    showNotes: false,
    dense: true,
    emptyHint: "No machines in this session yet.",
  },
};
