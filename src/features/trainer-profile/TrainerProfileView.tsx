import { useMemo, useState } from "react";
import { Eye } from "lucide-react";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { db } from "../../firebase";
import { OperationType, handleFirestoreError } from "../../lib/firestore-errors";
import type {
  Client,
  ScheduleEntry,
  Studio,
  Trainer,
  WorkoutSession,
} from "../../types";
import { EditTrainerModal } from "../../components/EditTrainerModal";
import { IdentityBar } from "./IdentityBar";
import { AboutPanel } from "./AboutPanel";
import { StudioAccessPanel } from "./StudioAccessPanel";
import { TodaySchedule } from "./TodaySchedule";
import { RecentlyCoached } from "./RecentlyCoached";
import { recentlyCoachedFor, upcomingFor } from "./adapters";
import { resolveProfileVisibility, scopeNotice } from "./visibility";
import "./trainer-profile.css";

/**
 * TRAINER PROFILE.
 *
 * Replaces src/components/TrainerProfileView.tsx, which was written in a
 * military register nothing else in the app shares ("Tactical Command
 * Center", "Combat Grade Certifications", "Total Ops Vol", "Guest Credentials
 * (Temporary)") and rendered on a hardcoded navy background that ignored both
 * themes.
 *
 * Two structural changes beyond the surface:
 *
 *  1. It is a FEATURE, not a page. Identity, about, access, schedule and
 *     coached list are separate components over a tested adapter layer,
 *     matching how equipment/ and journey-grid/ are built.
 *  2. Anyone can open it. `visibility` decides what they see, and the rule is
 *     that client names need a studio in common — see visibility.ts.
 */
export interface TrainerProfileViewProps {
  trainer: Trainer;
  authTrainer: Trainer | null;
  schedules: ScheduleEntry[];
  sessions: WorkoutSession[];
  clients: Client[];
  studios: Studio[];
  onSelectClient: (clientId: string) => void;
  setView: (view: any) => void;
}

export function TrainerProfileView({
  trainer,
  authTrainer,
  schedules,
  sessions,
  clients,
  studios,
  onSelectClient,
  setView,
}: TrainerProfileViewProps) {
  const [isEditOpen, setIsEditOpen] = useState(false);

  const visibility = useMemo(
    () => resolveProfileVisibility(authTrainer, trainer),
    [authTrainer, trainer],
  );

  const firstName = (trainer.fullName || "This trainer").split(" ")[0];
  const notice = scopeNotice(visibility.scope, firstName);

  const upcoming = useMemo(
    () => (visibility.showSchedule ? upcomingFor(schedules, trainer, clients) : []),
    [schedules, trainer, clients, visibility.showSchedule],
  );

  const coached = useMemo(
    () => (visibility.showRecentlyCoached ? recentlyCoachedFor(sessions, trainer, clients) : []),
    [sessions, trainer, clients, visibility.showRecentlyCoached],
  );

  const openClient = (clientId: string) => {
    onSelectClient(clientId);
    setView("profile");
  };

  const handleSaveProfile = async (updates: Partial<Trainer>) => {
    if (!trainer.id) return;
    try {
      const ref = doc(db, "trainers", trainer.id);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        await updateDoc(ref, updates);
      } else {
        // The old fallback spread the WHOLE trainer object back in, which now
        // means re-sending `rollups` and `mindbody` — both server-write-only
        // since this round, so the rules would reject the save. Strip them:
        // they are derived data and a client has no business restating them.
        const { rollups: _rollups, mindbody: _mindbody, ...seed } = trainer;
        await setDoc(ref, { ...seed, ...updates, createdAt: new Date() });
      }
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `trainers/${trainer.id}`);
      throw e;
    }
  };

  return (
    <div className="tp">
      {notice && (
        <div className="tp-notice">
          <Eye size={15} aria-hidden />
          {notice}
        </div>
      )}

      <IdentityBar
        trainer={trainer}
        studios={studios}
        visibility={visibility}
        onEdit={() => setIsEditOpen(true)}
        onOpenCalendar={() => setView("calendar")}
      />

      <div className="tp-band">
        <AboutPanel trainer={trainer} visibility={visibility} />
        <StudioAccessPanel trainer={trainer} studios={studios} />
      </div>

      {(visibility.showSchedule || visibility.showRecentlyCoached) && (
        <div className="tp-band tp-band--even">
          {visibility.showSchedule && (
            <TodaySchedule rows={upcoming} onSelectClient={openClient} />
          )}
          {visibility.showRecentlyCoached && (
            <RecentlyCoached
              rows={coached}
              windowLabel="Last 24 hours"
              onSelectClient={openClient}
            />
          )}
        </div>
      )}

      {visibility.canEdit && (
        <EditTrainerModal
          trainer={trainer}
          authTrainer={authTrainer}
          studios={studios}
          isOpen={isEditOpen}
          onOpenChange={setIsEditOpen}
          onSave={handleSaveProfile}
        />
      )}
    </div>
  );
}
