import { memo } from "react";
import type { RepQuality } from "./types";

interface QualityMarkProps {
  quality: RepQuality;
  /** Rendered height in px. The glyph is drawn on a 16 x 16 grid. */
  size?: number;
  className?: string;
}

/**
 * The quality mark.
 *
 * Two glyphs, and which glyph carries which meaning is the whole point:
 *
 *   quality 3, max strength    a GOLD STAR. Filled, five points, the shape
 *                              every human being on earth already reads as
 *                              "this one was excellent" with no legend and
 *                              no training. It is the only star in the app,
 *                              so it can never mean anything else.
 *   quality 1, needs work      a RED KAIZEN — one unbroken brush stroke
 *                              left open at the top right. Kaizen is not
 *                              "you did badly"; it is the circle you keep
 *                              drawing and never finish. The opening is the
 *                              message: there is another rep tomorrow, and
 *                              a better one. A cross would have said the
 *                              set was a failure, and no trainer wants to
 *                              hand a client a screen full of crosses.
 *   quality 2, completed       no mark. A normal set is the baseline, and
 *                              the baseline should read calm.
 *
 * A star against a ring is a shape difference, not a colour one, so the two
 * rated states survive greyscale, print, and — the case that actually
 * matters here — a red-green colour-blind trainer, for whom the new green
 * and red cell fills are the same colour.
 */
function QualityMarkImpl({ quality, size = 13, className }: QualityMarkProps) {
  if (quality === 2) return null;

  if (quality === 3) {
    return (
      <svg
        className={className}
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        {/* Solid, not outlined. At 11px in a cell corner an outlined star is
            four grey hairlines; a filled one is still a star. */}
        <path
          d="M8 1 L9.76 5.57 L14.66 5.84 L10.85 8.93 L12.11 13.66 L8 11 L3.89 13.66 L5.15 8.93 L1.34 5.84 L6.24 5.57 Z"
          fill="currentColor"
        />
      </svg>
    );
  }

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {/* One stroke, opening at the top right. The brush enters heavy and
          leaves light, which is why the two ends differ in width — a round
          cap on the tail and a butt cap where it lifts off. */}
      <path
        d="M11.2 3.05A6 6 0 1 0 13.4 9.6"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
      />
    </svg>
  );
}

export const QualityMark = memo(QualityMarkImpl);

/** Full-name label for the mark, used by the legend and by aria text. */
export const QUALITY_MARK_LABEL: Record<RepQuality, { name: string; gloss: string }> = {
  1: { name: "Needs improvement", gloss: "room to improve" },
  2: { name: "Completed", gloss: "set on record" },
  3: { name: "Max strength", gloss: "full inroad" },
};
