import { useState } from "react";
import type { Trainer } from "../../types";

/**
 * A trainer's avatar at profile size.
 *
 * Same contract as the calendar's small one: INITIALS ARE THE PRIMARY
 * RENDERER. Most Max Strength staff have no Mindbody photo, so the initials
 * are always drawn and an image is layered over them only when one exists and
 * loads. There is no broken-image state and no empty circle to explain.
 */
export function TrainerAvatarImage({
  trainer,
  size = 64,
}: {
  trainer: Trainer;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const photo = !failed ? trainer.photoUrl || trainer.mindbody?.imageUrl || null : null;
  const accent = trainer.brandColor;

  return (
    <span
      className="tp-avatar"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.34),
        borderColor: accent ? `${accent}66` : undefined,
        color: accent || undefined,
      }}
      aria-hidden="true"
    >
      {trainer.initials || "?"}
      {photo && (
        <img
          className="tp-avatar__img"
          src={photo}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}
