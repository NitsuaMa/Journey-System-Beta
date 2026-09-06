import { memo } from "react";
import type { JourneySet, JourneySession } from "./types";
import { formatSeconds, formatLongDate, QUALITY_LABEL, loadDelta, trendVsPrevious, type Trend } from "./stats";
import { QualityMark } from "./QualityMark";

interface JourneyCellProps {
  session: JourneySession;
  machineName: string;
  set?: JourneySet;
  /** The previous logged set on this machine — drives the tiny trend glyph. */
  previous?: JourneySet;
  /** This column is the most recent logged session (the baseline). */
  isLatest: boolean;
  /** This column was tapped in the header. */
  isSpot: boolean;
  /** The Analytics column's current metric came from this set. */
  isStatHit: boolean;
}

/**
 * Reps only. A load change never reaches this map — it is drawn as a signed
 * number instead, because "+2 lb" and "one more rep" are not the same size
 * of news and an identical arrow said they were.
 */
const TREND_GLYPH: Record<NonNullable<Trend>, string> = {
  up: "▲",
  down: "▼",
  "reps-up": "↑",
  "reps-down": "↓",
  flat: "·",
};

/**
 * One historical cell. Quality is carried by the cell's FILL -- green for a
 * full inroad, red for a set that needs work, grey for an ordinary one --
 * and by nothing else, which is the point: a load increase used to tint the
 * same cell green, so two unrelated facts were fighting over one channel.
 * Load movement is now text-only (a blue signed number) and quality owns
 * the background alone.
 *
 * The corner mark is the backup channel, not the primary one. It is drawn
 * only for the two rated states, so a normal week of training carries no
 * glyphs at all -- and it exists because green-vs-red is precisely the pair
 * a red-green colour-blind trainer cannot separate.
 *
 * Pure and memoised: it re-renders only when its own set or flags change. With ~20 rows × ~15 columns that is the difference
 * between 300 renders and 1 when the trainer taps something.
 */
function JourneyCellImpl({ session, machineName, set, previous, isLatest, isSpot, isStatHit }: JourneyCellProps) {
  const delta = set ? loadDelta(set, previous) : null;
  const cls = [
    "jg-cell",
    set ? `jg-cell--q${set.quality}` : "",
    delta !== null && delta > 0 ? "is-gain" : "",
    delta !== null && delta < 0 ? "is-drop" : "",
    isLatest ? "is-latest" : "",
    isSpot ? "is-spot" : "",
    isStatHit ? "is-stat-hit" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const when = `${formatLongDate(session.date)}${isLatest ? " (most recent session)" : ""}`;

  if (!set) {
    return (
      <div className={cls} role="gridcell" aria-label={`${machineName}, ${when}: not performed`}>
        <span className="jg-cell__empty" aria-hidden="true">
          —
        </span>
      </div>
    );
  }

  const trend = trendVsPrevious(set, previous);
  const effort = set.isTSC ? `${formatSeconds(set.seconds ?? 0)} under tension` : `${set.reps ?? 0} reps`;
  const load =
    delta === null
      ? ""
      : delta > 0
        ? `, up ${delta} lb`
        : `, down ${Math.abs(delta)} lb`;

  return (
    <div
      className={cls}
      role="gridcell"
      aria-label={`${machineName}, ${when}: ${set.weight} lb${load}, ${effort}, ${QUALITY_LABEL[set.quality]}`}
    >
      <span className="jg-cell__w">
        {set.weight}
        {/* The load moving is the headline. It gets a signed number of its
            own rather than an arrow shared with the rep count. */}
        {delta !== null && (
          <span className={delta > 0 ? "jg-delta jg-delta--gain" : "jg-delta jg-delta--drop"} aria-hidden="true">
            {/* The arrow is not decoration. Blue means "tappable" everywhere
                else in this grid, so a bare blue "2" would read as a button;
                a number wearing an arrow reads as a measurement. */}
            <span className="jg-delta__arrow">{delta > 0 ? "\u25b2" : "\u25bc"}</span>
            {Math.abs(delta)}
          </span>
        )}
      </span>
      <span className="jg-cell__r" aria-hidden="true">
        {set.isTSC ? <span className="jg-tut">⏱ {formatSeconds(set.seconds ?? 0)}</span> : <>{set.reps}</>}
        {/* Reps only, and only when the load held — otherwise the delta above
            already said everything that matters about this set. */}
        {delta === null && trend && trend !== "flat" && (
          <span className={`jg-trend jg-trend--${trend}`}>{TREND_GLYPH[trend]}</span>
        )}
      </span>
      {/* Gold star = max strength, red kaizen = room to improve. Absolutely
          positioned, so it never shifts the two numbers, and hidden outright
          on dense rows where there is no corner to give it. */}
      {set.quality !== 2 && (
        <span className={`jg-cell__mark jg-cell__mark--q${set.quality}`} aria-hidden="true">
          <QualityMark quality={set.quality} size={10} />
        </span>
      )}
    </div>
  );
}

export const JourneyCell = memo(JourneyCellImpl);
