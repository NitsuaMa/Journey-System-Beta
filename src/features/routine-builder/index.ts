/**
 * Routine Builder — public surface.
 *
 * Round: Unified Routine Builder, Sep 2026.
 *
 * Callers should need `RoutineBuilder` and the types. Everything else is
 * exported for the surfaces that show a piece of the analysis outside the
 * builder itself — the Routines tab renders a coverage strip beside its
 * read-only cards, and the briefing shows the rotation panel before a routine
 * has been chosen.
 */

export { RoutineBuilder } from "./RoutineBuilder";
export { CoverageStrip } from "./CoverageStrip";
export { RoutineFigure } from "./RoutineFigure";
export { RotationPanel } from "./RotationPanel";
export { SuggestionRail } from "./SuggestionRail";
export { MachinePicker } from "./MachinePicker";
export { SequenceMachineRow } from "./SequenceMachineRow";
export { ViolationCard } from "./ViolationCard";

export type { RoutineBuilderProps, BuilderMode, MachineHistoryEntry, ModeConfig } from "./types";
export { MODE_CONFIG } from "./types";

export * from "./academy";
export {
  analyzeRoutine,
  analyzeRotation,
  autoSequence,
  findViolations,
  muscleLabel,
  normalizeIds,
  resolveRoutineAnatomy,
  substitutesFor,
  suggestMachines,
  type CategoryCoverage,
  type RotationAnalysis,
  type RoutineAnalysis,
  type RoutineAnatomy,
  type Suggestion,
  type Violation,
} from "./engine";
