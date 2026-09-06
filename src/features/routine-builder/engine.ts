/**
 * ROUTINE ENGINE — analysis, sequencing repair, and suggestions.
 *
 * Round: Unified Routine Builder, Sep 2026.
 *
 * Pure functions over a machine-id array. No React, no Firestore, no studio
 * roster fetching — everything the engine needs arrives as an argument, which
 * is what makes the whole rule set testable without a browser.
 *
 * The doctrine itself lives in `academy.ts`. This file only decides *when* a
 * rule fires and *what to do about it*; it never invents a rule of its own.
 * If a warning needs new wording, it belongs in academy.ts with its source.
 */

import { canonicalMachineId } from "../catalog/machine-identity";
import { MACHINE_ANATOMY, type MuscleId } from "../../data/machine-anatomy-map";
import { toBodySlug } from "../../types/machines";
import {
  ACADEMY_CATEGORIES,
  BIG_FIVE,
  COMPLEMENTARY_PAIRS,
  EXERCISE_COUNT,
  EXERCISE_SUBSTITUTES,
  FOUNDATIONAL_CATEGORIES,
  FREQUENCY_CREDIT,
  MACHINE_ABBR,
  MACHINE_CATEGORY,
  MACHINE_FAMILY,
  SELECTION_TEMPLATES,
  SEQUENCING_RULES,
  isUpperBody,
  matchTemplates,
  musclesOf,
  type AcademyCategory,
  type SelectionTemplate,
  type SequencingRule,
  type TraineeLevel,
} from "./academy";

/* ────────────────────────────────────────────────────────────────────────
   Normalisation
   ──────────────────────────────────────────────────────────────────────── */

/**
 * Every entry point runs ids through `canonicalMachineId` first.
 *
 * Three id schemes are live in this repo (`m-leg-press`, `leg_press`,
 * `sm-{studio}-{slug}`) and a routine document can hold any of them depending
 * on when and where it was written. Rules keyed to `m-*` would silently never
 * fire on a client whose routine was seeded from the legacy database — a
 * failure mode that looks exactly like "the engine found no problems".
 */
export function normalizeIds(ids: readonly string[]): string[] {
  return ids.map((id) => canonicalMachineId(id)).filter(Boolean);
}

/* ────────────────────────────────────────────────────────────────────────
   Anatomy union — what the figure paints for a whole routine
   ──────────────────────────────────────────────────────────────────────── */

export interface RoutineAnatomy {
  primary: MuscleId[];
  secondary: MuscleId[];
  /** machines in the sequence hitting each muscle as a primary target */
  primaryHits: Partial<Record<MuscleId, string[]>>;
  secondaryHits: Partial<Record<MuscleId, string[]>>;
  /** machines with no anatomy mapping — the figure cannot speak for these */
  unmapped: string[];
}

/**
 * Union of every machine's targets, deduped by *region* rather than by muscle.
 *
 * Several MuscleIds collapse onto one drawable region (rhomboids and lats are
 * both `upper-back`; glutes and abductors are both `gluteal`). The catalog's
 * single-machine resolver already handles this; a routine makes it sharper,
 * because with seven machines almost every region has both a primary and a
 * secondary claim on it. Primary always wins, or the figure would show a
 * routine's actual targets as assists.
 */
export function resolveRoutineAnatomy(machineIds: readonly string[]): RoutineAnatomy {
  const ids = normalizeIds(machineIds);
  const primaryHits: Partial<Record<MuscleId, string[]>> = {};
  const secondaryHits: Partial<Record<MuscleId, string[]>> = {};
  const unmapped: string[] = [];

  for (const id of ids) {
    const entry = MACHINE_ANATOMY[id];
    if (!entry) {
      unmapped.push(id);
      continue;
    }
    for (const m of entry.primary) (primaryHits[m] ??= []).push(id);
    for (const m of entry.secondary ?? []) (secondaryHits[m] ??= []).push(id);
  }

  const primary = Object.keys(primaryHits) as MuscleId[];
  const primaryRegions = new Set(primary.map((m) => toBodySlug(m)).filter(Boolean) as string[]);

  const secondary = (Object.keys(secondaryHits) as MuscleId[]).filter((m) => {
    if (primaryHits[m]) return false;
    const region = toBodySlug(m);
    return !region || !primaryRegions.has(region);
  });

  return { primary, secondary, primaryHits, secondaryHits, unmapped };
}

/* ────────────────────────────────────────────────────────────────────────
   Violations
   ──────────────────────────────────────────────────────────────────────── */

export interface RoutineFix {
  /** Button label, imperative: "Move Abdominals before Lumbar". */
  label: string;
  apply: (ids: string[]) => string[];
}

export interface Violation {
  ruleId: string;
  severity: "avoid" | "caution";
  scope: "adjacent" | "session";
  title: string;
  why: string;
  source: string;
  escalate?: string;
  /** Positions in the sequence that participate, ascending. */
  indices: number[];
  machineIds: string[];
  fixes: RoutineFix[];
}

function familyOf(id: string): string | null {
  return MACHINE_FAMILY[id] ?? null;
}

/** Do these two machines share a primary target region? */
function sharesPrimaryRegion(a: string, b: string): boolean {
  const pa = new Set(
    (MACHINE_ANATOMY[a]?.primary ?? []).map((m) => toBodySlug(m)).filter(Boolean) as string[],
  );
  if (pa.size === 0) return false;
  // Secondary counts too: a Triceps Extension into a Chest Press is the
  // prefatigue case the doctrine actually warns about, and the triceps are
  // the chest press's *secondary*.
  const bMuscles = [...(MACHINE_ANATOMY[b]?.primary ?? []), ...(MACHINE_ANATOMY[b]?.secondary ?? [])];
  return bMuscles.some((m) => {
    const s = toBodySlug(m);
    return !!s && pa.has(s);
  });
}

function ruleMatchesPair(rule: SequencingRule, first: string, second: string): boolean {
  if (rule.familyMatch) {
    // Generic prefatigue: same family, both upper body, overlapping fibres.
    if (familyOf(first) !== rule.familyMatch) return false;
    if (familyOf(second) !== rule.familyMatch) return false;
    if (!isUpperBody(first) || !isUpperBody(second)) return false;
    return sharesPrimaryRegion(first, second) || sharesPrimaryRegion(second, first);
  }
  const a = rule.a as string[];
  const b = rule.b as string[];
  if (a.includes(first) && b.includes(second)) return true;
  if (!rule.directional && a.includes(second) && b.includes(first)) return true;
  return false;
}

function nameOf(id: string, names?: Record<string, string>): string {
  return names?.[id] ?? MACHINE_ABBR[id] ?? id;
}

/**
 * Move the machine at `from` to the position that removes the most adjacency
 * violations while displacing it least. Returns the original array unchanged
 * if nothing helps — a fix button that does nothing is worse than no button,
 * so `buildFixes` drops those before they reach the UI.
 */
function relocate(ids: string[], from: number): string[] {
  const without = ids.filter((_, i) => i !== from);
  const moved = ids[from];
  let best: { ids: string[]; score: number; distance: number } | null = null;

  for (let at = 0; at <= without.length; at++) {
    const candidate = [...without.slice(0, at), moved, ...without.slice(at)];
    const score = countAdjacencyViolations(candidate);
    const distance = Math.abs(at - from);
    if (!best || score < best.score || (score === best.score && distance < best.distance)) {
      best = { ids: candidate, score, distance };
    }
  }
  return best?.ids ?? ids;
}

function countAdjacencyViolations(ids: string[]): number {
  let n = 0;
  for (let i = 0; i < ids.length - 1; i++) {
    for (const rule of SEQUENCING_RULES) {
      if (rule.scope !== "adjacent") continue;
      if (ruleMatchesPair(rule, ids[i], ids[i + 1])) {
        n += rule.severity === "avoid" ? 2 : 1;
        break;
      }
    }
  }
  return n;
}

/**
 * Reorder to clear every adjacency conflict it can, keeping the trainer's
 * intent where possible.
 *
 * Greedy rather than exhaustive: at seven machines an exhaustive search is
 * 5,040 permutations and would find an "optimal" order that bears no
 * resemblance to what the trainer typed. Repeatedly relocating whichever
 * machine is currently in conflict changes as little as possible, which is
 * what makes the result recognisable when it lands back on screen.
 */
export function autoSequence(machineIds: readonly string[]): string[] {
  let ids = normalizeIds(machineIds);
  let guard = ids.length * 3;

  while (guard-- > 0) {
    let conflictAt = -1;
    outer: for (let i = 0; i < ids.length - 1; i++) {
      for (const rule of SEQUENCING_RULES) {
        if (rule.scope !== "adjacent" || rule.severity !== "avoid") continue;
        if (ruleMatchesPair(rule, ids[i], ids[i + 1])) {
          conflictAt = i + 1;
          break outer;
        }
      }
    }
    if (conflictAt === -1) break;

    const before = countAdjacencyViolations(ids);
    const next = relocate(ids, conflictAt);
    if (countAdjacencyViolations(next) >= before) break; // no progress; stop
    ids = next;
  }
  return ids;
}

function buildFixes(
  rule: SequencingRule,
  indices: number[],
  ids: string[],
  names?: Record<string, string>,
): RoutineFix[] {
  const fixes: RoutineFix[] = [];
  const [i, j] = indices;

  if (rule.fix === "abs-first") {
    // "performing the Abdominal exercise first with the Lumbar performed
    // several exercises later is the best approach"
    const lumbar = ids.findIndex((m) => m === "m-lumbar");
    const abs = ids.findIndex((m) => m === "m-abs" || m === "m-torso-rotation");
    if (lumbar > -1 && abs > -1 && abs > lumbar) {
      fixes.push({
        label: `Move ${nameOf(ids[abs], names)} before ${nameOf("m-lumbar", names)}`,
        apply: (current) => {
          const next = [...current];
          const a = next.findIndex((m) => m === "m-abs" || m === "m-torso-rotation");
          if (a === -1) return next;
          const [pulled] = next.splice(a, 1);
          const l = next.findIndex((m) => m === "m-lumbar");
          next.splice(Math.max(0, l), 0, pulled);
          return next;
        },
      });
    }
  }

  if (rule.fix === "swap-partner" && rule.id === "lumbar-into-leg-press") {
    // The documented alternative, not merely a reorder.
    if (ids.includes("m-leg-press") && !ids.includes("m-ext")) {
      fixes.push({
        label: `Swap ${nameOf("m-leg-press", names)} → ${nameOf("m-ext", names)}`,
        apply: (current) => current.map((m) => (m === "m-leg-press" ? "m-ext" : m)),
      });
    }
  }

  if (rule.scope === "adjacent" && typeof j === "number") {
    const candidate = relocate(ids, j);
    if (countAdjacencyViolations(candidate) < countAdjacencyViolations(ids)) {
      fixes.push({
        label: `Separate — move ${nameOf(ids[j], names)}`,
        apply: (current) => {
          const at = current.indexOf(ids[j]);
          return at === -1 ? current : relocate(current, at);
        },
      });
    }
  }

  if (rule.scope === "session" && rule.fix === "separate" && typeof j === "number") {
    // Same-session cautions cannot be resolved by reordering — the doctrine
    // asks for maximum distance, so that is what the fix delivers.
    if (Math.abs(j - i) < 3 && ids.length >= 4) {
      fixes.push({
        label: `Spread ${nameOf(ids[i], names)} and ${nameOf(ids[j], names)} apart`,
        apply: (current) => {
          const next = [...current];
          const at = next.indexOf(ids[j]);
          if (at === -1) return next;
          const [pulled] = next.splice(at, 1);
          const anchor = next.indexOf(ids[i]);
          // Put it as far from the anchor as the routine allows.
          const target = anchor <= next.length / 2 ? next.length : 0;
          next.splice(target, 0, pulled);
          return next;
        },
      });
    }
  }

  return fixes;
}

/**
 * Every rule violation in a sequence.
 *
 * Adjacency rules are checked most-specific first so that Pulldown next to
 * Compound Row reports the grip explanation the Academy gives it rather than
 * the generic prefatigue one — same pair, but the trainer learns more from
 * the specific reason.
 */
export function findViolations(
  machineIds: readonly string[],
  names?: Record<string, string>,
): Violation[] {
  const ids = normalizeIds(machineIds);
  const out: Violation[] = [];

  const specificFirst = [...SEQUENCING_RULES].sort(
    (a, b) => (a.familyMatch ? 1 : 0) - (b.familyMatch ? 1 : 0),
  );

  // adjacency
  for (let i = 0; i < ids.length - 1; i++) {
    for (const rule of specificFirst) {
      if (rule.scope !== "adjacent") continue;
      if (!ruleMatchesPair(rule, ids[i], ids[i + 1])) continue;
      out.push({
        ruleId: rule.id,
        severity: rule.severity,
        scope: rule.scope,
        title: rule.title,
        why: rule.why,
        source: rule.source,
        escalate: rule.escalate,
        indices: [i, i + 1],
        machineIds: [ids[i], ids[i + 1]],
        fixes: buildFixes(rule, [i, i + 1], ids, names),
      });
      break; // one reason per adjacent pair
    }
  }

  // same-session
  for (const rule of specificFirst) {
    if (rule.scope !== "session") continue;
    const a = rule.a as string[];
    const b = rule.b as string[];
    const ia = ids.findIndex((m) => a.includes(m));
    const ib = ids.findIndex((m) => b.includes(m) && !a.includes(m));
    if (ia === -1 || ib === -1) continue;

    // Already reported as an adjacency problem — do not say it twice.
    if (Math.abs(ia - ib) === 1 && out.some((v) => v.indices.includes(ia) && v.indices.includes(ib))) {
      continue;
    }
    const indices = [ia, ib].sort((x, y) => x - y);
    out.push({
      ruleId: rule.id,
      severity: rule.severity,
      scope: rule.scope,
      title: rule.title,
      why: rule.why,
      source: rule.source,
      escalate: rule.escalate,
      indices,
      machineIds: [ids[indices[0]], ids[indices[1]]],
      fixes: buildFixes(rule, indices, ids, names),
    });
  }

  return out.sort((x, y) => {
    if (x.severity !== y.severity) return x.severity === "avoid" ? -1 : 1;
    return x.indices[0] - y.indices[0];
  });
}

/* ────────────────────────────────────────────────────────────────────────
   Coverage
   ──────────────────────────────────────────────────────────────────────── */

export interface CategoryCoverage {
  category: AcademyCategory;
  foundational: boolean;
  machineIds: string[];
  covered: boolean;
}

export interface CountAdvice {
  tone: "ok" | "thin" | "heavy";
  text: string;
}

export interface RoutineAnalysis {
  machineIds: string[];
  violations: Violation[];
  byCategory: CategoryCoverage[];
  missingFoundational: AcademyCategory[];
  missingAny: AcademyCategory[];
  anatomy: RoutineAnatomy;
  count: number;
  countAdvice: CountAdvice | null;
  /** True when nothing at `avoid` severity is outstanding. */
  clean: boolean;
}

export function analyzeRoutine(
  machineIds: readonly string[],
  opts: { names?: Record<string, string>; level?: TraineeLevel; established?: boolean } = {},
): RoutineAnalysis {
  const ids = normalizeIds(machineIds);
  const violations = findViolations(ids, opts.names);

  const byCategory: CategoryCoverage[] = ACADEMY_CATEGORIES.map((category) => {
    const inCat = ids.filter((id) => MACHINE_CATEGORY[id] === category);
    return {
      category,
      foundational: FOUNDATIONAL_CATEGORIES.includes(category),
      machineIds: inCat,
      covered: inCat.length > 0,
    };
  });

  const missingFoundational = byCategory
    .filter((c) => c.foundational && !c.covered)
    .map((c) => c.category);
  const missingAny = byCategory.filter((c) => !c.covered).map((c) => c.category);

  let countAdvice: CountAdvice | null = null;
  const count = ids.length;
  if (count > 0) {
    if (count < EXERCISE_COUNT.min && opts.established) {
      countAdvice = {
        tone: "thin",
        text: `${count} exercises. Most established clients run at least ${EXERCISE_COUNT.soft.min}; ${EXERCISE_COUNT.target} is the proven target.`,
      };
    } else if (count > EXERCISE_COUNT.max) {
      countAdvice = {
        tone: "heavy",
        text: `${count} exercises is past the ${EXERCISE_COUNT.max} that fits the session with real intensity. Check the client can hold effort across all of them.`,
      };
    } else if (count > EXERCISE_COUNT.soft.max) {
      countAdvice = {
        tone: "heavy",
        text: `${count} exercises — workable for an advanced client, but only if time and intensity hold.`,
      };
    } else if (count === EXERCISE_COUNT.target) {
      countAdvice = { tone: "ok", text: `${count} exercises — the Academy's target.` };
    }
  }

  return {
    machineIds: ids,
    violations,
    byCategory,
    missingFoundational,
    missingAny,
    anatomy: resolveRoutineAnatomy(ids),
    count,
    countAdvice,
    clean: !violations.some((v) => v.severity === "avoid"),
  };
}

/* ────────────────────────────────────────────────────────────────────────
   Rotation analysis — the twice-weekly rule
   ──────────────────────────────────────────────────────────────────────── */

export interface RegionGap {
  muscle: MuscleId;
  /** Machines in the counterpart routine that train it. */
  machineIds: string[];
}

export interface RotationAnalysis {
  shared: string[];
  /** Trained in A, absent from B — these fibres get a once-weekly stimulus. */
  underDosed: RegionGap[];
  /** Trained in B only. Not a fault, but the mirror of the same question. */
  onlyInCounterpart: RegionGap[];
  missingAcrossRotation: AcademyCategory[];
  /** 0–1: share of A's primary regions that B also reaches. */
  overlap: number;
  /** The Academy eventually splits these two across workouts. */
  lumbarLegPressSplit: boolean;
}

/**
 * Compare a routine against its counterpart in the rotation.
 *
 * `primary` is the strict test — the doctrine is about fibres that receive
 * meaningful mechanical tension, and a synergist rarely does. But a region
 * covered as a *secondary* in the counterpart is not reported as a gap
 * either: the Academy's own worked example pairs Compound Row (biceps
 * secondary) in A with Pulldown (biceps secondary) in B and calls that
 * adequate biceps frequency.
 */
export function analyzeRotation(
  routine: readonly string[],
  counterpart: readonly string[],
): RotationAnalysis {
  const a = normalizeIds(routine);
  const b = normalizeIds(counterpart);
  const anatomyA = resolveRoutineAnatomy(a);
  const anatomyB = resolveRoutineAnatomy(b);

  /**
   * The frequency ledger, not the figure: everything a routine is credited
   * with stimulating, including regions the Academy names in prose but the
   * anatomy map does not paint (see FREQUENCY_CREDIT).
   */
  const creditedRegions = (ids: string[], anatomy: RoutineAnatomy): Set<string> => {
    const out = new Set<string>(
      [...anatomy.primary, ...anatomy.secondary].map((m) => toBodySlug(m) ?? m),
    );
    for (const id of ids) {
      for (const m of FREQUENCY_CREDIT[id] ?? []) out.add(toBodySlug(m) ?? m);
    }
    return out;
  };

  const bAll = creditedRegions(b, anatomyB);
  const aAll = creditedRegions(a, anatomyA);

  const underDosed: RegionGap[] = anatomyA.primary
    .filter((m) => !bAll.has(toBodySlug(m) ?? m))
    .map((m) => ({ muscle: m, machineIds: anatomyA.primaryHits[m] ?? [] }));

  const onlyInCounterpart: RegionGap[] = anatomyB.primary
    .filter((m) => !aAll.has(toBodySlug(m) ?? m))
    .map((m) => ({ muscle: m, machineIds: anatomyB.primaryHits[m] ?? [] }));

  const combined = new Set([...a, ...b]);
  const missingAcrossRotation = ACADEMY_CATEGORIES.filter(
    (c) => ![...combined].some((id) => MACHINE_CATEGORY[id] === c),
  );

  const overlap =
    anatomyA.primary.length === 0
      ? 1
      : anatomyA.primary.filter((m) => bAll.has(toBodySlug(m) ?? m)).length / anatomyA.primary.length;

  const lumbarLegPressSplit =
    (a.includes("m-lumbar") && !a.includes("m-leg-press")) ||
    (a.includes("m-leg-press") && !a.includes("m-lumbar"));

  return {
    shared: a.filter((id) => b.includes(id)),
    underDosed,
    onlyInCounterpart,
    missingAcrossRotation,
    overlap,
    lumbarLegPressSplit,
  };
}

/* ────────────────────────────────────────────────────────────────────────
   Suggestions
   ──────────────────────────────────────────────────────────────────────── */

export type ReasonKind =
  | "foundational-gap"
  | "frequency-gap"
  | "template"
  | "category-gap"
  | "pair"
  | "big-five"
  | "substitute"
  | "conflict"
  | "duplicate";

export interface SuggestionReason {
  kind: ReasonKind;
  text: string;
  weight: number;
  source?: string;
}

export interface Suggestion {
  machineId: string;
  score: number;
  reasons: SuggestionReason[];
  /** The single line the chip shows before the trainer expands it. */
  headline: string;
  /** Adding this at the end would create an `avoid` adjacency. */
  conflictsAtEnd: boolean;
}

export interface SuggestContext {
  machineIds: readonly string[];
  /** Machine ids present at this studio. Suggestions never leave this set. */
  available: readonly string[];
  /** For B-routine work: the routine this one must overlap with. */
  counterpart?: readonly string[] | null;
  /** Free text from intake / clinical notes, matched to selection templates. */
  purposeText?: string | null;
  /** Templates the trainer picked explicitly; these outrank keyword matches. */
  templateIds?: readonly string[];
  /** Which half of the rotation is being built — changes template column used. */
  slot?: "A" | "B";
  names?: Record<string, string>;
  limit?: number;
}

const W = {
  foundational: 100,
  frequency: 70,
  template: 45,
  category: 35,
  pair: 30,
  bigFive: 20,
  conflict: -55,
  duplicate: -25,
} as const;

export function activeTemplates(ctx: SuggestContext): SelectionTemplate[] {
  const explicit = (ctx.templateIds ?? [])
    .map((id) => SELECTION_TEMPLATES.find((t) => t.id === id))
    .filter(Boolean) as SelectionTemplate[];
  if (explicit.length > 0) return explicit;
  return matchTemplates(ctx.purposeText);
}

export function suggestMachines(ctx: SuggestContext): Suggestion[] {
  const current = normalizeIds(ctx.machineIds);
  const currentSet = new Set(current);
  const pool = normalizeIds(ctx.available).filter((id) => !currentSet.has(id));
  if (pool.length === 0) return [];

  const analysis = analyzeRoutine(current, { names: ctx.names });
  const templates = activeTemplates(ctx);
  const rotation = ctx.counterpart ? analyzeRotation(ctx.counterpart, current) : null;

  // Regions the counterpart trains that this routine does not yet reach.
  const gapRegions = new Map<string, RegionGap>();
  for (const gap of rotation?.underDosed ?? []) {
    gapRegions.set(toBodySlug(gap.muscle) ?? gap.muscle, gap);
  }

  const patternCounts = new Map<string, number>();
  for (const id of current) {
    const p = MACHINE_ANATOMY[id]?.movementPattern;
    if (p) patternCounts.set(p, (patternCounts.get(p) ?? 0) + 1);
  }

  const suggestions: Suggestion[] = pool.map((id) => {
    const reasons: SuggestionReason[] = [];
    const category = MACHINE_CATEGORY[id] ?? null;
    const { primary, secondary } = musclesOf(id);

    if (category && analysis.missingFoundational.includes(category)) {
      reasons.push({
        kind: "foundational-gap",
        weight: W.foundational,
        text: `No ${labelFor(category)} movement yet — one belongs in every workout.`,
        source: "Programming and Progression 1",
      });
    }

    if (rotation) {
      const covers = [...primary, ...secondary]
        .map((m) => toBodySlug(m) ?? m)
        .filter((region) => gapRegions.has(region));
      if (covers.length > 0) {
        const gap = gapRegions.get(covers[0])!;
        const via = (gap.machineIds[0] && ctx.names?.[gap.machineIds[0]]) || MACHINE_ABBR[gap.machineIds[0] ?? ""] || "the other routine";
        reasons.push({
          kind: "frequency-gap",
          weight: W.frequency + Math.min(covers.length - 1, 2) * 8,
          text: `Covers ${muscleLabel(gap.muscle)}, trained by ${via} in the other routine but missing here.`,
          source: "A/B Routines — How to Optimize Programming",
        });
      }
    }

    for (const template of templates) {
      const column = ctx.slot === "B" ? template.eventualB : template.eventualA;
      const inColumn = column.includes(id);
      const inOther = (ctx.slot === "B" ? template.eventualA : template.eventualB).includes(id);
      if (inColumn) {
        reasons.push({
          kind: "template",
          weight: W.template,
          text: `In the "${template.label}" ${ctx.slot ?? "A"} routine.`,
          source: "Exercise Selection Template",
        });
        break;
      }
      if (inOther) {
        reasons.push({
          kind: "template",
          weight: Math.round(W.template * 0.5),
          text: `In the "${template.label}" routine, on the other side of the rotation.`,
          source: "Exercise Selection Template",
        });
        break;
      }
    }

    if (
      category &&
      analysis.missingAny.includes(category) &&
      !analysis.missingFoundational.includes(category) &&
      current.length < EXERCISE_COUNT.target
    ) {
      reasons.push({
        kind: "category-gap",
        weight: W.category,
        text: `Nothing from ${labelFor(category)} in this routine yet.`,
        source: "Programming and Progression 1",
      });
    }

    for (const pair of COMPLEMENTARY_PAIRS) {
      const [x, y] = pair.machineIds;
      const partner = x === id ? y : y === id ? x : null;
      if (partner && currentSet.has(partner)) {
        reasons.push({
          kind: "pair",
          weight: W.pair,
          text: pair.why,
          source: pair.source,
        });
        break;
      }
    }

    if ((BIG_FIVE as readonly string[]).includes(id) && current.length < EXERCISE_COUNT.target) {
      reasons.push({
        kind: "big-five",
        weight: W.bigFive,
        text: "Part of the generic routine — the five movements that cover the most muscle.",
        source: "Programming and Progression 1",
      });
    }

    const conflictsAtEnd = createsAvoidAdjacency(current, id);
    if (conflictsAtEnd) {
      reasons.push({
        kind: "conflict",
        weight: W.conflict,
        text: "Would clash with the last machine if added at the end — insert it earlier.",
      });
    }

    const pattern = MACHINE_ANATOMY[id]?.movementPattern;
    if (pattern && (patternCounts.get(pattern) ?? 0) >= 2) {
      reasons.push({
        kind: "duplicate",
        weight: W.duplicate,
        text: `Already two ${pattern.replace(/^.*: /, "").toLowerCase()} movements in this routine.`,
      });
    }

    const score = reasons.reduce((sum, r) => sum + r.weight, 0);
    const lead = [...reasons].sort((p, q) => q.weight - p.weight)[0];

    return {
      machineId: id,
      score,
      reasons: reasons.sort((p, q) => q.weight - p.weight),
      headline: lead?.text ?? "Available at this studio.",
      conflictsAtEnd,
    };
  });

  return suggestions
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.machineId.localeCompare(b.machineId))
    .slice(0, ctx.limit ?? 6);
}

function createsAvoidAdjacency(current: string[], candidate: string): boolean {
  if (current.length === 0) return false;
  const last = current[current.length - 1];
  return SEQUENCING_RULES.some(
    (rule) =>
      rule.scope === "adjacent" &&
      rule.severity === "avoid" &&
      ruleMatchesPair(rule, last, candidate),
  );
}

/* ────────────────────────────────────────────────────────────────────────
   Substitutions
   ──────────────────────────────────────────────────────────────────────── */

export interface SubstituteOption {
  /** What replaces the machine. One id, or several that together cover it. */
  machineIds: string[];
  /** True when every machine in the set is on the studio floor. */
  availableHere: boolean;
}

/**
 * Documented replacements for a machine the client cannot use today —
 * broken equipment, an occupied station, or a joint that will not tolerate it.
 */
export function substitutesFor(
  machineId: string,
  available: readonly string[],
): SubstituteOption[] {
  const id = canonicalMachineId(machineId);
  const pool = new Set(normalizeIds(available));
  return (EXERCISE_SUBSTITUTES[id] ?? []).map((set) => ({
    machineIds: set.machineIds,
    availableHere: set.machineIds.every((m) => pool.has(m)),
  }));
}

/**
 * Put one or more machines where another one was.
 *
 * Position is preserved because position is the thing being protected: a
 * trainer swapping a busy Leg Press for Leg Extension + Abduction is not
 * reordering the session, and dropping the replacements at the end would
 * silently move the swap past everything that follows it — which is how a
 * substitution turns into a sequencing violation nobody asked for.
 *
 * Replacements already elsewhere in the sequence are dropped rather than
 * duplicated; a routine cannot list the same machine twice.
 */
export function replaceInSequence(
  machineIds: readonly string[],
  target: string,
  replacements: readonly string[],
): string[] {
  const ids = normalizeIds(machineIds);
  const from = canonicalMachineId(target);
  const at = ids.indexOf(from);
  if (at === -1) return ids;

  const seen = new Set<string>();
  const incoming = normalizeIds(replacements).filter((m) => {
    if (seen.has(m)) return false;
    seen.add(m);
    return m === from || !ids.includes(m);
  });

  return [...ids.slice(0, at), ...incoming, ...ids.slice(at + 1)];
}

/* ────────────────────────────────────────────────────────────────────────
   Labels
   ──────────────────────────────────────────────────────────────────────── */

const CATEGORY_TEXT: Record<AcademyCategory, string> = {
  "upper-pull": "upper-body pull",
  "upper-push": "upper-body push",
  legs: "lower body",
  trunk: "trunk / core",
  hips: "hip",
};

function labelFor(category: AcademyCategory): string {
  return CATEGORY_TEXT[category];
}

export const MUSCLE_LABEL: Record<MuscleId, string> = {
  pecs: "chest",
  "delts-front": "front delts",
  biceps: "biceps",
  forearms: "forearms",
  abs: "abdominals",
  obliques: "obliques",
  adductors: "adductors",
  abductors: "abductors",
  quads: "quads",
  traps: "traps",
  "delts-rear": "rear delts",
  rhomboids: "rhomboids",
  lats: "lats",
  triceps: "triceps",
  "lower-back": "lower back",
  glutes: "glutes",
  hamstrings: "hamstrings",
  calves: "calves",
  neck: "neck",
};

export function muscleLabel(muscle: MuscleId): string {
  return MUSCLE_LABEL[muscle] ?? muscle;
}
