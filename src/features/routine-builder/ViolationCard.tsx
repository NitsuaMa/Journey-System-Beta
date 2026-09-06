/**
 * A broken rule, its reason, and the button that fixes it.
 *
 * Round: Unified Routine Builder, Sep 2026.
 *
 * Collapsed to one line by default, and that is a density decision, not a
 * cosmetic one. A seven-machine routine can raise four rules at once; at full
 * height that pushed the machine list off a portrait iPad entirely, which
 * breaks the rule the whole builder is arranged around — eight machines
 * visible without scrolling. Collapsed, four warnings cost about as much
 * vertical space as one row.
 *
 * What stays on the collapsed line is what a trainer acts on: which rule,
 * which two machines, and the fix. What expands is what a trainer LEARNS
 * from: the Academy's own reasoning and its citation. That split matters —
 * a trainer told "avoid Lumbar into Leg Press" learns one rule, and a trainer
 * told the fatigue carries over and feels wrong learns the principle and can
 * apply it to a pair nobody wrote down. They need it the first few times and
 * not the hundredth, so it is one tap away rather than always on screen.
 *
 * Nothing here blocks a save. The studio's rule is that templates are
 * advisory and deviations are flagged rather than blocked, and a rule that
 * stops a trainer mid-session from making a call they can justify is a rule
 * that gets worked around rather than followed.
 */

import { useState } from "react";
import { AlertTriangle, ChevronDown, Info, Wand2 } from "lucide-react";
import { cn } from "../../lib/utils";
import type { Violation } from "./engine";

export interface ViolationCardProps {
  violation: Violation;
  machineName: (id: string) => string;
  onApplyFix: (apply: (ids: string[]) => string[]) => void;
  disabled?: boolean;
  /** The warnings sheet opens them expanded; inline they start collapsed. */
  defaultExpanded?: boolean;
}

export function ViolationCard({
  violation: v,
  machineName,
  onApplyFix,
  disabled,
  defaultExpanded = false,
}: ViolationCardProps) {
  const [open, setOpen] = useState(defaultExpanded);
  const Icon = v.severity === "avoid" ? AlertTriangle : Info;
  const [primaryFix, ...otherFixes] = v.fixes;

  return (
    <div className={cn("rb-warn", v.severity === "avoid" ? "rb-warn--avoid" : "rb-warn--caution")}>
      <div className="rb-warn__summary">
        <button
          type="button"
          className="rb-warn__toggle"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <Icon size={14} className="rb-warn__icon" aria-hidden />
          <span className="rb-warn__title">{v.title}</span>
          {v.scope === "adjacent" && (
            <span className="rb-warn__pair">{v.machineIds.map(machineName).join(" → ")}</span>
          )}
          <ChevronDown
            size={13}
            aria-hidden
            className={cn("rb-warn__chev", open && "rb-warn__chev--open")}
          />
        </button>

        {primaryFix && !disabled && (
          <button
            type="button"
            className="rb-fix rb-warn__quickfix"
            onClick={() => onApplyFix(primaryFix.apply)}
          >
            <Wand2 size={11} aria-hidden />
            {primaryFix.label}
          </button>
        )}
      </div>

      {open && (
        <div className="rb-warn__detail">
          <p className="rb-warn__why">{v.why}</p>
          {v.escalate && <p className="rb-warn__escalate">{v.escalate}</p>}
          {otherFixes.length > 0 && !disabled && (
            <div className="rb-warn__fixes">
              {otherFixes.map((fix) => (
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
            </div>
          )}
          <p className="rb-warn__src">{v.source}</p>
        </div>
      )}
    </div>
  );
}
