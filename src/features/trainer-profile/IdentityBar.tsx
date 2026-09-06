import { CalendarDays, Pencil } from "lucide-react";
import { ROLE_LABELS, type Studio, type Trainer } from "../../types";
import { BrandTiles } from "../client-profile/BrandTiles";
import { TrainerAvatarImage } from "./TrainerAvatarImage";
import { studioNameFor } from "./adapters";
import type { ProfileVisibility } from "./visibility";

/**
 * Row one: who this is, at a glance.
 *
 * The old header called itself "Tactical Command Center" and led with that in
 * orange above the name. Nothing else in the app talks that way, and an
 * eyebrow that says nothing about the person is a line of noise above the one
 * line that matters — so the name leads, and the eyebrow is gone.
 *
 * Role now renders through ROLE_LABELS, which is where the company's own
 * vocabulary already lives ("Life Transformer", "Studio Leader"). The old
 * view hardcoded "Owner" and "Admin" badges from a role check and so showed
 * the wrong word for six of the ten roles.
 */
export function IdentityBar({
  trainer,
  studios,
  visibility,
  onEdit,
  onOpenCalendar,
}: {
  trainer: Trainer;
  studios: Studio[];
  visibility: ProfileVisibility;
  onEdit: () => void;
  onOpenCalendar: () => void;
}) {
  const homeStudio = studioNameFor(studios, trainer.primaryHomeStudioId);
  const mindbodyLinked = !!trainer.mindbodyStaffId || !!trainer.mindbodyLinked;
  const inactiveInMindbody = trainer.mindbody?.isActive === false;

  return (
    <header className="tp-identity">
      <TrainerAvatarImage trainer={trainer} size={64} />

      <div className="tp-identity__names">
        <h1 className="tp-identity__name">
          {trainer.fullName}
          {trainer.nickname && <span className="tp-identity__nick">"{trainer.nickname}"</span>}
        </h1>

        <div className="tp-identity__meta">
          <BrandTiles size={7} gap={2} />
          <span className="tp-chip tp-chip--role">{ROLE_LABELS[trainer.role] || trainer.role}</span>
          {homeStudio && <span className="tp-chip">{homeStudio}</span>}
          {trainer.initials && <span className="tp-chip">{trainer.initials}</span>}

          {/* Sync state is operator detail: it tells you why a name or photo
              looks the way it does, and a peer viewing the profile does not
              need it. */}
          {visibility.showIntegration && mindbodyLinked && !inactiveInMindbody && (
            <span className="tp-chip tp-chip--live">Mindbody synced</span>
          )}
          {visibility.showIntegration && inactiveInMindbody && (
            <span className="tp-chip tp-chip--warn">Inactive in Mindbody</span>
          )}
        </div>
      </div>

      <div className="tp-identity__actions">
        {visibility.canEdit && (
          <button type="button" className="tp-btn tp-btn--primary" onClick={onEdit}>
            <Pencil size={15} aria-hidden />
            Edit profile
          </button>
        )}
        <button type="button" className="tp-btn" onClick={onOpenCalendar}>
          <CalendarDays size={15} aria-hidden />
          Studio calendar
        </button>
      </div>
    </header>
  );
}
