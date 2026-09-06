/**
 * The Kaizen Roster mark.
 *
 * Two overlapping chevrons climbing to the right — continuous improvement,
 * one step above the last. Drawn rather than imported so it can never be
 * confused with the session grid's kaizen mark, which is a DIFFERENT thing:
 * that one is red and means "this rep needs work".
 *
 * Colour is fixed to the roster tokens (action blue / brand slate) and there
 * is deliberately no way to pass a red one in. If a glance at a client card
 * cannot separate "I am tracking you" from "you are doing it wrong", the
 * whole roster is worse than useless.
 */
export function KaizenMark({
  size = 16,
  quiet = false,
  title,
}: {
  size?: number;
  /** Slate rather than blue — for the small glyph on a client row. */
  quiet?: boolean;
  title?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke={quiet ? "var(--tp-kaizen-quiet)" : "var(--tp-kaizen)"}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <polyline points="2,10 6,6 10,10" opacity={0.55} />
      <polyline points="6,13 10,9 14,13" />
    </svg>
  );
}
