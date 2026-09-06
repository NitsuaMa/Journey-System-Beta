/**
 * The client model, lit by the whole routine rather than by one machine.
 *
 * Round: Unified Routine Builder, Sep 2026.
 *
 * Wraps the existing BodyModel — the same figure the Catalog uses — so there
 * is still exactly one component that knows the highlighter library's slug
 * vocabulary. What is new here is the union: a routine lights up everything
 * its machines reach, with primary winning over secondary wherever both claim
 * a region (see resolveRoutineAnatomy).
 *
 * Two behaviours worth knowing:
 *
 * - The view flips itself. Trainers build routines that are mostly posterior
 *   (rows, pulldowns, leg curls, lumbar) or mostly anterior, and making them
 *   tap "Back" to discover that four of their seven machines were invisible
 *   is the same bug the Catalog had with Hip Abduction. So the default side
 *   is whichever shows more of the routine's primary targets, and it re-picks
 *   as the routine changes — until the trainer chooses a side, after which it
 *   stays put.
 *
 * - The figure follows the client's own record. Gender comes from
 *   Client.gender, mapped through the union's loose values; a trainer can
 *   still flip it, because a client's stored value can be wrong or absent and
 *   the figure is a teaching aid, not a record.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { BodyModel } from "../../components/anatomy/BodyModel";
import { isMuscleVisibleOn } from "../../types/machines";
import { resolveRoutineAnatomy } from "./engine";
import type { MuscleId } from "../../data/machine-anatomy-map";

export interface RoutineFigureProps {
  machineIds: string[];
  /** From Client.gender. "Other", empty and unknown values fall back to male. */
  gender?: string | null;
  /**
   * Highlight one machine on its own — used while a suggestion or picker item
   * is focused, so the trainer sees what that machine would add before adding
   * it. Falls back to the whole routine when null.
   */
  previewMachineId?: string | null;
  scale?: number;
}

function toFigureGender(value: string | null | undefined): "male" | "female" {
  const g = (value ?? "").trim().toLowerCase();
  return g === "female" || g === "f" ? "female" : "male";
}

function sideShowingMost(primary: MuscleId[]): "front" | "back" {
  if (primary.length === 0) return "front";
  const front = primary.filter((m) => isMuscleVisibleOn(m, "front")).length;
  const back = primary.filter((m) => isMuscleVisibleOn(m, "back")).length;
  return back > front ? "back" : "front";
}

export function RoutineFigure({
  machineIds,
  gender,
  previewMachineId = null,
  scale = 1,
}: RoutineFigureProps) {
  const anatomy = useMemo(
    () => resolveRoutineAnatomy(previewMachineId ? [previewMachineId] : machineIds),
    [machineIds, previewMachineId],
  );

  const autoSide = sideShowingMost(anatomy.primary);
  const [side, setSide] = useState<"front" | "back">(autoSide);
  const [pinnedSide, setPinnedSide] = useState(false);
  const [figureGender, setFigureGender] = useState<"male" | "female">(() => toFigureGender(gender));
  const pinnedGender = useRef(false);

  useEffect(() => {
    if (!pinnedSide) setSide(autoSide);
  }, [autoSide, pinnedSide]);

  useEffect(() => {
    if (!pinnedGender.current) setFigureGender(toFigureGender(gender));
  }, [gender]);

  const chooseSide = (next: "front" | "back") => {
    setPinnedSide(true);
    setSide(next);
  };
  const chooseGender = (next: "male" | "female") => {
    pinnedGender.current = true;
    setFigureGender(next);
  };

  return (
    <div className="rb-rail__figure">
      <div className="rb-figure">
        <BodyModel
          primary={anatomy.primary}
          secondary={anatomy.secondary}
          gender={figureGender}
          view={side}
          scale={scale}
          colors={["var(--rb-muscle-primary)", "var(--rb-muscle-secondary)"] as [string, string]}
          baseFill="var(--rb-muscle-base)"
        />
      </div>

      <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", justifyContent: "center" }}>
        <div className="rb-seg" role="group" aria-label="Which side of the body to show">
          <button
            type="button"
            className="rb-seg__btn"
            aria-pressed={side === "front"}
            onClick={() => chooseSide("front")}
          >
            Front
          </button>
          <button
            type="button"
            className="rb-seg__btn"
            aria-pressed={side === "back"}
            onClick={() => chooseSide("back")}
          >
            Back
          </button>
        </div>

        <div className="rb-seg" role="group" aria-label="Which model to show">
          <button
            type="button"
            className="rb-seg__btn"
            aria-pressed={figureGender === "male"}
            onClick={() => chooseGender("male")}
          >
            M
          </button>
          <button
            type="button"
            className="rb-seg__btn"
            aria-pressed={figureGender === "female"}
            onClick={() => chooseGender("female")}
          >
            F
          </button>
        </div>
      </div>

      {anatomy.unmapped.length > 0 && (
        <p className="rb-note rb-note--muted" style={{ textAlign: "center" }}>
          {anatomy.unmapped.length} machine{anatomy.unmapped.length > 1 ? "s" : ""} not mapped to
          the model yet — the figure does not show {anatomy.unmapped.length > 1 ? "them" : "it"}.
        </p>
      )}
    </div>
  );
}
