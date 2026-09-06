import { MapPin } from "lucide-react";
import type { Studio, Trainer } from "../../types";
import { studioNameFor } from "./adapters";

/**
 * Where this trainer can work.
 *
 * Renamed out of the military register: "Network Access / Verified
 * Multi-Location Footprint / Station Access (Permanent) / Guest Credentials
 * (Temporary) / No Active Guest Ops" becomes home studio, also works at, and
 * cross-train access — the last of which is the term the approval flow
 * already uses everywhere else in the app.
 */
export function StudioAccessPanel({
  trainer,
  studios,
}: {
  trainer: Trainer;
  studios: Studio[];
}) {
  const home = studioNameFor(studios, trainer.primaryHomeStudioId);

  const alsoWorksAt = (trainer.accessibleStudioIds ?? [])
    .filter((id) => id && id !== trainer.primaryHomeStudioId)
    .map((id) => ({ id, name: studioNameFor(studios, id) || id }));

  const crossTrain = (trainer.activeGuestStudioIds ?? [])
    .filter(Boolean)
    .map((id) => ({ id, name: studioNameFor(studios, id) || id }));

  return (
    <section className="tp-card">
      <div className="tp-card__head">
        <h2 className="tp-card__title">Studio access</h2>
      </div>
      <div className="tp-card__body">
        <div className="tp-home">
          <MapPin size={16} aria-hidden />
          <div>
            <span className="tp-label" style={{ marginBottom: 2 }}>
              Home studio
            </span>
            <span className="tp-home__name">{home || "Not set"}</span>
          </div>
        </div>

        <div className="tp-access">
          <span className="tp-label">Also works at</span>
          {alsoWorksAt.length > 0 ? (
            <div className="tp-tags">
              {alsoWorksAt.map((s) => (
                <span key={s.id} className="tp-chip">
                  {s.name}
                </span>
              ))}
            </div>
          ) : (
            <p className="tp-empty">Home studio only.</p>
          )}
        </div>

        <div className="tp-access">
          <span className="tp-label">Cross-train access</span>
          {crossTrain.length > 0 ? (
            <div className="tp-tags">
              {crossTrain.map((s) => (
                <span key={s.id} className="tp-chip tp-chip--ok">
                  {s.name}
                </span>
              ))}
            </div>
          ) : (
            <p className="tp-empty">None active.</p>
          )}
        </div>
      </div>
    </section>
  );
}
