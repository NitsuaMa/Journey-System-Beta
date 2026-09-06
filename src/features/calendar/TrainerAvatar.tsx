import { memo, useState } from "react";
import { toneClass } from "./trainer-tone";
import type { TrainerRef } from "./types";

/**
 * A trainer's initials in their own colour, with their photo on top when
 * there is one.
 *
 * `tone` comes from a hash of the trainer id, so this is the same colour in
 * the month grid, the week leaderboard and the day lanes — which is what makes
 * the colour worth anything.
 *
 * INITIALS ARE THE PRIMARY RENDERER, not a fallback. Most Max Strength staff
 * have no Mindbody photo, so the coloured initials are always drawn and the
 * image is layered over them only if one exists and loads. A photo that 404s,
 * a CDN URL that has rotated, or a slow network therefore shows the normal
 * avatar rather than a broken-image icon or an empty circle.
 *
 * Both are memo-wrapped: they are leaves rendered ~40 times in a month grid and
 * nothing about them changes when the surrounding view re-renders. (Under this
 * project's React 19 setup a plain function component also cannot take a `key`
 * in a list; memo components can.)
 */

export interface TrainerAvatarProps {
  trainer: TrainerRef;
  size?: "sm" | "md";
}

export const TrainerAvatar = memo(function TrainerAvatar({
  trainer,
  size = "md",
}: TrainerAvatarProps) {
  const [failed, setFailed] = useState(false);
  const photo = !failed && trainer.photoUrl ? trainer.photoUrl : null;

  return (
    <span
      className={`cal-avatar ${size === "sm" ? "cal-avatar--sm" : ""} ${toneClass(trainer.tone)}`}
      title={trainer.name}
      aria-hidden
    >
      {trainer.initials}
      {photo && (
        <img
          className="cal-avatar__img"
          src={photo}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
});

export interface TrainerCountChipProps extends TrainerAvatarProps {
  count: number;
}

/** Avatar with a session-count badge. The month grid's whole vocabulary. */
export const TrainerCountChip = memo(function TrainerCountChip({
  trainer,
  count,
  size = "md",
}: TrainerCountChipProps) {
  return (
    <span
      className="cal-who"
      title={`${trainer.name} — ${count} session${count === 1 ? "" : "s"}`}
    >
      <TrainerAvatar trainer={trainer} size={size} />
      <span className="cal-who__badge">{count}</span>
      <span className="sr-only">
        {trainer.name}, {count} sessions
      </span>
    </span>
  );
});
