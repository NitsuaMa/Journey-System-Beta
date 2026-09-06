import type { ReactNode } from "react";
import { QualityMark, QUALITY_MARK_LABEL } from "./QualityMark";

interface GridToolbarProps {
  /** Section caption, e.g. "Recent journey". */
  title?: string;
  /** Controls rendered at the right end of the rail. */
  children?: ReactNode;
}

/**
 * The slim row between the client header and the grid: a section caption on
 * the left, controls on the right. The density switch used to live here; the
 * grid now ships one tuned density, so there is nothing to choose.
 */
export function GridToolbar({ title, children }: GridToolbarProps) {
  return (
    <div className="jg-toolbar">
      {title && (
        <span className="jg-toolbar__title">
          <span className="jg-toolbar__bar" aria-hidden="true" />
          {title}
        </span>
      )}
      <span className="jg-toolbar__spacer" />
      {children}
    </div>
  );
}

/**
 * The key, read top to bottom as a scale: best, needs work, ordinary.
 *
 * Colour is never the only cue. The green cell also carries a gold star,
 * the red cell also carries a kaizen ring AND a diagonal hatch, and the
 * grey cell carries nothing at all. Any one of the three cues is enough on
 * its own, which is what keeps the grid readable in greyscale, in print,
 * and for a red-green colour-blind trainer.
 */
export function QualityLegend({ compact = false }: { compact?: boolean } = {}) {
  return (
    <div className={`jg-legend ${compact ? "jg-legend--compact" : ""}`} aria-label="Rep quality key">
      <span className="jg-legend__item">
        <span className="jg-legend__swatch jg-legend__swatch--q3" aria-hidden="true" />
        <span className="jg-legend__mark jg-legend__mark--q3" aria-hidden="true">
          <QualityMark quality={3} size={12} />
        </span>
        {QUALITY_MARK_LABEL[3].name}
        <i className="jg-legend__gloss">{QUALITY_MARK_LABEL[3].gloss}</i>
      </span>
      <span className="jg-legend__item">
        <span className="jg-legend__swatch jg-legend__swatch--q1" aria-hidden="true" />
        <span className="jg-legend__mark jg-legend__mark--q1" aria-hidden="true">
          <QualityMark quality={1} size={12} />
        </span>
        {QUALITY_MARK_LABEL[1].name}
        <i className="jg-legend__gloss">{QUALITY_MARK_LABEL[1].gloss}</i>
      </span>
      <span className="jg-legend__item">
        <span className="jg-legend__swatch jg-legend__swatch--q2" aria-hidden="true" />
        {QUALITY_MARK_LABEL[2].name}
      </span>
      <span className="jg-legend__item">
        <span className="jg-legend__swatch jg-legend__swatch--latest" aria-hidden="true" />
        Latest session
      </span>
      <span className="jg-legend__item jg-legend__item--quiet">
        <span className="jg-delta jg-delta--gain">
          <span className="jg-delta__arrow">&#9650;</span>2
        </span>{" "}
        load vs last &middot; &#8593;&#8595; reps vs last
      </span>
    </div>
  );
}
