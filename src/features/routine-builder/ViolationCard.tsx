/**
 * A broken rule, its reason, and the button that fixes it.
 *
 * Round: Unified Routine Builder, Sep 2026.
 *
 * The card always carries three things: what is wrong, WHY it is wrong in the
 * Academy's own terms, and where that comes from. The "why" is not decoration
 * — a trainer who is told "avoid Lumbar into Leg Press" learns a rule, and a
 * trainer who is told the fatigue carries over and feels wrong learns the
 * principle and can apply it to a pair nobody wrote down.
 *
 * Nothing here blocks a save. The studio's own rule is that templates are
 * advisory and deviations are flagged rather than blocked, and a rule that
 * stops a trainer mid-session from making a call they can justify is a rule
 * that gets worked around rather than followed.
 */

import { useState } from "react";
import { AlertTriangle, Info, Wand2 } from "lucide-react";
import { cn } from "../../lib/utils";
import type { Violation } from "./engine";

export interface ViolationCardProps {
  violation: Violation;
  machineName: (id: string) => string;
  onApplyFix: (apply: (ids: string[]) => string[]) => void;
  disabled?: boolean;
}

export function ViolationCard({
  violation: v,
  machineName,
  onApplyFix,
  disabled,
}: ViolationCardProps) {
  const [showSource, setShowSource] = useState(false);
  const Icon = v.severity === "avoid" ? AlertTriangle : Info;

  return (
    <div className={cn("rb-warn", v.severity === "avoid" ? "rb-warn--avoid" : "rb-warn--caution")}>
      <Icon size={14} className="rb-warn__icon" aria-hidden />
      <div className="rb-warn__body">
        <div className="rb-warn__title">
          {v.title}
          {v.scope === "adjacent" && (
            <span style={{ fontWeight: 400, opacity: 0.8 }}>
              {" "}
              — {v.machineIds.map(machineName).join(" → ")}
            </span>
          )}
        </div>

        <div className="rb-warn__why">{v.why}</div>

        {v.escalate && <div className="rb-warn__escalate">{v.escalate}</div>}

        <div className="rb-warn__fixes">
          {!disabled &&
            v.fixes.map((fix) => (
              <button
                key={fix.label}
                type="button"
                className="rb-fix"
                onClick={() => onApplyFix(fix.apply)}
              >
                <Wand2 size={11} aria-hidden />
                {fix.label}
              </button>
            ))}
          <button
            type="button"
            className="rb-fix"
            onClick={() => setShowSource((s) => !s)}
            aria-expanded={showSource}
          >
            {showSource ? "Hide source" : "Source"}
          </button>
        </div>

        {showSource && <div className="rb-warn__src">{v.source}</div>}
      </div>
    </div>
  );
}
