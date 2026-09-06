/**
 * Roles defining system access levels across the organization.
 */
import type {
  ClientSubjectiveSnapshot,
  SubjectiveAssessment,
} from "./features/subjective-report/types";

export type UserRole =
  | "Admin"
  | "Founder"
  | "Owner"
  | "StudioLeader"
  | "LifeTransformer"
  | "FranchiseOwner"
  | "Overseer"
  | "StudioOwner"
  | "HeadTrainer"
  | "Trainer";

export const ROLE_LABELS: Record<UserRole, string> = {
  Admin: "System Administrator",
  Founder: "Founder / Overseer",
  Owner: "Franchise Owner",
  StudioLeader: "Studio Leader",
  LifeTransformer: "Life Transformer",
  // Legacy mappings
  FranchiseOwner: "Franchise Owner",
  Overseer: "Founder / Overseer",
  StudioOwner: "Franchise Owner",
  HeadTrainer: "Studio Leader",
  Trainer: "Life Transformer",
};

export type RPE = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export interface ClinicalTagDefinition {
  id: string;
  kind: "Form" | "Symptom" | "Behavior";
  machineId?: string;
  region?: "Upper" | "Lower" | "Core" | "Spine" | "Systemic";
  label: string;
  cue?: string;
  fourPCategory?: "Posture" | "Pace" | "Path" | "Purpose";
}

export type SleepQuality = "poor" | "average" | "optimal";
export type BodyRegionState = "stiff" | "prime";

export interface BodyStateTag {
  /** Free string at the type boundary so legacy data validates.
   *  New UI enforces the BODY_REGIONS enum at the picker. */
  region: string;
  state: BodyRegionState;
  /** Reserved for future intensity grading. */
  intensity?: 1 | 2 | 3;
}

export interface PreSessionCheckIn {
  /** @deprecated Use `sleepQuality`. Retained for legacy session reads. */
  sleepHours?: number;
  /** @deprecated Use `bodyStates`. Retained for legacy session reads. */
  sorenessLevel?: 1 | 2 | 3 | 4 | 5;
  /** @deprecated Use `bodyStates`. Retained for legacy session reads. */
  sorenessRegions?: string[];

  /** Qualitative sleep signal. `undefined` = trainer did not capture. */
  sleepQuality?: SleepQuality;

  /** Per-region body state tags. `undefined` = not captured;
   *  `[]` = trainer affirmatively reviewed and recorded nothing. */
  bodyStates?: BodyStateTag[];

  stressLevel?: 1 | 2 | 3 | 4 | 5;
  hydration?: "low" | "ok" | "good";
  /**
   * One-tap energy and mood (Sep 2026), captured in the briefing beside
   * sleep and stress so the Clinical Review can cross-reference them with
   * rep quality and tonnage. `undefined` = not asked / not answered.
   */
  energyLevel?: "low" | "normal" | "high";
  mood?: "low" | "neutral" | "good";
  note?: string;
}

export type ClientFeel = "Wiped Out" | "Good" | "Energized";

export interface ClinicalIncident {
  id?: string;
  clientId: string;
  studioId: string;
  sessionId?: string;
  machineId?: string;
  region: string;
  severity: "mild" | "moderate" | "stop_session";
  description: string;
  actionTaken?: string;
  resolvedAt?: any;
  surfaceUntil?: any;
  reportedByTrainerId: string;
  createdAt: any;
}

/**
 * Represents a group of studios owned by a Studio Owner or managed as a region.
 */
export interface FranchiseNetwork {
  id: string;
  name: string;
  ownerId?: string; // Legacy
  ownerIds?: string[]; // Multiple Owners
  state?: string; // e.g. "Ohio"
  studioIds: string[]; // List of Studio IDs included in this network
  createdAt?: any;
}

export interface Network {
  id: string;
  name: string;
  ownerId: string;
  studioIds: string[];
}

/**
 * Represents the top-level entity owning one or more studios.
 */
export interface Owner {
  id: string;
  name: string;
  email: string;
  /** IDs of studios owned by this entity for relational mapping */
  ownedStudioIds: string[];
}

export interface TrainerAvailability {
  standard: {
    [day: string]: { isOpen: boolean; slots: { start: string; end: string }[] };
  };
  overrides?: {
    [date: string]: {
      isOpen: boolean;
      slots: { start: string; end: string }[];
    };
  };
}

/**
 * TRAINER & STAFF PROFILES
 * Trainers are assigned to home locations but can be granted guest access elsewhere.
 */
/**
 * Facts MINDBODY owns about a staff member.
 *
 * Written only by the Mindbody sync (webhook + scheduled refresh) and never
 * edited in the app. Kept in its own map on purpose: a trainer document also
 * carries `role`, `pinHash` and studio access, and no external system should
 * ever be one field-name collision away from changing those.
 */
export interface MindbodyStaffSnapshot {
  staffId: string;
  siteId?: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  email?: string;
  /** Mindbody's staff photo. Usually absent -- initials remain the default. */
  imageUrl?: string | null;
  imageFetchedAt?: any;
  isActive?: boolean;
  homeLocationId?: string;
  locationIds?: string[];
  lastSyncAt?: any;
  /** e.g. "staff.updated" -- surfaced in the Integrations Hub. */
  lastEventType?: string;
}

/** Why a client is on a trainer's Kaizen Roster. Keeps the list scannable. */
export type KaizenReason =
  | "Progression"
  | "Form"
  | "Return"
  | "Retention"
  | "Milestone"
  | "Other";

export const KAIZEN_REASONS: KaizenReason[] = [
  "Progression",
  "Form",
  "Return",
  "Retention",
  "Milestone",
  "Other",
];

/** What each reason means on the floor. Used for the picker's helper text. */
export const KAIZEN_REASON_HINTS: Record<KaizenReason, string> = {
  Progression: "Pushing a specific adaptation",
  Form: "4 P's work in flight",
  Return: "Coming back from a layoff",
  Retention: "At risk, needs attention",
  Milestone: "Approaching something worth marking",
  Other: "Anything else worth watching",
};

/**
 * One client a trainer has chosen to keep an eye on.
 *
 * NOTE ON COLOUR: the red kaizen mark belongs to rep quality ("this set needs
 * work"). Roster membership is drawn in brand slate/blue and never crimson,
 * so a glance can always tell "I am tracking you" from "that rep was poor".
 */
export interface KaizenRosterEntry {
  clientId: string;
  /** Denormalised so a roster row renders before the client list resolves. */
  clientName: string;
  reason: KaizenReason;
  /** Max 240 characters. */
  note?: string;
  addedAt: any;
  addedByTrainerId: string;
  /** Optional check-back date; drives the "due" sort. */
  reviewBy?: any;
}

/** Hard cap. A roster of 200 is a client list, and it would bloat a document
 *  that streams to every device on every snapshot. */
export const KAIZEN_ROSTER_MAX = 40;

/**
 * Persisted session counters. NEVER computed on read.
 *
 * `sessionsCoached` is incremented by a Cloud Function the moment a session
 * completes; the windowed figures are rewritten nightly, because a rolling
 * 30-day number has to forget things and a counter cannot.
 */
export interface TrainerRollups {
  /** Lifetime, incremented at write time. */
  sessionsCoached?: number;
  sessionsCoached30d?: number;
  sessionsCoached90d?: number;
  /** Distinct clients coached in the last 90 days. */
  clientsCoached90d?: number;
  /** Sessions per week across the 90-day window. */
  avgPerWeek?: number;
  firstSessionAt?: any;
  lastSessionAt?: any;
  windowsUpdatedAt?: any;
  /** Stamped by the admin backfill. Absent = history not yet counted. */
  rollupVersion?: number;
  rollupUpdatedAt?: any;
}

export interface Trainer {
  id: string;
  fullName: string;
  nickname?: string;
  initials: string;
  brandColor?: string;
  mindbodyLinked?: boolean;
  pin?: string;
  pinHash?: string;
  requiresPinReset?: boolean;
  role: UserRole;
  ownedStudioIds?: string[];
  primaryHomeStudioId: string;
  accessibleStudioIds: string[];
  activeGuestStudioIds: string[];
  bio?: string;
  email?: string;
  thirdPartyCalendarUrl?: string;
  certifications?: string[];
  employmentStartDate?: any;
  availability?: TrainerAvailability;
  mindbodyStaffId?: string;
  mindbody_ical_url?: string;
  legacy_filemaker_id?: string;
  createdAt?: any;
  order?: number;
  isVisibleOnCalendar?: boolean;
  searchTokens?: string[];
  /** Locally set photo. Beats `mindbody.imageUrl` when present. */
  photoUrl?: string | null;
  /** Everything the Mindbody staff sync owns. Nothing else writes here. */
  mindbody?: MindbodyStaffSnapshot;
  /** Owner writes, whole studio team reads. Capped at KAIZEN_ROSTER_MAX. */
  kaizenRoster?: KaizenRosterEntry[];
  /** Server-maintained counters. Never written from a client. */
  rollups?: TrainerRollups;
}

export type NewTrainerPayload = CreateTrainerPayload;

/**
 * Payload utilized for creating a new Trainer/Staff record.
 * Crucially excludes any ID field to avoid creation of orphan references.
 */
export interface CreateTrainerPayload {
  fullName: string;
  initials: string;
  pin?: string;
  pinHash?: string;
  requiresPinReset?: boolean;
  role?: UserRole;
  email?: string;
  primaryHomeStudioId: string;
  accessibleStudioIds: string[];
  activeGuestStudioIds?: string[];
  isVisibleOnCalendar?: boolean;
  searchTokens?: string[];
  isOwner?: boolean; // Help modal switch mapping to owner role
  systemStatus?: "active" | "inactive";
}

/**
 * Payload utilized for updating a Trainer/Staff record.
 */
export interface UpdateTrainerPayload {
  fullName?: string;
  nickname?: string;
  email?: string;
  role?: UserRole;
  initials?: string;
  brandColor?: string;
  mindbodyLinked?: boolean;
  pin?: string;
  pinHash?: string;
  primaryHomeStudioId?: string;
  accessibleStudioIds?: string[];
  activeGuestStudioIds?: string[];
  isVisibleOnCalendar?: boolean;
  searchTokens?: string[];
  systemStatus?: "active" | "inactive";
  ownedStudioIds?: string[];
  bio?: string;
  thirdPartyCalendarUrl?: string;
  certifications?: string[];
  mindbodyStaffId?: string;
  mindbody_ical_url?: string;
  order?: number;
  /** The Start date picker in Edit Trainer had nowhere to land before. */
  employmentStartDate?: any;
  photoUrl?: string | null;
}

export interface ClientEvent {
  id: string;
  date: string; // Start date
  endDate?: string; // End date for block events
  title: string;
  type:
    | "Progress Report"
    | "InBody Scan"
    | "Routine Change"
    | "Vacation"
    | "Birthday/Anniversary"
    | "Other"
    | "Medical"
    | "Snowbird"
    | "Alert";
  priority: "High" | "Medium" | "Low";
  notes?: string;
  createdAt?: any;
}

export interface ClinicalSafetyFlag {
  id: string;
  category: string;
  conditionName: string;
  label?: string;
  severity: string;
  protocolHandling: {
    instruction: string;
    affectedMachineIds: string[];
    setupModification?: string;
  }[];
}

export interface CurrentMachineMetric {
  weight: string;
  reps?: string;
  seconds?: string;
  isStaticHold?: boolean;
  isTSC?: boolean;
  totalTimeUnderLoad?: number;
  averageTimePerRep?: number;
  settings: Record<string, string>;
  lastPerformedDate: any;
  lastPerformedSessionNumber?: number;
  lastSessionId?: string;
}

/**
 * Lifetime rollup for one machine, kept on the client document so the
 * Equipment tab can show "first performed / times performed / progression"
 * WITHOUT loading every exercise log the client ever produced. Written by
 * lib/client-rollups.ts from the same two places that write the session
 * counters: session completion and the legacy CSV import.
 *
 * `firstWeight` + `firstPerformedDate` are write-once (they only ever fill a
 * blank); `timesPerformed` is a Firestore increment; `lastWeight` /
 * `lastPerformedDate` overwrite. See src/features/client-profile/README.md.
 */
export interface ClientMachineStat {
  /** ISO date (YYYY-MM-DD) of the first logged set on this machine. */
  firstPerformedDate?: string;
  /** Load of that first set, in lb. */
  firstWeight?: number;
  /** ISO date of the most recent logged set. */
  lastPerformedDate?: string;
  /** Load of the most recent set, in lb. */
  lastWeight?: number;
  /** Number of sessions in which this machine was logged. */
  timesPerformed?: number;
}

export interface ClientRetentionMeta {
  excludedFromMIA?: boolean;
  excludedReason?: string;
  excludedBy?: string; // Trainer ID or Name
  autoIncludeAfter?: any; // Timestamp or string Date
  lastContactedDate?: any; // Timestamp or string Date
}

/**
 * A Mindbody membership assignment mirrored onto the client document by the
 * `clientMembershipAssignment.*` webhooks. Cancelled records are kept (status
 * flips to "Cancelled") so we never lose the history of what a client held.
 */
export interface MindbodyMembership {
  membershipId: number | string;
  /** Absent when the only event we ever saw for this membership was a cancel. */
  membershipName?: string;
  status: "Active" | "Cancelled";
  /** Mindbody site the membership belongs to (multi-site disambiguation). */
  siteId?: number | string;
  /** Firestore Timestamp. */
  assignedAt?: any;
  /** Firestore Timestamp; only set once the membership is removed. */
  cancelledAt?: any;
  /** Firestore Timestamp of the last webhook that touched this record. */
  lastSyncAt?: any;

  /* --- Pull-sync only (GetActiveClientMemberships); webhooks never send these. --- */
  /** Firestore Timestamp. */
  activeDate?: any;
  /** Firestore Timestamp. */
  expirationDate?: any;
  /** Sessions the membership includes, when it is a session-based one. */
  sessionCount?: number | null;
  /** Sessions left on the membership. */
  sessionsRemaining?: number | null;
  programName?: string;
  /** Firestore Timestamp of the last Mindbody API pull that touched this. */
  lastPullSyncAt?: any;
}

/**
 * A Mindbody contract mirrored onto the client document by the
 * `clientContract.*` webhooks, keyed by `clientContractId` (the unique
 * client + contract pairing). `clientContract.updated` carries dates only, so
 * writes are deep-merged and never clear a previously synced name.
 */
export interface MindbodyContract {
  /** Unique identifier for the contract + client pairing. Map key. */
  clientContractId: number | string;
  /** The contract template id. Absent on update-only records. */
  contractId?: number | string;
  /** Absent on update-only records -- the update event omits the name. */
  contractName?: string;
  status: "Active" | "Cancelled";
  siteId?: number | string;
  isAutoRenewing?: boolean;
  /** Firestore Timestamps parsed from Mindbody's UTC strings. */
  startDate?: any;
  endDate?: any;
  agreementDate?: any;
  soldByStaffName?: string;
  /** 98 means the client bought it themselves (app / online store / API). */
  originationLocationId?: number | string;
  createdAt?: any;
  updatedAt?: any;
  cancelledAt?: any;
  lastSyncAt?: any;

  /**
   * Pull-sync only. The Mindbody API exposes `AutopayStatus` (a string) rather
   * than the webhook's `isAutoRenewing` boolean, so it is stored under its own
   * name and never overwrites the boolean.
   */
  autopayStatus?: string;
  /** Firestore Timestamp of the last Mindbody API pull that touched this. */
  lastPullSyncAt?: any;
}

export interface Client {
  id?: string;
  mindbodyId?: string;
  mindbodyClientId?: string;
  photoUrl?: string;
  /** MANDATORY: The studio where the client is billed and primarily trains */
  homeStudioId: string;
  approvedCrossTrainStudioIds?: string[]; // Studio IDs where cross-training is explicitly approved
  firstName: string;
  lastName: string;
  dateOfBirth?: string;
  gender?: "Male" | "Female" | "Other" | string;
  height: string; // e.g., "5'10\""
  weight?: string;
  age?: number;
  phone?: string;
  email?: string;
  address?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  isActive: boolean;
  medicalHistory?: string;
  occupation?: string;
  isRetired?: boolean;
  experienceLevel?: "Beginner" | "Intermediate" | "Advanced" | string;
  clinicalProfile?: string[];
  clinicalFlags?: string[];
  clinicalNotes?: string;
  activityLevel?: "Sedentary" | "Light" | "Moderate" | "High" | "Manual Labor";
  trainingPedigree?:
    | "Novice"
    | "Intermediate"
    | "Advanced"
    | "Protocol Veteran";
  recoveryMetric?: "Poor" | "Average" | "Optimal";
  activity?: string;
  goals?: string;
  globalNotes?: string;
  leadSource?: string;
  referredBy?: string;
  notes?: string;
  /** Pinned "read this before the session" note. Raises the loud flag on the hub schedule block. */
  priorityNote?: string;
  /** Denormalized: true while the client has an outstanding High-priority session note. */
  hasPriorityNote?: boolean;
  /**
   * Written when a progress report with a 90-day check-in is finalized, so the
   * hub and client list can show a Red flag without opening the report.
   * See src/features/subjective-report/README.md.
   */
  subjectiveSnapshot?: ClientSubjectiveSnapshot | null;
  events?: ClientEvent[];
  isRoutineBActive?: boolean;
  preferredTodayRoutineId?: string;
  remainingSessions: number;
  legacy_filemaker_id?: string;
  mindbody_name?: string;
  /** First 1000 chars of the client's Mindbody account notes (webhook-synced, read-only in app). */
  mindbodyNotes?: string;
  /** Mindbody memberships keyed by membershipId. Webhook-synced, read-only. */
  mindbodyMemberships?: Record<string, MindbodyMembership>;
  /** Mindbody contracts keyed by clientContractId. Webhook-synced, read-only. */
  mindbodyContracts?: Record<string, MindbodyContract>;
  /** Firestore Timestamp of the last Mindbody contract/membership pull. */
  mindbodyCommercialSyncedAt?: any;

  /* ------------------------------------------------------------------ *
   * MINDBODY-OWNED IDENTITY & COMPLIANCE (Sep 2026)
   *
   * Written by the client.created / client.updated webhook handler, which
   * treats them the way it already treats the other Mindbody-owned facts:
   * these OVERWRITE on every sync, because nobody types them in this app and
   * Mindbody is the system of record. Person-facts (name, email, address...)
   * keep the existing fill-blanks-only behaviour.
   *
   * Deliberately NOT stored: creditCardLastFour, creditCardExpDate,
   * directDebitLastFour. The webhook sends them; nothing in a coaching app
   * needs them, and persisting them drags PCI-adjacent exposure into a
   * document every trainer can read.
   * ------------------------------------------------------------------ */

  /** Liability waiver signed at the business. Gates the pre-session start. */
  isLiabilityReleased?: boolean;
  /** Firestore Timestamp of when the waiver was agreed to. */
  liabilityAgreementDate?: any;
  /** Mindbody membership status: Active | Non-Member | Expired | Suspended | Terminated | Declined, or a studio's own custom value. */
  mindbodyStatus?: string;
  /**
   * Mindbody client indexes, flattened from the payload's
   * [{indexName, indexValue}] list to a map so a lookup is O(1) and a
   * re-sync cannot leave stale entries behind. e.g. { LongtermGoal: "IncreasedFlexibility" }.
   */
  mindbodyIndexes?: Record<string, string>;
  /** Firestore Timestamp — when the client was added to the business. */
  mindbodyCreatedAt?: any;
  /** Firestore Timestamp of the client's first visit to the site. */
  firstAppointmentDate?: any;
  /** Mindbody's home location id for this client. */
  mindbodyHomeLocationId?: number | string;
  /** True while Mindbody flags the record as a prospect rather than a client. */
  isProspect?: boolean;

  /* Address parts. `address` stays the single-line field trainers edit; these
   * are filled from the webhook and only ever fill blanks. */
  city?: string;
  addressState?: string;
  postalCode?: string;
  country?: string;

  /** Trainer-entered SMART goal. Was written via a cast; now typed. */
  smartGoal?: string;
  completedSessions?: number;
  sessionCount?: number;

  /* ------------------------------------------------------------------ *
   * TOP TRAINER — a tracked field, not a calculation (Sep 2026).
   *
   * `trainerTally` counts completed sessions per trainer id. It is bumped
   * with a Firestore increment in the two places a completed session is
   * born — finishing a live session and the legacy CSV import — and
   * decremented when a session is deleted from the History tab, so the
   * number is race-safe across two iPads finishing at once. Sessions whose
   * trainer never resolved to a trainer document are counted under
   * `initials:XX` so they are not lost.
   *
   * `topTrainerId` is the DERIVED winner, persisted for the hub and client
   * list to read without loading sessions; the profile header re-derives
   * it from the tally on every render so it can never be stale.
   * lib/client-rollups.ts owns the rules (and the one-time backfill for
   * clients created before the field existed).
   * ------------------------------------------------------------------ */
  trainerTally?: Record<string, number>;
  topTrainerId?: string | null;
  topTrainerName?: string | null;
  topTrainerSessions?: number;
  /** Firestore Timestamp of the last tally write (or backfill). */
  trainerTallyUpdatedAt?: any;
  /** Per-machine lifetime rollups keyed by machineId. See ClientMachineStat. */
  machineStats?: Record<string, ClientMachineStat>;
  /**
   * Set once the Equipment tab has rebuilt `machineStats` from the complete
   * session history (clients created before the rollup existed). Until it is
   * present the tab shows figures from the sessions it has loaded and labels
   * them as partial.
   */
  machineStatsBackfilledAt?: any;
  /**
   * Lifetime visit count as Mindbody counts it at the site. Distinct from
   * `sessionCount`, which is this app's own count of completed workouts — the
   * two will not agree and neither is wrong.
   */
  clientsNumberOfVisitsAtSite?: number;
  lifetimeReps?: number;
  lifetimeWeight?: number;
  packageTier?: "6-Month" | "12-Month" | "18-Month" | "None";
  consultationCompleted?: boolean;
  requiresConsultation?: boolean;
  firstSessionDate?: any;
  discoveryNotes?: string;
  currentMachineMetrics?: Record<string, CurrentMachineMetric>;
  createdAt?: any;
  retentionMeta?: ClientRetentionMeta;
}

export interface Machine {
  id?: string;
  name: string;
  fullName?: string;
  settings?: string; // Repurposed as "Standard Setup Tips"
  trainerTips?: string;
  settingOptions?: string[]; // e.g. ["Seat", "Pads", "Backrest"]
  targetRepRange?: string;
  standardSettings?: Record<string, string>; // e.g. {"Seat": "5", "Pads": "2"}
  standardWeights?: {
    Beginner?: number | string;
    Intermediate?: number | string;
    Advanced?: number | string;
  };
  order?: number;
  imageUrl?: string;
  anatomicalRegion?: string;
  kinematicClassification?: string;
  targetMuscles?: string | string[]; // Muscle group names or short desc
  primaryMuscles?: string[];
  targetMusculature?: string[];
  synergists?: string[];
  setupGap?: string;
  executionPosture?:
    | "Chest Up / Anterior Pelvic Tilt"
    | "Posterior Pelvic Tilt / Contracted Abdomen"
    | string;
  requiresHandoff?: boolean;
  sequencingContraindications?: string[];
  biomechanicalNotes?: string;
  contraindicatedFor?: string[];
  modifications?: string;
  muscleImageUrl?: string; // Image showing targeted muscles
  formVideoUrl?: string;
  cueingTips?: string; // Peer-to-peer trainer tips
  deepDiveNotes?: string;
}

export interface MachineSettingChange {
  studioId?: string;
  id?: string;
  machineId: string;
  clientId: string;
  trainerId: string;
  previousSettings: Record<string, string>;
  newSettings: Record<string, string>;
  reason?: string;
  createdAt: any;
}

export interface Routine {
  studioId?: string;
  id?: string;
  clientId: string;
  name: string;
  machineIds: string[];
  machineNotes?: Record<string, string>; // Machine ID -> Routine-specific Note
  /**
   * Template provenance (round: Routine Template Builder, Sep 2026).
   * Templates are advisory: a trainer may change anything after applying one.
   * These fields exist so the change is visible rather than silent.
   */
  templateId?: string;
  templateName?: string;
  /**
   * The machine list AS THE TEMPLATE HAD IT when it was applied. Snapshotted
   * deliberately: comparing against the live template would relabel old
   * routines as "deviating" every time an admin edits the template, which
   * would blame the trainer for someone else's edit.
   */
  templateMachineIds?: string[];
  templateAppliedAt?: any;
  createdAt?: any;
  updatedAt?: any;
}

/**
 * A reusable machine sequence a trainer can drop into a client's Routine A/B
 * in one tap. Two tiers, matching the LeaderboardDocument scope convention:
 *  - scope: "global"   -> shipped in code (see data/routine-presets.ts), not
 *    a Firestore doc, so it has no studioId/createdBy.
 *  - scope: <studioId> -> a studio's own saved preset, stored in the
 *    routinePresets collection and only ever shown to that studio.
 */
export type RoutinePresetTier = "company" | "studio" | "trainer";

export interface RoutinePreset {
  id?: string;
  name: string;
  description?: string;
  machineIds: string[];
  /**
   * Machine ID -> coaching note the admin wrote for THIS template, e.g.
   * "start conservative, this is most clients' first pulling movement".
   * Copied onto the routine's own machineNotes when the template is applied.
   */
  machineNotes?: Record<string, string>;
  scope: "global" | string;
  /**
   * Who authored this and at what level (round: Routine Template Builder,
   * Sep 2026):
   *   company  admin-authored, every studio sees it
   *   studio   authored by that location's owner/leader, only they see it
   *   trainer  ad-hoc, saved from the Edit Routine drawer
   *
   * ABSENT on every document written before Sep 2026. Do not read it
   * directly -- run documents through normalizeRoutinePreset(), which infers
   * the tier from `scope` so old trainer-saved presets keep behaving exactly
   * as they did.
   */
  tier?: RoutinePresetTier;
  studioId?: string;
  createdBy?: string;
  createdByName?: string;
  createdAt?: any;
  updatedAt?: any;
  updatedBy?: string;
}

/**
 * Per-studio override of a machine's adjustable settings, display order,
 * and whether this studio even has that piece of equipment (round: Multi-
 * Tenant Machine Settings, Aug 2026). Doc id is `${studioId}_${machineId}`.
 * The base `machines` collection stays the shared, global catalog (names,
 * anatomy mapping, etc.) — this collection layers studio-specific
 * customization on top without ever mutating that shared doc, so one
 * studio's settings edit can no longer silently change what every other
 * studio sees.
 */
export interface StudioMachineSetting {
  id?: string;
  studioId: string;
  machineId: string;
  settingOptions?: string[];
  standardSettings?: Record<string, string>;
  /** Custom display order for this studio; falls back to
   * DEFAULT_MACHINE_DISPLAY_ORDER (data/machine-display-order.ts) when
   * unset. */
  order?: number;
  /** Whether this studio possesses/uses this piece of equipment.
   * Undefined/true = possessed (matches pre-existing behavior for studios
   * that haven't customized anything yet). */
  isActive?: boolean;
  updatedAt?: any;
  updatedBy?: string;
}

export interface RoutineAdjustment {
  studioId?: string;
  id?: string;
  routineId: string;
  clientId: string;
  previousMachineIds: string[];
  newMachineIds: string[];
  trainerId: string;
  notes?: string;
  createdAt: any;
  changeType?: "created" | "machines" | "enabled" | "disabled";
}

export type SessionType = "Standard" | "Onboarding" | "Reset";

export interface WorkoutSession {
  id?: string;
  clientId?: string;
  routineId?: string;
  /** PHYSICAL LOCATION: Where the workout actually took place */
  hostedAtStudioId: string;
  /** DATA ANCHOR: The client's home base (used for local reporting vs cross-studio usage) */
  clientHomeStudioId: string;
  /** Flag for sessions performed at a non-home studio location */
  isCrossTrain: boolean;
  sessionType: SessionType;
  sessionNumber: number;
  date: string;
  trainerInitials: string;
  trainerId?: string;
  mindbodyClientId?: string;
  clientName?: string;
  /** Who originally initiated the session document (Soft Lock Architecture) */
  startedByTrainerId?: string;
  /** Activity checkpoint updated during logs to detect abandonment (Lazy Cleanup) */
  lastHeartbeatAt?: any;
  notes?: string; // Original notes field (deprecated in favor of sub-collection)
  clientFeel?: ClientFeel | string;
  preSessionCheckIn?: PreSessionCheckIn;
  postFeel?: {
    physical: 1 | 2 | 3 | 4 | 5;
    mental: 1 | 2 | 3 | 4 | 5;
    overallRPE?: RPE;
  };
  startTime?: any;
  endTime?: any;
  /** Client-clock start, used while `startTime`'s serverTimestamp() is pending. */
  clientStartTime?: string;
  /** When the current pause began; null/absent while the session is running. */
  pausedAt?: any;
  /** Milliseconds accumulated across completed pauses. */
  totalPausedMs?: number;
  /**
   * The machine sequence ACTUALLY PERFORMED in this session, in order.
   *
   * The routine document is a template: what the client is prescribed. This is
   * the record: what happened on the day. They diverge constantly and for good
   * reasons — the client arrived late so it was five machines, another trainer
   * was on the Leg Press so the Pulldown moved up, there was time at the end
   * for a bicep curl. All of that is worth keeping in the history and none of
   * it should edit the prescription.
   *
   * Written when the session starts and again whenever the trainer changes the
   * order mid-workout, so the sequence survives a refresh — which on iPad
   * Safari is not a hypothetical. Absent on sessions recorded before Sep 2026;
   * readers fall back to the routine.
   */
  sessionMachineIds?: string[];
  status: "In-Progress" | "Completed";
  clientAge?: number;
  clientOccupation?: string;
  clientIsRetired?: boolean;
  clientActivityLevel?: string;
  clientClinicalProfile?: string[];
  legacy_filemaker_id?: string;
  legacy_notes?: string;
  createdAt?: any;
}

export interface SessionNote {
  studioId?: string;
  id?: string;
  sessionId: string;
  clientId?: string;
  trainerId?: string;
  trainerInitials: string;
  content: string;
  priority?: "High" | "Medium" | "Low";
  createdAt: any;
}

export type RepQuality = 1 | 2 | 3;

export interface ExerciseLog {
  studioId?: string;
  homeStudioId?: string;
  clientHomeStudioId?: string;
  id?: string;
  sessionId: string;
  clientId?: string;
  machineId: string;
  suggestedOrder?: number;
  weight?: string;
  reps?: string;
  loadLb?: string;
  outcomeTut?: string;
  outcomeReps?: string;
  repsLeft?: number;
  repsRight?: number;
  seconds?: string;
  targetWeight?: string;
  isStaticHold?: boolean;
  isTSC?: boolean;
  repQuality?: RepQuality;
  timeSpent?: string;
  totalTimeUnderLoad?: number;
  averageTimePerRep?: number;
  machineStartedAt?: any;
  machineDurationSeconds?: number;
  side?: "Left" | "Right";
  notes?: string;
  machineSettings?: Record<string, string>; // Settings used for this specific set
  createdAt?: any;
  updatedAt?: any;
  rpe?: RPE;
  rpeNote?: string;
  eccentricSeconds?: number;
  concentricSeconds?: number;
  pauseSeconds?: number;
  clinicalTags?: string[];
  symptoms?: {
    region: string;
    intensity: 1 | 2 | 3 | 4 | 5;
    onsetRep?: number;
    note?: string;
  }[];
  setupReason?:
    | "client_self_set"
    | "trainer_fix"
    | "protocol_progression"
    | "comfort_adjust";
  setupWasCorrect?: boolean;
}

export interface MachineNote {
  id?: string;
  content: string;
  authorId?: string;
  authorName: string;
  timestamp: any;
  isImportant: boolean;
}

export interface SettingsHistoryEntry {
  settings: Record<string, string>;
  updatedBy: string;
  updatedAt: any;
  reason?: string;
}

export interface ClientMachineSetting {
  studioId?: string;
  id?: string;
  clientId: string;
  machineId: string;
  settings: Record<string, string>;
  updatedBy: string;
  updatedAt: any;
  notes?: string;
  machineNotes?: MachineNote[];
  settingsHistory?: SettingsHistoryEntry[];
  startingWeight?: number;
  startingWeightDate?: any;
  currentWeight?: number;
}

/**
 * Client-pass snapshot as Mindbody reported it at booking time. Only the keys
 * Mindbody actually sent are present — see lib/mindbody-pass.ts.
 */
export interface MindbodyPass {
  passId?: string;
  sessionsTotal?: number;
  sessionsDeducted?: number;
  sessionsRemaining?: number;
  activationDateTime?: string;
  expirationDateTime?: string;
}

/**
 * A Mindbody event that could not be attributed to a studio, parked rather than
 * dropped. Written by both the webhook and the pull-sync; cleared from the
 * Admin -> Limbo screen.
 */
export interface LimboEntry {
  id?: string;
  eventId: string;
  eventType: string;
  kind: "booking" | "client" | "commercial";
  source?: "webhook" | "pull-sync";
  siteId: string | null;
  locationId: string | null;
  clientId: string | null;
  reason: string;
  summary?: {
    bookingId?: string;
    clientName?: string;
    /** RAW Mindbody wall-clock strings — unconverted, no timezone known yet. */
    rawStartDateTime?: string | null;
    rawEndDateTime?: string | null;
    staffName?: string | null;
    serviceName?: string | null;
    status?: string;
    mindbodyPass?: MindbodyPass;
  };
  payload?: Record<string, any>;
  firstSeenAt?: any;
  lastSeenAt?: any;
  resolvedAt?: any;
  resolvedStudioId?: string;
  dismissed?: boolean;
}

export interface ScheduleEntry {
  id?: string;
  clientId?: string;
  /** Raw Mindbody client id, kept alongside clientId for reconciliation. */
  mindbodyClientId?: string;
  /** Mindbody's booking id. Also used as this document's id. */
  mindbodyAppointmentId?: string;
  /** Pass/package state at booking time, when Mindbody reports it. */
  mindbodyPass?: MindbodyPass;
  /** True when the booking came off a waitlist rather than a direct booking. */
  bookingOriginatedFromWaitlist?: boolean;
  clientName: string;
  trainerId?: string;
  trainerName: string;
  studioId: string;
  startTime: any;
  endTime: any;
  status: "Scheduled" | "Completed" | "Cancelled" | "No-Show";
  serviceName: string;
  source: "MindBody" | "Manual" | "Subscription";
  importId?: string;
  ical_uid?: string;
  createdAt: any;
}

export type HighlightMetricType =
  | "strength_gain"
  | "total_volume"
  | "consistent_quality"
  | "time_under_tension"
  | "custom";

export interface ProgressReport {
  studioId?: string;
  id?: string;
  clientId: string;
  trainerId: string;
  trainerName: string;
  trainerInitials?: string;
  sessionNumber?: number;
  date: string;
  isManual?: boolean;
  status: "Draft" | "Finalized";

  // Step 1: Attendance & Consistency
  attendance: {
    score: number; // 0-100
    totalSessions: number;
    avgDuration: number;
    punctuality: string; // e.g., "Generally early"
    narrative: string; // "Great job showing up..."
    firstSessionDate?: string;
    totalVolume?: number;
    totalReps?: number;
    totalGoodReps?: number;
    avgRestDays?: number;
    toggles?: {
      totalSessions: boolean;
      totalVolume: boolean;
      totalReps: boolean;
      totalGoodReps?: boolean;
      avgRestDays: boolean;
      avgDuration: boolean;
    };
    customStartDate?: string;
  };

  // Step 2: Highlighted Movements (Measurable Progress)
  highlights: {
    machineId?: string;
    label: string;
    metricType?: HighlightMetricType;
    startValue?: string;
    currentValue?: string;
    percentageIncrease?: number;
    totalVolume?: number;
    perfectSets?: number;
    timeUnderTension?: number;
    customText?: string;
    narrative?: string;
  }[];

  // Step 3: The Four P's
  performanceMatrix: {
    includedNotes?: string[];
    posture: {
      score: number;
      note: string;
      talkingPoints: {
        id: string;
        text: string;
        status: "red" | "black" | "green";
      }[];
    };
    pace: {
      score: number;
      note: string;
      talkingPoints: {
        id: string;
        text: string;
        status: "red" | "black" | "green";
      }[];
    };
    path: {
      score: number;
      note: string;
      talkingPoints: {
        id: string;
        text: string;
        status: "red" | "black" | "green";
      }[];
    };
    purpose: {
      score: number;
      note: string;
      talkingPoints: {
        id: string;
        text: string;
        status: "red" | "black" | "green";
      }[];
    };
  };

  // Step 4: The Past (Milestones)
  milestones: {
    originalWhy: string;
    smartGoal: string; // "Skiing trip ready by [Date]"
  };

  // Step 5: The Future
  strategy: {
    primaryPlan: string; // "Routine Mastery"
    focusAreas: string; // "Immediate machine focus..."
  };

  roadmap?: {
    trackType?: "maintenance" | "goals" | "refinement";

    // Maintenance
    selectedHabits?: string[];
    routineChangeRequested?: boolean;
    routineModifications?: string;

    // Goals
    emotionalAnchor?: string;
    smartGoal?: string;
    targetMachineId?: string;
    goalActions?: string[];
    machinePlan?: string;

    // Refinement
    refinementFocusArea?: "Posture" | "Pace" | "Path" | "Purpose" | string;
    routineIntervention?: string;

    // Legacy
    anchorCategory?: "weight_loss" | "eih_management" | "general_conditioning";
    prescriptionType?: "quantitative" | "qualitative";
    inStudioPrescription?: {
      targetMachine: string;
      targetMetric?: string;
      qualitativeFocus?: string;
      timeframe: string;
    };
  };

  /* ------------------------------------------------------------------ *
   * Sep 2026 additions. All optional so every report already on file still
   * type-checks and renders.
   * ------------------------------------------------------------------ */

  /** The finalized report this one is compared against (deltas, goal carry-over). */
  previousReportId?: string | null;

  /**
   * True when the report holds ONLY a 90-day check-in, run from the
   * pre-session briefing or the post-session screen. Opened later, the view
   * offers "Build the full report", which clears this flag and continues in
   * the six-step editor with the check-in already done.
   */
  isCheckInOnly?: boolean;
  checkInOrigin?: "pre_session" | "post_session" | "report";
  /** The session the quick check-in was run around, when there was one. */
  checkInSessionId?: string | null;

  /** Step 3 — machine progression: start → current per machine over the report window. */
  machineProgression?: MachineProgression;

  /** Step 5 — the 90-day check-in. Spec: src/features/subjective-report/README.md */
  subjective?: SubjectiveAssessment;

  /** Step 6 — goal continuity: how the last goal went, and the next 90 days. */
  goals?: ReportGoals;

  trainerNotes?: string;

  createdAt: any;
}

export interface MachineProgressionRow {
  machineId: string;
  label: string;
  startWeight: number;
  currentWeight: number;
  percentageIncrease: number;
  totalVolume?: number;
  perfectSets?: number;
  timeUnderTension?: number;
}

export interface MachineProgression {
  /** Machines the trainer chose to show the client. Order = display order. */
  includedMachineIds: string[];
  /** Every machine with history in the window, captured at save so the printed copy is stable. */
  rows: MachineProgressionRow[];
  narrative?: string;
}

export type GoalOutcome = "achieved" | "on_track" | "stalled" | "revised";

export interface GoalCheckpoint {
  id: string;
  text: string;
  done: boolean;
}

export interface ReportGoals {
  /** The emotional anchor — why they started. Carried forward report to report. */
  originalWhy: string;
  /** The goal set at the previous report (or the client's SMART goal on file). */
  previousGoal: string;
  previousGoalOutcome: GoalOutcome | null;
  /** How it went, in plain words for the client. */
  previousGoalNote: string;
  /** The goal for the next 90 days. */
  nextGoal: string;
  /** ISO date. Defaults to report date + 90 days. */
  nextGoalTargetDate: string;
  /** ISO date the next report is due — what the trainer follows up on. */
  followUpDate: string;
  /** Two or three concrete steps toward the next goal. */
  checkpoints: GoalCheckpoint[];
}

export type FocusCategory = "Posture" | "Pace" | "Path" | "Purpose";

export type FocusStatus = "Active" | "Achieved" | "Deleted";

export interface FocusRecord {
  studioId?: string;
  id: string;
  clientId: string;
  category: FocusCategory;
  dateAssigned: any; // Timestamp or date string
  assignedBy: string; // Trainer initials
  trainerId: string; // Trainer ID
  targetMachineId?: string; // Machine ID
  clinicalNotes: string;
  status: FocusStatus;
  dateUpdated?: any;
}

export interface TrainerFocus {
  studioId?: string;
  id?: string;
  clientId: string;
  trainerId: string;
  trainerName: string;
  category: FocusCategory;
  notes: string;
  updatedAt: any;
}

/**
 * PHYSICAL LOCATION SCHEMA
 * Studios are the primary organizational units where workouts occur.
 */
export interface Studio {
  id?: string;
  name: string;
  ownerId: string;
  headTrainerId?: string;
  contactEmail?: string;
  phone?: string;
  address?: string;
  timezone: string;
  /** MindBody Site ID for external API synchronization */
  mindbodySiteId?: string;
  /** MindBody Location ID for location-specific filtering when site IDs are shared */
  mindbodyLocationId?: string | number;
  locationType?: "corporate" | "franchise";
  createdAt?: any;
  networkId?: string; // Newly added to associate with a FranchiseNetwork
  machineSettings?: Record<string, Record<string, string>>; // studioStandardSettings per machine
  retentionSettings?: {
    atRiskThresholdDays: number;
    miaThresholdDays: number;
    autoExcludeAfterDays: number;
    sleepPoorCountThreshold?: number;
    poorMachineLogsThreshold?: number;
    stressLowCountThreshold?: number;
    stressLowValueThreshold?: number;
    noStrengthGainsDays?: number;
  };
  notificationSettings?: {
    bookingRemindersEnabled?: boolean;
    dailySummaryEnabled?: boolean;
  };
  autoSyncEnabled?: boolean;
  syncIntervalMinutes?: number;
  brandColor?: string;
}

export interface HubAnnouncement {
  id?: string;
  title: string;
  shortContent: string;
  longContent: string;
  authorId: string;
  authorName: string;
  studioId: string | "all"; // Legacy scope field
  targetScope?: "universal" | "network" | "studio";
  targetId?: string; // Network ID or Studio ID
  type?: "shout-out" | "tip" | "news" | "event" | "holiday";
  referenceTarget?: {
    type: "trainer" | "client" | "studio";
    id: string;
  };
  expiresAt?: any; // Timestamp for auto-expiration
  createdAt: any;
  isActive: boolean;
  priority: "low" | "medium" | "high"; // Treated as urgency
  readBy?: string[];
}

export interface LeaderboardRank {
  clientId: string;
  clientName: string;
  weight: number;
  rank: number;
  percentile: number;
  reps?: number;
  gap?: number;
  strengthGainPercent?: number;
  maxWeight?: number;
}

export interface LeaderboardMachineData {
  topPerformers: LeaderboardRank[];
  stats: {
    count: number;
    avg: number;
    max: number;
    min: number;
    buckets: { min: number; max: number; count: number }[];
  };
  percentileThresholds: {
    p90: number;
    p75: number;
    p50: number;
    p25: number;
    p10: number;
  };
  clientPlacements: Record<
    string,
    { weight: number; rank: number; percentile: number }
  >; // clientId -> placement details
}

export interface LeaderboardDocument {
  id?: string;
  lastUpdated: any;
  scope: "global" | string; // 'global' or studioId
  machineData: Record<string, LeaderboardMachineData>;
}

export type View =
  | "trainers"
  | "clients"
  | "machines"
  | "workouts"
  | "history"
  | "calendar"
  | "trainer-hub"
  | "dashboard"
  | "profile"
  | "chart"
  | "progress-report"
  | "clinical-review"
  | "trainer-profile"
  | "progress-report"
  | "consultation-wizard"
  | "machine-knowledge"
  | "machine-anatomy"
  | "studio-tasks"
  | "client-directory"
  | "chart-importer"
  | "leaderboard"
  | "admin-dashboard"
  | "franchise-dashboard"
  | "retention"
  | "mindbody"
  | "purchases";

export interface AuditLogEntry {
  id?: string;
  action: string;
  collection: string;
  documentId: string;
  userId: string;
  studioId?: string;
  details?: Record<string, any>;
  timestamp: any;
}
