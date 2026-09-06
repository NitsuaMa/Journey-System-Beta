/**
 * The five Academy categories, in 40px.
 *
 * Round: Unified Routine Builder, Sep 2026.
 *
 * This is the portrait answer to the anatomy figure. On a 10" iPad held
 * upright there is no room for a body model beside eight machine rows without
 * breaking the eight-machines-without-scrolling rule, and the figure is the
 * thing that can be lost with least cost — because the question a trainer is
 * actually asking it ("is this routine complete?") has a smaller answer.
 *
 * The Academy's completeness test is categorical, not anatomical: one movement
 * from each of five categories, with the first three in every workout. Five
 * cells answer that exactly. The figure answers a richer question — which
 * fibres, how much overlap — and stays available a tap away.
 *
 * A missing FOUNDATIONAL category is plum, not grey: "no upper-body push in
 * this workout" is a fault, while "no hip work" is a choice.
 */

import { cn } from "../../lib/utils";
import { CATEGORY_LABEL, CATEGORY_SHORT } from "./academy";
import type { CategoryCoverage } from "./engine";

export interface CoverageStripProps {
  coverage: CategoryCoverage[];
  /** Portrait: the whole strip opens the figure. Omit for a static strip. */
  onExpand?: () => void;
}

export function CoverageStrip({ coverage, onExpand }: CoverageStripProps) {
  const missingFoundational = coverage.filter((c) => c.foundational && !c.covered).length;

  const summary =
    missingFoundational > 0
      ? `${missingFoundational} foundational categor${missingFoundational > 1 ? "ies" : "y"} missing`
      : `${coverage.filter((c) => c.covered).length} of 5 categories covered`;

  const Cell = onExpand ? "button" : "div";

  return (
    <div className="rb-cov" role="group" aria-label={`Category coverage — ${summary}`}>
      {coverage.map((c) => {
        const missingFoundation = c.foundational && !c.covered;
        return (
          <Cell
            key={c.category}
            {...(onExpand ? { type: "button" as const, onClick: onExpand } : {})}
            className={cn(
              "rb-cov__cell",
              c.covered && "rb-cov__cell--covered",
              missingFoundation && "rb-cov__cell--missing-foundational",
            )}
            title={
              c.covered
                ? `${CATEGORY_LABEL[c.category]}: ${c.machineIds.length} machine${c.machineIds.length > 1 ? "s" : ""}`
                : missingFoundation
                  ? `${CATEGORY_LABEL[c.category]}: missing — one belongs in every workout`
                  : `${CATEGORY_LABEL[c.category]}: not in this routine`
            }
          >
            <span className="rb-cov__label">{CATEGORY_SHORT[c.category]}</span>
            <span className="rb-cov__n">
              {c.covered ? c.machineIds.length : missingFoundation ? "!" : "–"}
            </span>
          </Cell>
        );
      })}
    </div>
  );
}
