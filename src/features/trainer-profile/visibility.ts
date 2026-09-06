/**
 * WHO CAN SEE WHAT ON A TRAINER'S PROFILE.
 *
 * Trainers can now open each other's profiles, so this file answers the one
 * question that follows: which parts.
 *
 * THE LINE THAT MATTERS
 * ---------------------
 * Client names require a SHARED STUDIO.
 *
 * A trainer's certifications, tenure and session counts are professional
 * credentials -- fine for anyone in the company to see, and useful when a
 * franchise owner is looking at a studio they have never visited. But the
 * Kaizen Roster, today's schedule and recently-coached list are all lists of
 * CLIENTS, and a trainer at another location has no business reading them.
 *
 * Four tiers, each adding to the one before:
 *
 *   outside     someone with no studio in common: identity, about, tenure,
 *               the aggregate numbers, and where they work. No client names.
 *   peer        shares a studio: the client-facing sections as well. This is
 *               the tier the "let other trainers view a profile" ask created.
 *   leadership  can already edit this person: contact details and the
 *               Mindbody integration state on top.
 *   self        everything.
 *
 * Deliberately a pure function over two Trainer objects. Firestore rules are
 * what actually protect the data (trainer documents are readable by any
 * authenticated user, which is what makes a team-visible roster work at all);
 * this decides what is worth PUTTING ON SCREEN, and being pure is what lets
 * the interesting combinations be tested instead of clicked through.
 */
import type { Trainer, UserRole } from "../../types";

export type ProfileScope = "self" | "leadership" | "peer" | "outside";

export interface ProfileVisibility {
  scope: ProfileScope;
  /** Edit Profile button, and every inline editing affordance. */
  canEdit: boolean;
  /** Email address and any other way to contact this person directly. */
  showContact: boolean;
  /** Mindbody staff id, sync state, calendar feed url. Operator detail. */
  showIntegration: boolean;
  /** Aggregate session numbers. A credential, not client data. */
  showCoachingLoad: boolean;
  /** Everything below names clients, and needs a studio in common. */
  showRoster: boolean;
  showSchedule: boolean;
  showRecentlyCoached: boolean;
}

/** Roles whose authority is company- or franchise-wide, not per studio. */
const GLOBAL_LEADERSHIP: UserRole[] = [
  "Admin",
  "Founder",
  "Overseer",
  "Owner",
  "FranchiseOwner",
  "StudioOwner",
];

/**
 * Roles that lead ONE studio. Leadership over a trainer only where they
 * actually share that studio -- the same distinction `isStudioOwnerOrHeadTrainer`
 * draws in firestore.rules, kept in step here so the UI never offers an
 * affordance the rules will refuse.
 */
const STUDIO_LEADERSHIP: UserRole[] = ["StudioLeader", "HeadTrainer"];

/** Every studio a trainer is attached to, in any capacity. */
export function studioIdsFor(trainer: Trainer | null | undefined): Set<string> {
  const ids = new Set<string>();
  if (!trainer) return ids;
  const add = (value?: string | null) => {
    if (typeof value === "string" && value.trim()) ids.add(value.trim());
  };
  add(trainer.primaryHomeStudioId);
  trainer.accessibleStudioIds?.forEach(add);
  trainer.activeGuestStudioIds?.forEach(add);
  trainer.ownedStudioIds?.forEach(add);
  return ids;
}

export function sharesStudio(a: Trainer | null | undefined, b: Trainer | null | undefined): boolean {
  const mine = studioIdsFor(a);
  if (mine.size === 0) return false;
  for (const id of studioIdsFor(b)) {
    if (mine.has(id)) return true;
  }
  return false;
}

export function resolveProfileScope(
  viewer: Trainer | null | undefined,
  subject: Trainer | null | undefined,
): ProfileScope {
  if (!viewer || !subject) return "outside";
  if (viewer.id && viewer.id === subject.id) return "self";
  if (GLOBAL_LEADERSHIP.includes(viewer.role)) return "leadership";
  if (STUDIO_LEADERSHIP.includes(viewer.role) && sharesStudio(viewer, subject)) {
    return "leadership";
  }
  return sharesStudio(viewer, subject) ? "peer" : "outside";
}

export function resolveProfileVisibility(
  viewer: Trainer | null | undefined,
  subject: Trainer | null | undefined,
): ProfileVisibility {
  const scope = resolveProfileScope(viewer, subject);
  const privileged = scope === "self" || scope === "leadership";
  const sharesFloor = privileged || scope === "peer";

  return {
    scope,
    canEdit: privileged,
    showContact: privileged,
    showIntegration: privileged,
    showCoachingLoad: true,
    showRoster: sharesFloor,
    showSchedule: sharesFloor,
    showRecentlyCoached: sharesFloor,
  };
}

/** One line for the banner a read-only viewer sees at the top of the page. */
export function scopeNotice(scope: ProfileScope, firstName: string): string | null {
  switch (scope) {
    case "peer":
      return `Read-only — you're viewing ${firstName}'s profile.`;
    case "outside":
      return `Read-only — you don't share a studio with ${firstName}, so their clients are hidden.`;
    default:
      return null;
  }
}
