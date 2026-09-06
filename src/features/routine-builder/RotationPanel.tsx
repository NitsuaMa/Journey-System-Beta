/**
 * The B routine's reason for existing.
 *
 * Round: Unified Routine Builder, Sep 2026.
 *
 * The Academy is unambiguous about what a B routine is FOR, and it is not
 * variety:
 *
 *   "if we target the pecs directly in an A routine but then neglect them in
 *    the B routine, the net effect will be that we are only truly targeting
 *    those fibres once per week"
 *
 * So the B routine is not a second routine, it is the other half of a weekly
 * dose. Different exercises are fine — the same muscle REGIONS are not
 * optional. That single idea is what this panel measures: what does the other
 * routine train that this one does not reach, and therefore which fibres are
 * getting half the stimulus they need.
 *
 * The overlap bar is deliberately not a grade. Perfect overlap is not the
 * goal — the Academy's own model A/B pair leaves the obliques once-weekly, and
 * says an eighth or ninth exercise may be added with key exercises repeated
 * across A and B. What the trainer needs is the list of what is uncovered, so
 * the decision to leave it uncovered is a decision rather than an oversight.
 */

import { ArrowLeftRight, Sparkles } from "lucide-react";
import { cn } from "../../lib/utils";
import {
  B_ROUTINE_BUILD_OUT,
  CATEGORY_LABEL,
  MODEL_AB_ROUTINE,
  SELECTION_TEMPLATES,
  TWICE_WEEKLY_RULE,
  preferenceFromGender,
} from "./academy";
import { muscleLabel, type RotationAnalysis } from "./engine";
import type { SelectionTemplate } from "./academy";

export interface RotationPanelProps {
  rotation: RotationAnalysis;
  slot: "A" | "B" | null;
  counterpartLabel: string;
  machineName: (id: string) => string;
  /** Machine ids on this studio's floor, for filtering a seeded routine. */
  available: string[];
  gender?: string | null;
  /** Templates matched from intake, or chosen by the trainer. */
  templates: SelectionTemplate[];
  activeTemplateIds: string[];
  onToggleTemplate?: (id: string) => void;
  /** Replaces the whole sequence. Only offered when the routine is empty or
   *  the trainer explicitly asks — seeding over real work is destructive. */
  onSeed?: (machineIds: string[]) => void;
  canSeed: boolean;
}

export function RotationPanel({
  rotation,
  slot,
  counterpartLabel,
  machineName,
  available,
  gender,
  templates,
  activeTemplateIds,
  onToggleTemplate,
  onSeed,
  canSeed,
}: RotationPanelProps) {
  const pct = Math.round(rotation.overlap * 100);
  const good = rotation.underDosed.length === 0;
  const onFloor = new Set(available);

  const seedFrom = (ids: string[]) => onSeed?.(ids.filter((id) => onFloor.has(id)));

  const preference = preferenceFromGender(gender);
  const model = MODEL_AB_ROUTINE[preference];
  const modelIds = slot === "B" ? model.b : model.a;

  return (
    <div className="rb-rot">
      <div className="rb-rot__head">
        <span className="rb-sect__label" style={{ margin: 0 }}>
          <ArrowLeftRight size={12} aria-hidden />
          Against {counterpartLabel}
        </span>
        <span className={cn("rb-rot__score", good ? "rb-rot__score--ok" : "rb-rot__score--gap")}>
          {pct}% overlap
        </span>
      </div>

      <div
        className={cn("rb-rot__bar", !good && "rb-rot__bar--gap")}
        role="img"
        aria-label={`${pct}% of the regions ${counterpartLabel} trains are also trained here`}
      >
        <i style={{ width: `${pct}%` }} />
      </div>

      {rotation.underDosed.length > 0 ? (
        <>
          <p className="rb-note" style={{ marginTop: "0.4rem" }}>
            Trained in {counterpartLabel} but not here, so{" "}
            {rotation.underDosed.length === 1 ? "it gets" : "they get"} a once-weekly stimulus:
          </p>
          <div className="rb-rot__gaps">
            {rotation.underDosed.map((gap) => (
              <span
                key={gap.muscle}
                className="rb-rot__gap"
                title={`${counterpartLabel}: ${gap.machineIds.map(machineName).join(", ")}`}
              >
                {muscleLabel(gap.muscle)}
              </span>
            ))}
          </div>
        </>
      ) : (
        <p className="rb-note" style={{ marginTop: "0.4rem" }}>
          Every region {counterpartLabel} trains is reached here too. {TWICE_WEEKLY_RULE.statement}
        </p>
      )}

      {rotation.missingAcrossRotation.length > 0 && (
        <p className="rb-note rb-note--muted" style={{ marginTop: "0.4rem" }}>
          Absent from both routines:{" "}
          {rotation.missingAcrossRotation.map((c) => CATEGORY_LABEL[c]).join(", ")}. Every category
          should appear at least once across the rotation.
        </p>
      )}

      {!rotation.lumbarLegPressSplit && (
        <p className="rb-note rb-note--muted" style={{ marginTop: "0.4rem" }}>
          Lumbar and Leg Press sit in the same routine. The Academy eventually splits these across
          workouts — interference in the lower back from the Lumbar is felt during the Leg Press.
        </p>
      )}

      {onSeed && canSeed && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem", marginTop: "0.5rem" }}>
          <button type="button" className="rb-fix" onClick={() => seedFrom(modelIds)}>
            <Sparkles size={11} aria-hidden />
            Start from the model {slot ?? "A"} routine
          </button>
          {templates.slice(0, 3).map((t) => (
            <button
              key={t.id}
              type="button"
              className="rb-fix"
              onClick={() => seedFrom(slot === "B" ? t.eventualB : t.eventualA)}
            >
              <Sparkles size={11} aria-hidden />
              {t.label}
            </button>
          ))}
        </div>
      )}

      {onToggleTemplate && (
        <div style={{ marginTop: "0.55rem" }}>
          <div className="rb-sect__label">Purpose</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
            {SELECTION_TEMPLATES.filter((t) => t.kind !== "clear").map((t) => {
              const on = activeTemplateIds.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  className="rb-fix"
                  aria-pressed={on}
                  onClick={() => onToggleTemplate(t.id)}
                  style={
                    on
                      ? {
                          background: "var(--rb-live-fill)",
                          borderColor: "var(--rb-live)",
                          color: "var(--rb-live-text)",
                        }
                      : undefined
                  }
                >
                  {t.label}
                </button>
              );
            })}
          </div>
          {templates.some((t) => t.notes?.length) && (
            <ul style={{ margin: "0.4rem 0 0", paddingLeft: "1rem" }}>
              {templates
                .flatMap((t) => t.notes ?? [])
                .slice(0, 4)
                .map((n) => (
                  <li key={n} className="rb-note" style={{ marginBottom: "0.15rem" }}>
                    {n}
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}

      {slot === "B" && (
        <p className="rb-note rb-note--muted" style={{ marginTop: "0.5rem" }}>
          {B_ROUTINE_BUILD_OUT.cadence} Expect {B_ROUTINE_BUILD_OUT.weeks} weeks (
          {B_ROUTINE_BUILD_OUT.sessions} sessions) to build out in full.
        </p>
      )}
    </div>
  );
}
