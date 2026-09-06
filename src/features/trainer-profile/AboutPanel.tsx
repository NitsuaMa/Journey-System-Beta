import type { Trainer } from "../../types";
import type { ProfileVisibility } from "./visibility";
import { monthYear } from "./adapters";

/**
 * About: the bio, the certifications, the tenure.
 *
 * All three fields already existed on `Trainer` and NOTHING in the app ever
 * wrote them, so every trainer in the system fell to the same placeholders —
 * "No tactical biography provided", "Level 1 Practitioner", "Baseline
 * Personnel". Two of those read as data rather than as absence, which is
 * worse than an empty state: "Level 1 Practitioner" looked like a
 * qualification somebody had recorded.
 *
 * The editor lands in the same round. Until a trainer fills these in, the
 * empty states say plainly that nothing is recorded, and say where to fix it
 * only to the people who can.
 */
export function AboutPanel({
  trainer,
  visibility,
}: {
  trainer: Trainer;
  visibility: ProfileVisibility;
}) {
  const started = monthYear(trainer.employmentStartDate);
  const certifications = trainer.certifications?.filter((c) => c && c.trim()) ?? [];
  const bio = trainer.bio?.trim();

  return (
    <section className="tp-card">
      <div className="tp-card__head">
        <h2 className="tp-card__title">About</h2>
      </div>
      <div className="tp-card__body">
        {bio ? (
          <p className="tp-bio">{bio}</p>
        ) : (
          <p className="tp-bio tp-empty">
            No bio yet.
            {visibility.canEdit && " Add one in Edit profile."}
          </p>
        )}

        <span className="tp-label">Certifications</span>
        {certifications.length > 0 ? (
          <div className="tp-tags">
            {certifications.map((cert) => (
              <span key={cert} className="tp-chip">
                {cert}
              </span>
            ))}
          </div>
        ) : (
          <p className="tp-empty">
            None recorded.
            {visibility.canEdit && " Add them in Edit profile."}
          </p>
        )}

        <div className="tp-facts">
          <div className="tp-fact">
            <span className="tp-fact__k">Started</span>
            <span className={started ? "tp-fact__v" : "tp-fact__v tp-empty"}>{started || "—"}</span>
          </div>
          {visibility.showContact && trainer.email && (
            <div className="tp-fact">
              <span className="tp-fact__k">Email</span>
              <a className="tp-fact__v" href={`mailto:${trainer.email}`}>
                {trainer.email}
              </a>
            </div>
          )}
          {visibility.showIntegration && trainer.mindbodyStaffId && (
            <div className="tp-fact">
              <span className="tp-fact__k">Mindbody staff ID</span>
              <span className="tp-fact__v">{String(trainer.mindbodyStaffId)}</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
