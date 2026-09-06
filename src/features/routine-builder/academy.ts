/**
 * MSF ACADEMY — the methodology, encoded.
 *
 * Round: Unified Routine Builder, Sep 2026.
 *
 * Every constant in this file traces to a document in `docs/msf-academy/`.
 * The `source` field on a rule is not decoration — it is what a trainer sees
 * when they tap "why?" on a warning, and it is how the next person to touch
 * this file checks whether the code still says what the Academy says.
 *
 * Nothing here reaches Firestore. It is static doctrine: the studio's
 * machines change, the doctrine does not.
 *
 * ── Two vocabularies, deliberately ────────────────────────────────────────
 * MACHINE_ANATOMY already groups machines by `MovementPattern` (Horizontal
 * Push, Vertical Pull, …) — that is a *kinematic* grouping, built for the
 * Catalog's left menu. The Academy programs against a different, coarser set
 * of five *programming categories* (Upper Pull, Upper Push, Legs, Trunk,
 * Hips), and they do not nest cleanly: Hip Abduction is 'Lower Body:
 * Posterior Chain' kinematically but its own category, "Hips", for
 * programming. So both live side by side. Use MovementPattern to group a
 * picker; use AcademyCategory to decide whether a routine is complete.
 */

import { MACHINE_ANATOMY, type MovementPattern, type MuscleId } from "../../data/machine-anatomy-map";

const SRC = "docs/msf-academy";

/* ────────────────────────────────────────────────────────────────────────
   1 · THE FIVE PROGRAMMING CATEGORIES
   Source: Academy 6 - Programming and Progression 1 - Workout Programming
   Considerations (the category table at the foot of the document).
   ──────────────────────────────────────────────────────────────────────── */

export type AcademyCategory = "upper-pull" | "upper-push" | "legs" | "trunk" | "hips";

export const ACADEMY_CATEGORIES: AcademyCategory[] = [
  "upper-pull",
  "upper-push",
  "legs",
  "trunk",
  "hips",
];

export const CATEGORY_LABEL: Record<AcademyCategory, string> = {
  "upper-pull": "Upper Body — Pull",
  "upper-push": "Upper Body — Push",
  legs: "Lower Body",
  trunk: "Trunk / Spine / Core",
  hips: "Hips",
};

/** Short label for the portrait coverage strip, where 40px is the budget. */
export const CATEGORY_SHORT: Record<AcademyCategory, string> = {
  "upper-pull": "PULL",
  "upper-push": "PUSH",
  legs: "LEGS",
  trunk: "TRUNK",
  hips: "HIPS",
};

export const MACHINE_CATEGORY: Record<string, AcademyCategory> = {
  // Upper Body — Pull
  "m-compound-row": "upper-pull",
  "m-pulldown": "upper-pull",
  "m-pullover": "upper-pull",
  "m-simple-row": "upper-pull",
  "m-bicep": "upper-pull",
  // Upper Body — Push
  "m-chest-press": "upper-push",
  "m-overhead-press": "upper-push",
  "m-lateral-raise": "upper-push",
  "m-chest-fly": "upper-push",
  "m-dip": "upper-push",
  "m-tricep-ext": "upper-push",
  // Lower Body (Legs)
  "m-leg-press": "legs",
  "m-ext": "legs",
  "m-leg-curl": "legs",
  // Trunk / Spine / Core
  "m-lumbar": "trunk",
  "m-neck": "trunk",
  "m-abs": "trunk",
  "m-torso-rotation": "trunk",
  // Hips
  "m-hip-abd": "hips",
  "m-hip-add": "hips",
};

/**
 * "The first three categories (upper body - pull, upper body - push, and
 * legs) can be seen as foundational … these three categories should most
 * likely be included in every workout with the balance of exercises coming
 * from the trunk and/or hip categories as needed."
 *   — Programming and Progression 1
 */
export const FOUNDATIONAL_CATEGORIES: AcademyCategory[] = ["upper-pull", "upper-push", "legs"];

/**
 * The "generic" routine, a.k.a. the Big 5: horizontal push and pull, vertical
 * push and pull, and a leg press.
 *   — Programming and Progression 1
 */
export const BIG_FIVE = [
  "m-chest-press",
  "m-compound-row",
  "m-overhead-press",
  "m-pulldown",
  "m-leg-press",
] as const;

/**
 * The three movements introduced at consultation, which "become a core part
 * of the client's routine moving forward".
 *   — A/B Routines - How to Optimize Programming
 */
export const CONSULT_TRIO = ["m-leg-press", "m-compound-row", "m-lumbar"] as const;

/* ────────────────────────────────────────────────────────────────────────
   2 · ABBREVIATIONS
   The Academy writes routines as "ADD, SD, CR, TR, OH, PO, LP". Trainers
   speak this way on the floor, so the builder shows it too.
   ──────────────────────────────────────────────────────────────────────── */

export const MACHINE_ABBR: Record<string, string> = {
  "m-leg-press": "LP",
  "m-ext": "LE",
  "m-leg-curl": "LC",
  "m-compound-row": "CR",
  "m-simple-row": "SR",
  "m-pulldown": "Pd",
  "m-pullover": "PO",
  "m-chest-press": "CP",
  "m-chest-fly": "Flye",
  "m-overhead-press": "OH",
  "m-lateral-raise": "LR",
  "m-dip": "SD",
  "m-bicep": "Biceps",
  "m-tricep-ext": "Triceps",
  "m-lumbar": "Lumb",
  "m-abs": "Abs",
  "m-torso-rotation": "TR",
  "m-neck": "Cx",
  "m-hip-abd": "ABD",
  "m-hip-add": "ADD",
};

/** Reverse lookup, for reading Academy routine strings back into ids. */
export const ABBR_TO_MACHINE: Record<string, string> = Object.fromEntries(
  Object.entries(MACHINE_ABBR).map(([id, abbr]) => [abbr.toLowerCase(), id]),
);

/* ────────────────────────────────────────────────────────────────────────
   3 · PUSH / PULL FAMILY
   Needed for the prefatigue rule, which is stated in terms of "any
   push→push or pull→pull" rather than named machines.
   ──────────────────────────────────────────────────────────────────────── */

export type MovementFamily = "push" | "pull" | "hinge" | "isolation" | null;

const PUSH_PATTERNS: MovementPattern[] = [
  "Upper Body: Horizontal Push",
  "Upper Body: Vertical Push",
];
const PULL_PATTERNS: MovementPattern[] = [
  "Upper Body: Horizontal Pull",
  "Upper Body: Vertical Pull",
];

/**
 * Which overlapping-muscle family a machine belongs to, for prefatigue.
 *
 * The isolation machines are assigned by what they actually overlap with
 * rather than by their kinematic label: a Triceps Extension into a Chest
 * Press is the same prefatigue problem as Dip into Chest Press, and the
 * Academy's example list ("chest flye into the chest press") is explicitly
 * about overlapping fibres, not about the machine's category.
 */
export const MACHINE_FAMILY: Record<string, MovementFamily> = {
  "m-chest-press": "push",
  "m-chest-fly": "push",
  "m-overhead-press": "push",
  "m-dip": "push",
  "m-lateral-raise": "push",
  "m-tricep-ext": "push",
  "m-compound-row": "pull",
  "m-simple-row": "pull",
  "m-pulldown": "pull",
  "m-pullover": "pull",
  "m-bicep": "pull",
  "m-leg-press": "push",
  "m-ext": "push",
  "m-leg-curl": "hinge",
  "m-hip-abd": "isolation",
  "m-hip-add": "isolation",
  "m-lumbar": "hinge",
  "m-abs": "isolation",
  "m-torso-rotation": "isolation",
  "m-neck": "isolation",
};

/**
 * Upper-body push and pull prefatigue each other; lower-body push does not
 * meaningfully overlap upper-body push. The rule only fires when the two
 * machines share a family AND at least one primary muscle region.
 */
export function isUpperBody(machineId: string): boolean {
  const p = MACHINE_ANATOMY[machineId]?.movementPattern;
  return !!p && (PUSH_PATTERNS.includes(p) || PULL_PATTERNS.includes(p) || p === "Upper Body: Isolation");
}

/* ────────────────────────────────────────────────────────────────────────
   4 · SEQUENCING RULES
   Source: Programming and Progression 7 - Exercise Selection Template,
   section "Programming and/or sequencing to potentially avoid", plus the
   Lumbar/Leg Press discussion in A/B Routines - How to Optimize Programming.
   ──────────────────────────────────────────────────────────────────────── */

export type RuleSeverity = "avoid" | "caution";

/** `adjacent` fires on consecutive machines; `session` on co-presence. */
export type RuleScope = "adjacent" | "session";

export type RuleFixKind =
  | "separate" // pull the two apart in the order
  | "abs-first" // put Abdominals before Lumbar, with space
  | "swap-partner" // replace one with its documented complement
  | "none";

export interface SequencingRule {
  id: string;
  scope: RuleScope;
  severity: RuleSeverity;
  /** When true, only `a` followed by `b` fires; otherwise either order. */
  directional: boolean;
  /** Machine ids, or `"*"` to defer to `familyMatch`. */
  a: string[] | "*";
  b: string[] | "*";
  /** Set for the generic prefatigue rules. */
  familyMatch?: "push" | "pull";
  title: string;
  why: string;
  source: string;
  fix: RuleFixKind;
  /** Shown alongside the fix when the doctrine wants a human in the loop. */
  escalate?: string;
}

export const SEQUENCING_RULES: SequencingRule[] = [
  {
    id: "prefatigue-push",
    scope: "adjacent",
    severity: "avoid",
    directional: false,
    a: "*",
    b: "*",
    familyMatch: "push",
    title: "Two pushing movements back to back",
    why:
      "Fatigue carried over from the first push reduces motor-unit recruitment in the second, so the muscle you are trying to stimulate produces less tension, not more. Prefatigue is not a stimulus.",
    source: `${SRC}/Academy 6 …/Programming and Progression 7 - Exercise Selection Template.txt`,
    fix: "separate",
  },
  {
    id: "prefatigue-pull",
    scope: "adjacent",
    severity: "avoid",
    directional: false,
    a: "*",
    b: "*",
    familyMatch: "pull",
    title: "Two pulling movements back to back",
    why:
      "Overlapping fibres are already fatigued, which lowers recruitment on the second exercise. On pulling movements the grip is usually the limiter before the back is.",
    source: `${SRC}/Academy 6 …/Programming and Progression 7 - Exercise Selection Template.txt`,
    fix: "separate",
  },
  {
    id: "grip-pd-cr",
    scope: "adjacent",
    severity: "avoid",
    directional: false,
    a: ["m-pulldown"],
    b: ["m-compound-row"],
    title: "Pulldown and Compound Row consecutively",
    why:
      "With two pulling movements back to back the gripping muscles will likely be the limiting factor — for many clients they already are with just one.",
    source: `${SRC}/Academy 6 …/Programming and Progression 7 - Exercise Selection Template.txt`,
    fix: "separate",
  },
  {
    id: "lumbar-into-leg-press",
    scope: "adjacent",
    severity: "avoid",
    directional: true,
    a: ["m-lumbar"],
    b: ["m-leg-press"],
    title: "Lumbar directly into Leg Press",
    why:
      "Fatigue from the Lumbar invariably carries into the Leg Press, even when the Lumbar was performed lightly. It is an extremely uncomfortable feeling for the wrong reasons.",
    source: `${SRC}/Academy 6 …/Programming and Progression 7 - Exercise Selection Template.txt`,
    fix: "swap-partner",
  },
  {
    id: "lumbar-into-leg-curl",
    scope: "adjacent",
    severity: "avoid",
    directional: true,
    a: ["m-lumbar"],
    b: ["m-leg-curl"],
    title: "Lumbar directly into Leg Curl",
    why:
      "A properly executed Leg Curl tends to extend the lower back as effort rises. With the erectors already fatigued, that extension is very uncomfortable — especially for clients sensitive to spinal extension.",
    source: `${SRC}/Academy 6 …/Programming and Progression 7 - Exercise Selection Template.txt`,
    fix: "separate",
  },
  {
    id: "quad-into-trunk",
    scope: "adjacent",
    severity: "avoid",
    directional: true,
    a: ["m-leg-press", "m-ext"],
    b: ["m-lumbar", "m-abs"],
    title: "Quad movement directly into Lumbar or Abdominals",
    why:
      "The femur restraint is uncomfortable on freshly fatigued quads, and the Lumbar needs a high level of control to be performed safely — which a fatigued lower body undermines.",
    source: `${SRC}/Academy 6 …/Programming and Progression 7 - Exercise Selection Template.txt`,
    fix: "separate",
  },
  {
    id: "le-with-lp",
    scope: "session",
    severity: "caution",
    directional: false,
    a: ["m-ext"],
    b: ["m-leg-press"],
    title: "Leg Extension and Leg Press in the same session",
    why:
      "A great deal of quadriceps stimulus in one workout. Better placed on two non-consecutive days so the quads get a more frequent stimulus with enough recovery between. If both stay, do not push to failure on both.",
    source: `${SRC}/Academy 6 …/Programming and Progression 7 - Exercise Selection Template.txt`,
    fix: "none",
    escalate: "Discuss with your Studio Leader before implementing.",
  },
  {
    id: "lumbar-with-abs",
    scope: "session",
    severity: "caution",
    directional: false,
    a: ["m-lumbar"],
    b: ["m-abs", "m-torso-rotation"],
    title: "Lumbar and Abdominals in the same session",
    why:
      "Whichever is trained first, the client feels the fatigued side while training the other, and that becomes their point of focus. It is permissible — there is a therapeutic effect, and it matters for once-a-week clients — but perform the Abdominal first with the Lumbar several exercises later, and set both weights conservatively.",
    source: `${SRC}/Academy 6 …/Programming and Progression 7 - Exercise Selection Template.txt`,
    fix: "abs-first",
    escalate: "Involve your Studio Leader to devise a strategy.",
  },
  {
    id: "lumbar-with-leg-press",
    scope: "session",
    severity: "caution",
    directional: false,
    a: ["m-lumbar"],
    b: ["m-leg-press"],
    title: "Lumbar and Leg Press in the same session",
    why:
      "These two are eventually split into different workouts — interference created in the lower back during the Lumbar is sensed during the Leg Press. If they must share a workout, put as much space between them as possible.",
    source: `${SRC}/Academy 6 …/Programming and Progression 6 - AB Routines - How to Optimize Programming.txt`,
    fix: "separate",
  },
];

/* ────────────────────────────────────────────────────────────────────────
   5 · EXERCISE SUBSTITUTES
   Source: Exercise Substitutes.txt. Read as "if you cannot do the main
   exercise, these combinations cover the same ground."
   ──────────────────────────────────────────────────────────────────────── */

export interface SubstituteSet {
  /** All of these together replace the main exercise. */
  machineIds: string[];
}

export const EXERCISE_SUBSTITUTES: Record<string, SubstituteSet[]> = {
  "m-leg-press": [
    { machineIds: ["m-ext", "m-hip-abd", "m-lumbar"] },
    { machineIds: ["m-ext", "m-lumbar"] },
    { machineIds: ["m-ext", "m-leg-curl", "m-hip-abd"] },
    { machineIds: ["m-ext", "m-hip-abd", "m-hip-add"] },
  ],
  "m-compound-row": [
    { machineIds: ["m-simple-row", "m-bicep"] },
    { machineIds: ["m-simple-row", "m-pulldown"] },
  ],
  "m-pulldown": [
    { machineIds: ["m-pullover", "m-bicep"] },
    { machineIds: ["m-pullover", "m-compound-row"] },
  ],
  "m-chest-press": [
    { machineIds: ["m-chest-fly", "m-tricep-ext"] },
    { machineIds: ["m-chest-fly", "m-dip"] },
    { machineIds: ["m-dip", "m-overhead-press"] },
  ],
  "m-overhead-press": [{ machineIds: ["m-chest-press"] }, { machineIds: ["m-dip"] }],
  "m-dip": [{ machineIds: ["m-chest-fly", "m-tricep-ext"] }],
  "m-abs": [{ machineIds: ["m-pullover", "m-torso-rotation"] }],
  "m-bicep": [{ machineIds: ["m-pulldown"] }, { machineIds: ["m-compound-row"] }],
  "m-tricep-ext": [
    { machineIds: ["m-chest-press"] },
    { machineIds: ["m-overhead-press"] },
    { machineIds: ["m-dip"] },
  ],
  "m-hip-abd": [{ machineIds: ["m-leg-press"] }],
  "m-hip-add": [{ machineIds: ["m-lumbar"] }],
};

/* ────────────────────────────────────────────────────────────────────────
   6 · COMPLEMENTARY PAIRINGS
   Pairs the Academy names explicitly as working well together — either
   because they cover one region between them, or because one is the
   documented safe partner for the other.
   ──────────────────────────────────────────────────────────────────────── */

export interface ComplementaryPair {
  machineIds: [string, string];
  why: string;
  source: string;
}

export const COMPLEMENTARY_PAIRS: ComplementaryPair[] = [
  {
    machineIds: ["m-lumbar", "m-ext"],
    why:
      "The documented safe partner for the Lumbar. Pairing it with Leg Extension instead of Leg Press proactively prevents the lower-back interference.",
    source: `${SRC}/Academy 6 …/Programming and Progression 7 - Exercise Selection Template.txt`,
  },
  {
    machineIds: ["m-compound-row", "m-pullover"],
    why:
      "Covers the whole upper back in one routine — Compound Row takes rear delt, traps, rhomboids and biceps; Pullover takes the lats directly.",
    source: `${SRC}/Academy 6 …/Programming and Progression 6 - AB Routines - How to Optimize Programming.txt`,
  },
  {
    machineIds: ["m-simple-row", "m-pulldown"],
    why:
      "The B-routine mirror of Compound Row + Pullover: Simple Row takes rear delt, traps and rhomboids; Pulldown takes lats and biceps. Same regions, different movements.",
    source: `${SRC}/Academy 6 …/Programming and Progression 6 - AB Routines - How to Optimize Programming.txt`,
  },
  {
    machineIds: ["m-pullover", "m-bicep"],
    why:
      "Together these cover what a Pulldown covers — lats plus biceps — when the Pulldown itself is unavailable or unsuitable.",
    source: `${SRC}/Academy 6 …/Exercise Substitutes.txt`,
  },
  {
    machineIds: ["m-chest-fly", "m-tricep-ext"],
    why: "Together these cover what a Chest Press covers — pecs plus triceps.",
    source: `${SRC}/Academy 6 …/Exercise Substitutes.txt`,
  },
  {
    machineIds: ["m-hip-abd", "m-hip-add"],
    why:
      "Abduction and adduction are programmed together for balance work and for the ageing population, where hip strength and balance are the concern.",
    source: `${SRC}/Academy 6 …/Programming and Progression 1 - Workout Programming Considerations.txt`,
  },
];

/* ────────────────────────────────────────────────────────────────────────
   7 · THE MODEL A/B ROUTINE
   Source: A/B Routines - How to Optimize Programming. Presented in the
   document as "what an optimal A/B routine might eventually evolve into",
   for a client who has been training for at least two months.
   ──────────────────────────────────────────────────────────────────────── */

export type ClientPreference = "female" | "male" | "neutral";

/**
 * The document programs some slots differently by sex. It is explicit that
 * this reflects *what these groups have historically requested* — more
 * abdominal and hip work, more chest/shoulder/low-back respectively — and
 * that "it would be more advisable to refer to the specific request of each
 * client". So this is a starting suggestion the trainer overrides, never a
 * rule, and the UI labels it that way.
 */
export const MODEL_AB_ROUTINE: Record<ClientPreference, { a: string[]; b: string[] }> = {
  female: {
    a: ["m-hip-add", "m-dip", "m-compound-row", "m-torso-rotation", "m-overhead-press", "m-pullover", "m-leg-press"],
    b: ["m-hip-abd", "m-pulldown", "m-leg-curl", "m-ext", "m-simple-row", "m-chest-press", "m-lumbar"],
  },
  male: {
    a: ["m-leg-curl", "m-chest-press", "m-compound-row", "m-torso-rotation", "m-lateral-raise", "m-pullover", "m-leg-press"],
    b: ["m-hip-abd", "m-pulldown", "m-chest-fly", "m-ext", "m-simple-row", "m-overhead-press", "m-lumbar"],
  },
  neutral: {
    a: ["m-hip-add", "m-chest-press", "m-compound-row", "m-abs", "m-overhead-press", "m-pullover", "m-leg-press"],
    b: ["m-hip-abd", "m-pulldown", "m-leg-curl", "m-ext", "m-simple-row", "m-chest-fly", "m-lumbar"],
  },
};

/**
 * Regions the Academy counts a machine as stimulating, beyond what the
 * anatomy figure paints for it.
 *
 * These are two different questions and they need two different answers.
 * MACHINE_ANATOMY decides *what to colour in* — where the client will feel
 * the work, which is what makes the figure legible. Frequency accounting asks
 * *what received meaningful tension*, and the Academy answers that in its own
 * words: describing the model B routine it writes "Lumbar (glutes,
 * adductors)". Our figure paints the Lumbar as lower back and glutes, which is
 * right for a figure and incomplete as a ledger.
 *
 * Without this, the engine reports the Academy's own gold-standard A/B pair as
 * having an adductor frequency gap — a false positive on the one routine that
 * must come back clean.
 *
 * Add to this only with a quotable sentence from a document, never from
 * anatomical reasoning.
 */
export const FREQUENCY_CREDIT: Record<string, MuscleId[]> = {
  // "in the B routine we have programmed the Leg Extension (quads),
  //  Abduction (glutes, hips), and Lumbar (glutes, adductors)"
  "m-lumbar": ["adductors"],
};

/**
 * "long-term hypertrophy is only accomplished with an at least twice per week
 * stimulus … if we target the pecs directly in an A routine but then neglect
 * them in the B routine, the net effect will be that we are only truly
 * targeting those fibres once per week."
 *   — A/B Routines - How to Optimize Programming
 *
 * This is the single idea the B Routine creator exists to enforce.
 */
export const TWICE_WEEKLY_RULE = {
  statement:
    "Muscle regions trained in A must also be trained in B. Different exercises are fine — the same regions are not optional.",
  source: `${SRC}/Academy 6 …/Programming and Progression 6 - AB Routines - How to Optimize Programming.txt`,
} as const;

/**
 * "The B routine should be established by replacing one complementary
 * exercise of the A routine every week or so until the new routine has been
 * completed in its entirety … these routines should take at least 8 weeks
 * (or 16 sessions) to fully build out."
 */
export const B_ROUTINE_BUILD_OUT = {
  weeks: 8,
  sessions: 16,
  cadence: "Replace one complementary A exercise per week — not all at once.",
  source: `${SRC}/Academy 6 …/Programming and Progression 6 - AB Routines - How to Optimize Programming.txt`,
} as const;

/* ────────────────────────────────────────────────────────────────────────
   8 · EXERCISE SELECTION TEMPLATES
   Source: Programming and Progression 7 - Exercise Selection Template.
   The document's own framing: "these are just suggestions and can be used
   more for guidelines or ideas rather than formal rules."
   ──────────────────────────────────────────────────────────────────────── */

export type SelectionPurposeKind = "clear" | "condition" | "goal";

export interface SelectionTemplate {
  id: string;
  kind: SelectionPurposeKind;
  label: string;
  /** Matched against the client's intake/clinical text, lowercased. */
  keywords: string[];
  consult: string[];
  firstWorkout: string[];
  secondWorkout: string[];
  eventualA: string[];
  eventualB: string[];
  /** Caveats the document attaches to this row. */
  notes?: string[];
}

export const SELECTION_TEMPLATES: SelectionTemplate[] = [
  {
    id: "clear-female",
    kind: "clear",
    label: "No reported issues — female",
    keywords: [],
    consult: ["m-leg-press", "m-compound-row", "m-lumbar"],
    firstWorkout: ["m-hip-abd", "m-lumbar", "m-compound-row", "m-leg-press"],
    secondWorkout: ["m-hip-add", "m-dip", "m-compound-row", "m-pullover", "m-leg-press"],
    eventualA: ["m-hip-add", "m-dip", "m-compound-row", "m-torso-rotation", "m-overhead-press", "m-pullover", "m-leg-press"],
    eventualB: ["m-hip-abd", "m-pulldown", "m-chest-press", "m-leg-curl", "m-simple-row", "m-ext", "m-lumbar"],
  },
  {
    id: "clear-male",
    kind: "clear",
    label: "No reported issues — male",
    keywords: [],
    consult: ["m-leg-press", "m-compound-row", "m-lumbar"],
    firstWorkout: ["m-lumbar", "m-chest-press", "m-compound-row", "m-overhead-press", "m-leg-press"],
    secondWorkout: ["m-compound-row", "m-chest-press", "m-lumbar", "m-pulldown", "m-overhead-press", "m-leg-press"],
    eventualA: ["m-compound-row", "m-chest-press", "m-leg-curl", "m-torso-rotation", "m-pullover", "m-lateral-raise", "m-leg-press"],
    eventualB: ["m-hip-abd", "m-pulldown", "m-chest-fly", "m-lumbar", "m-simple-row", "m-overhead-press", "m-ext"],
  },
  {
    id: "low-back",
    kind: "condition",
    label: "Low back issues",
    keywords: ["low back", "lower back", "lumbar", "back pain", "sciatica", "disc", "stenosis", "spondyl"],
    consult: ["m-leg-press", "m-compound-row", "m-lumbar"],
    firstWorkout: ["m-lumbar", "m-hip-abd", "m-compound-row", "m-chest-press", "m-leg-press"],
    secondWorkout: ["m-lumbar", "m-hip-abd", "m-compound-row", "m-dip", "m-pulldown", "m-leg-press"],
    eventualA: ["m-lumbar", "m-compound-row", "m-chest-press", "m-hip-abd", "m-pullover", "m-ext", "m-torso-rotation"],
    eventualB: ["m-neck", "m-lumbar", "m-pulldown", "m-dip", "m-hip-add", "m-simple-row", "m-leg-press"],
    notes: [
      "Leg Press seat at P3 — test tolerance of the movement pattern first.",
      "Test the Lumbar with about 20 lb for ~3 reps before considering an increase.",
    ],
  },
  {
    id: "knee",
    kind: "condition",
    label: "Knee issues",
    keywords: ["knee", "patell", "meniscus", "acl", "knee replacement", "tkr"],
    consult: ["m-leg-curl", "m-leg-press", "m-compound-row"],
    firstWorkout: ["m-hip-add", "m-compound-row", "m-leg-curl", "m-chest-press", "m-leg-press"],
    secondWorkout: ["m-hip-add", "m-compound-row", "m-leg-curl", "m-dip", "m-pulldown", "m-leg-press"],
    eventualA: ["m-hip-add", "m-compound-row", "m-chest-press", "m-torso-rotation", "m-leg-curl", "m-pullover", "m-leg-press"],
    eventualB: ["m-simple-row", "m-hip-abd", "m-dip", "m-leg-curl", "m-pulldown", "m-lumbar", "m-ext"],
    notes: ["Leg Curl leads — knee flexion is generally better tolerated than deep flexion under load."],
  },
  {
    id: "shoulder",
    kind: "condition",
    label: "Shoulder issues",
    keywords: ["shoulder", "rotator cuff", "impingement", "labrum", "ac joint", "frozen shoulder"],
    consult: ["m-leg-press", "m-compound-row", "m-overhead-press"],
    firstWorkout: ["m-compound-row", "m-overhead-press", "m-pulldown", "m-leg-press"],
    secondWorkout: ["m-simple-row", "m-torso-rotation", "m-overhead-press", "m-pulldown", "m-leg-press"],
    eventualA: ["m-simple-row", "m-torso-rotation", "m-overhead-press", "m-pulldown", "m-leg-curl", "m-dip", "m-leg-press"],
    eventualB: ["m-simple-row", "m-hip-abd", "m-overhead-press", "m-compound-row", "m-lumbar", "m-ext", "m-pullover"],
    notes: ["Assess tolerance of the movement pattern and the available range of motion before loading."],
  },
  {
    id: "core",
    kind: "goal",
    label: "Increase core strength",
    keywords: ["core", "midsection", "abdominal", "abs", "trunk", "stability"],
    consult: ["m-leg-press", "m-compound-row", "m-torso-rotation"],
    firstWorkout: ["m-torso-rotation", "m-compound-row", "m-overhead-press", "m-leg-press"],
    secondWorkout: ["m-torso-rotation", "m-pullover", "m-overhead-press", "m-compound-row", "m-leg-press"],
    eventualA: ["m-torso-rotation", "m-pullover", "m-overhead-press", "m-hip-add", "m-compound-row", "m-chest-fly", "m-leg-press"],
    eventualB: ["m-abs", "m-pulldown", "m-chest-press", "m-hip-abd", "m-simple-row", "m-lumbar", "m-ext"],
  },
  {
    id: "upper-body",
    kind: "goal",
    label: "Upper body strength",
    keywords: ["upper body", "chest", "shoulders", "back strength", "push ups"],
    consult: ["m-leg-press", "m-compound-row", "m-overhead-press"],
    firstWorkout: ["m-dip", "m-compound-row", "m-overhead-press", "m-leg-press"],
    secondWorkout: ["m-abs", "m-dip", "m-compound-row", "m-overhead-press", "m-leg-press"],
    eventualA: ["m-dip", "m-compound-row", "m-abs", "m-lateral-raise", "m-pullover", "m-chest-fly", "m-leg-press"],
    eventualB: ["m-pulldown", "m-chest-press", "m-lumbar", "m-simple-row", "m-overhead-press", "m-ext", "m-bicep"],
  },
  {
    id: "lower-body",
    kind: "goal",
    label: "Lower body strength or balance",
    keywords: ["lower body", "legs", "balance", "falls", "stairs", "walking", "gait"],
    consult: ["m-leg-press", "m-compound-row", "m-leg-curl"],
    firstWorkout: ["m-leg-curl", "m-compound-row", "m-overhead-press", "m-leg-press"],
    secondWorkout: ["m-hip-add", "m-compound-row", "m-leg-curl", "m-overhead-press", "m-leg-press"],
    eventualA: ["m-hip-add", "m-compound-row", "m-torso-rotation", "m-overhead-press", "m-leg-curl", "m-pullover", "m-leg-press"],
    eventualB: ["m-leg-curl", "m-pulldown", "m-chest-press", "m-lumbar", "m-simple-row", "m-hip-abd", "m-ext"],
  },
  {
    id: "arms",
    kind: "goal",
    label: "Strengthen / build arms",
    keywords: ["arms", "biceps", "triceps", "tone arms"],
    consult: ["m-leg-press", "m-compound-row", "m-overhead-press"],
    firstWorkout: ["m-compound-row", "m-overhead-press", "m-leg-press", "m-bicep"],
    secondWorkout: ["m-compound-row", "m-chest-press", "m-leg-press", "m-bicep", "m-overhead-press"],
    eventualA: ["m-bicep", "m-dip", "m-abs", "m-compound-row", "m-chest-fly", "m-tricep-ext", "m-leg-press"],
    eventualB: ["m-tricep-ext", "m-pulldown", "m-lumbar", "m-chest-press", "m-simple-row", "m-bicep", "m-ext"],
    notes: ["Arms must be targeted in both workouts to satisfy the twice-per-week frequency requirement."],
  },
  {
    id: "posture",
    kind: "goal",
    label: "Improve posture",
    keywords: ["posture", "rounded shoulders", "kyphosis", "desk", "hunched", "forward head"],
    consult: ["m-leg-press", "m-simple-row", "m-lumbar"],
    firstWorkout: ["m-lumbar", "m-simple-row", "m-overhead-press", "m-leg-press"],
    secondWorkout: ["m-simple-row", "m-lumbar", "m-overhead-press", "m-pulldown", "m-leg-press"],
    eventualA: ["m-simple-row", "m-hip-add", "m-chest-press", "m-leg-curl", "m-compound-row", "m-torso-rotation", "m-leg-press"],
    eventualB: ["m-neck", "m-lumbar", "m-hip-abd", "m-dip", "m-compound-row", "m-chest-fly", "m-ext"],
    notes: ["Compound Row neutral grip in A, pronated grip in B."],
  },
  {
    id: "elbow-hand-wrist",
    kind: "condition",
    label: "Injured elbow / hand / wrist",
    keywords: [
      "elbow", "wrist", "hand", "carpal tunnel", "tennis elbow", "golfer", "grip", "arthritis in hands",
    ],
    consult: ["m-leg-press", "m-simple-row", "m-chest-fly"],
    firstWorkout: ["m-abs", "m-simple-row", "m-chest-fly", "m-leg-press"],
    secondWorkout: ["m-hip-add", "m-abs", "m-simple-row", "m-chest-fly", "m-leg-press"],
    eventualA: ["m-hip-add", "m-abs", "m-simple-row", "m-chest-fly", "m-leg-curl", "m-pullover", "m-leg-press"],
    eventualB: ["m-lumbar", "m-chest-fly", "m-pullover", "m-hip-abd", "m-lateral-raise", "m-leg-curl", "m-ext"],
    notes: [
      "Hand pads are strongly recommended before removing movements.",
      "If gripping is impossible, a hands-free workout still reaches shoulders and torso via Lateral Raise, Simple Row, Pullover and Chest Flye, plus all lower-body and trunk machines.",
    ],
  },
];

/**
 * Machines usable when the hands, wrists or elbows cannot bear load.
 * Source: Considerations for Training with Pain.
 */
export const HANDS_FREE_MACHINES = [
  "m-lateral-raise",
  "m-simple-row",
  "m-pullover",
  "m-chest-fly",
  "m-leg-press",
  "m-ext",
  "m-leg-curl",
  "m-hip-abd",
  "m-hip-add",
  "m-lumbar",
  "m-abs",
  "m-torso-rotation",
  "m-neck",
] as const;

export const PAIN_PROTOCOL = {
  headline: "Assess tolerance before load.",
  points: [
    "Start with very light resistance and a limited range of motion; progress in 2 lb increments only once symptoms do not increase.",
    "Where an area cannot move under load, use a Static Hold or Timed Static Contraction (TSC) instead of removing the machine.",
    "Hand pads first; a hands-free workout second; removing the upper body entirely is the last resort.",
  ],
  source: `${SRC}/Academy 6 …/Considerations for Training with Pain.txt`,
} as const;

/* ────────────────────────────────────────────────────────────────────────
   9 · VOLUME AND REP RANGES
   Sources: Programming and Progression 2/3/4 (Novice / Intermediate /
   Advanced), and Exercise Selection and Long-Term Programming.
   ──────────────────────────────────────────────────────────────────────── */

export type TraineeLevel = "novice" | "intermediate" | "advanced";

export const REP_RANGE_BY_LEVEL: Record<TraineeLevel, { min: number; max: number; note: string }> = {
  novice: {
    min: 8,
    max: 12,
    note: "Loads are deliberately light so control can be exaggerated, especially on the changes of direction.",
  },
  intermediate: {
    min: 5,
    max: 10,
    note: "Set durations shorten as loads rise with proficiency.",
  },
  advanced: {
    min: 3,
    max: 9,
    note: "Above 9 reps a set runs past three minutes and falls outside a high-intensity effort.",
  },
};

/**
 * "most of the workouts were constructed with 7 exercises. This should
 * eventually be the average number of exercises in a session."
 */
export const EXERCISE_COUNT = {
  target: 7,
  /** Below this a routine is flagged as thin for an established client. */
  min: 5,
  /** Above this the workout stops fitting the half-hour with real intensity. */
  max: 9,
  soft: { min: 6, max: 8 },
  note: "Seven is the proven target — achievable in the time available and at the intensity required.",
  source: `${SRC}/Academy 6 …/Programming and Progression 7 - Exercise Selection Template.txt`,
} as const;

/**
 * The six questions to answer before adding an exercise.
 * Source: Exercise Selection and Long-Term Programming.
 * Shown in the builder when a routine crosses EXERCISE_COUNT.soft.max.
 */
export const ADD_EXERCISE_CHECKLIST = [
  "Will it improve or maintain the training frequency for the targeted muscles?",
  "If A and B differ here, is there still real overlap in the fibres being trained?",
  "Does it address something the client actually raised, verbally or on intake?",
  "Is there time to perform it with proper control and execution?",
  "Can the client hold the necessary intensity with one more exercise?",
  "Does it improve the experience without compromising training quality?",
] as const;

/* ────────────────────────────────────────────────────────────────────────
   10 · HELPERS
   ──────────────────────────────────────────────────────────────────────── */

export function categoryOf(machineId: string): AcademyCategory | null {
  return MACHINE_CATEGORY[machineId] ?? null;
}

export function abbr(machineId: string): string | null {
  return MACHINE_ABBR[machineId] ?? null;
}

/** Format a sequence the way the Academy writes it: "ADD, SD, CR, TR, OH". */
export function asAcademyString(machineIds: string[]): string {
  return machineIds.map((id) => MACHINE_ABBR[id] ?? id).join(", ");
}

/** Primary + secondary muscles for one machine, from the shared anatomy map. */
export function musclesOf(machineId: string): { primary: MuscleId[]; secondary: MuscleId[] } {
  const entry = MACHINE_ANATOMY[machineId];
  return { primary: entry?.primary ?? [], secondary: entry?.secondary ?? [] };
}

/**
 * Templates whose keywords appear in the client's intake text.
 * Ordered most-specific first: conditions before goals, since a shoulder
 * problem constrains a routine more than a wish for bigger arms.
 */
export function matchTemplates(text: string | null | undefined): SelectionTemplate[] {
  if (!text) return [];
  const hay = text.toLowerCase();
  const hits = SELECTION_TEMPLATES.filter(
    (t) => t.keywords.length > 0 && t.keywords.some((k) => hay.includes(k)),
  );
  const rank: Record<SelectionPurposeKind, number> = { condition: 0, goal: 1, clear: 2 };
  return hits.sort((a, b) => rank[a.kind] - rank[b.kind]);
}

/** Default A/B model for a client, from `Client.gender`. */
export function preferenceFromGender(gender: string | null | undefined): ClientPreference {
  const g = (gender ?? "").trim().toLowerCase();
  if (g === "female" || g === "f") return "female";
  if (g === "male" || g === "m") return "male";
  return "neutral";
}
