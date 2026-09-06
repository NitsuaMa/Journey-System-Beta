/**
 * EQUIPMENT TAB — source merging.
 *
 * Round: Equipment Dual-Pane, Sep 2026.
 *
 * Three sources describe a machine and none is complete on its own:
 *
 *   1. `Machine` (the prop ClientProfileView already passes)  — name, order,
 *      settingOptions, standardSettings. What the app runs on TODAY.
 *   2. MACHINE_DATABASE (static, in-repo)                     — setup and
 *      execution cues, baseline loads, imagery. Never empty, never editable.
 *   3. machines/{id} MachineCatalogEntry                      — typed
 *      settingFields with help text. RICHEST, but empty until the roster
 *      backfill runs, so nothing may depend on it being there.
 *
 * Precedence: catalog > static knowledge > legacy prop, per field. Every field
 * the catalog gains upgrades the UI on its own with no component change.
 *
 * ── The one rule that matters ────────────────────────────────────────────
 * A setting's STORAGE KEY must keep matching what is already in
 * `clientMachineSettings.settings` for that machine, or a redesign silently
 * orphans values a trainer saved last week. Legacy data is keyed by the human
 * label ("Back Pad"); the catalog is keyed by slug ("back-pad"). So we build
 * the field list from the legacy options first and only ENRICH it from the
 * catalog, matching on the slug of each. Catalog-only fields are appended
 * using the catalog key, which is correct because no legacy value can exist
 * for a field the legacy machine never had.
 */

import type { Machine, ClientMachineSetting, ClientMachineStat, ExerciseLog, WorkoutSession } from "../../types";
import type { MachineCatalogEntry, MachineSettingField } from "../../types/machines";
import { MACHINE_DATABASE } from "../../data/machine-database";
import { toIsoDay } from "../../lib/client-rollups";
import { tutOf } from "../clinical-review/facts";
import {
  EquipmentMachine,
  EquipmentRegion,
  EquipmentSummary,
  MachineGuide,
  MachineUsage,
  REGION_LABELS,
  REGION_ORDER,
  RegionCount,
  SettingFieldSpec,
} from "./types";

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

/** "Back Pad" and "back-pad" must collide. This is how. */
export const slug = (s: string): string =>
  String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/**
 * Dials that are identical for every client on a machine, so pre-filling them
 * is a fact rather than a guess. Keep this list short and evidence-based —
 * everything NOT here stays a ghost the trainer has to confirm.
 */
const ABSOLUTE_STANDARDS: Record<string, string> = {
  gap: "0",
};

export function absoluteStandardFor(key: string, label: string): string | undefined {
  return ABSOLUTE_STANDARDS[slug(key)] ?? ABSOLUTE_STANDARDS[slug(label)];
}

/** MACHINE_DATABASE authors free-text categories; the summary needs five buckets. */
export function regionOf(category?: string | null, machineName?: string): EquipmentRegion {
  const c = (category || "").toLowerCase();
  if (c.includes("cervical") || c.includes("neck")) return "neck";
  if (c.includes("core") || c.includes("trunk") || c.includes("spine")) return "core";
  if (c.includes("lower") || c.includes("hip") || c.includes("leg")) return "lower";
  if (c.includes("upper") || c.includes("chest") || c.includes("back") || c.includes("shoulder") || c.includes("arm"))
    return "upper";

  // No category on the doc — fall back to the name so a custom studio machine
  // still lands somewhere sensible instead of inflating "Other".
  const n = (machineName || "").toLowerCase();
  if (/neck|cervical/.test(n)) return "neck";
  if (/abdominal|torso|lumbar|core|oblique/.test(n)) return "core";
  if (/leg|hip|glute|calf|quad|hamstring|adduction|abduction/.test(n)) return "lower";
  if (/chest|press|row|pull|curl|tricep|bicep|lateral|delt|shoulder|dip|pec/.test(n)) return "upper";
  return "other";
}

const asNumber = (v: unknown): number | null => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/* ------------------------------------------------------------------ *
 * Setting fields
 * ------------------------------------------------------------------ */

function specFromCatalogField(f: MachineSettingField, ghost: string | null): SettingFieldSpec {
  const absoluteValue = absoluteStandardFor(f.key, f.label);
  return {
    key: f.key,
    label: f.label,
    type: f.type,
    options: f.options,
    min: f.min,
    max: f.max,
    step: f.step,
    ghost,
    helpText: f.helpText,
    absolute: absoluteValue !== undefined,
    absoluteValue,
  };
}

/**
 * Build the dial list for one machine.
 *
 * `studioStandards` is the resolved default for THIS studio — the studio
 * roster override if there is one, else the machine's own standardSettings,
 * else the catalog's defaultSettings. It is only ever used as a ghost.
 */
export function buildFields(
  machine: Machine,
  catalog: MachineCatalogEntry | undefined,
  studioStandards: Record<string, string>,
): SettingFieldSpec[] {
  const catalogBySlug = new Map<string, MachineSettingField>();
  for (const f of catalog?.settingFields || []) catalogBySlug.set(slug(f.key), f);

  const ghostFor = (...candidates: string[]): string | null => {
    for (const c of candidates) {
      if (studioStandards[c] !== undefined && studioStandards[c] !== "") return String(studioStandards[c]);
    }
    // Studio standards are keyed inconsistently across legacy docs; try slugs.
    const wanted = new Set(candidates.map(slug));
    for (const [k, v] of Object.entries(studioStandards)) {
      if (wanted.has(slug(k)) && v !== undefined && v !== "") return String(v);
    }
    for (const c of candidates) {
      const d = catalog?.defaultSettings?.[c];
      if (d) return String(d);
    }
    return null;
  };

  const fields: SettingFieldSpec[] = [];
  const used = new Set<string>();

  // 1. Legacy options first — these own the storage keys.
  for (const label of machine.settingOptions || []) {
    const s = slug(label);
    used.add(s);
    const cf = catalogBySlug.get(s);
    const ghost = ghostFor(label, cf?.key || label);
    if (cf) {
      // Catalog metadata, legacy storage key.
      fields.push({ ...specFromCatalogField(cf, ghost), key: label, label: cf.label || label });
    } else {
      const absoluteValue = absoluteStandardFor(label, label);
      fields.push({
        key: label,
        label,
        type: "text",
        ghost,
        absolute: absoluteValue !== undefined,
        absoluteValue,
      });
    }
  }

  // 2. Catalog-only fields. No legacy value can exist for these, so the
  //    catalog key is safe.
  for (const f of catalog?.settingFields || []) {
    if (used.has(slug(f.key))) continue;
    fields.push(specFromCatalogField(f, ghostFor(f.key, f.label)));
  }

  return fields;
}

/* ------------------------------------------------------------------ *
 * Setup guide
 * ------------------------------------------------------------------ */

export function buildGuide(
  machine: Machine,
  catalog: MachineCatalogEntry | undefined,
): MachineGuide | null {
  const kb = machine.id ? MACHINE_DATABASE[machine.id] : undefined;

  const setupCues = kb?.setupCues || [];
  const executionCues = kb?.executionCues || catalog?.execution?.keyCues || [];
  const clinicalWarnings = kb?.clinicalWarnings || catalog?.clinicalWarnings || [];
  const setupSummary = kb?.setup || machine.settings || null;
  const executionSummary = kb?.execution || catalog?.execution?.cadenceNotes || null;

  const empty =
    !setupCues.length &&
    !executionCues.length &&
    !clinicalWarnings.length &&
    !setupSummary &&
    !executionSummary;
  if (empty) return null;

  return {
    setupSummary,
    executionSummary,
    setupCues,
    executionCues,
    clinicalWarnings,
    target: kb?.target || catalog?.musculature?.primary?.join(", ") || null,
    posture: kb?.executionPosture || machine.executionPosture || catalog?.executionPosture || null,
    requiresHandoff: Boolean(kb?.requiresHandoff ?? machine.requiresHandoff ?? catalog?.execution?.requiresHandoff),
    imageUrl: machine.imageUrl || kb?.imageUrl || catalog?.imageUrl,
  };
}

/* ------------------------------------------------------------------ *
 * Usage — first performed, times performed, progression
 * ------------------------------------------------------------------ */

export const NO_USAGE: MachineUsage = {
  firstPerformed: null,
  lastPerformed: null,
  timesPerformed: 0,
  firstWeight: null,
  lastWeight: null,
  progressionPct: null,
  averageTutSeconds: null,
  tutSamples: 0,
  partial: false,
};

/**
 * Mean seconds under tension per set on one machine.
 *
 * Uses `tutOf` rather than a second reading of the same fields. A set's time
 * is recorded under several names depending on how it was performed and which
 * round of the tracker wrote it — totalTimeUnderLoad, seconds for a TSC or
 * static hold, averageTimePerRep x reps, machineDurationSeconds — and having
 * two functions decide what a set's TUT is would guarantee that the Equipment
 * tab and the Clinical Review eventually disagree about the same set.
 */
export function averageTut(
  machineId: string,
  logs: ExerciseLog[],
): { averageTutSeconds: number | null; tutSamples: number } {
  let total = 0;
  let n = 0;
  for (const log of logs) {
    if (log.machineId !== machineId) continue;
    const tut = tutOf(log);
    if (tut === null || tut <= 0) continue;
    total += tut;
    n += 1;
  }
  return n === 0
    ? { averageTutSeconds: null, tutSamples: 0 }
    : { averageTutSeconds: Math.round(total / n), tutSamples: n };
}

/** Percent change from the first load ever performed to the load in use now. */
export function progressionPct(first: number | null, current: number | null): number | null {
  if (first === null || current === null || first <= 0) return null;
  return Math.round(((current - first) / first) * 100);
}

/**
 * Lifetime usage from the persisted rollup. `current` is the prescribed
 * current weight, which wins over the last performed load for the
 * progression figure because it is what the client will lift next.
 */
export function usageFromStats(stat: ClientMachineStat | undefined, current: number | null): MachineUsage {
  if (!stat) return NO_USAGE;
  const firstWeight = asNumber(stat.firstWeight);
  const lastWeight = asNumber(stat.lastWeight);
  return {
    firstPerformed: stat.firstPerformedDate || null,
    lastPerformed: stat.lastPerformedDate || null,
    timesPerformed: asNumber(stat.timesPerformed) ?? 0,
    firstWeight,
    lastWeight,
    progressionPct: progressionPct(firstWeight, current ?? lastWeight),
    averageTutSeconds: null,
    tutSamples: 0,
    partial: false,
  };
}

/**
 * The same figures reconstructed from the sessions the profile has loaded —
 * the last page of history, not the lifetime — for clients whose rollup has
 * not been backfilled yet. Always `partial`, so the UI can say "from the
 * loaded sessions" rather than pass it off as the whole story.
 */
export function usageFromLogs(
  machineId: string,
  logs: ExerciseLog[],
  sessions: WorkoutSession[],
  current: number | null,
): MachineUsage {
  const dayOf = new Map<string, string>();
  for (const s of sessions) if (s.id && s.date) dayOf.set(s.id, toIsoDay(s.date));

  let first: { day: string; weight: number | null } | null = null;
  let last: { day: string; weight: number | null } | null = null;
  const sessionIds = new Set<string>();
  for (const log of logs) {
    if (log.machineId !== machineId || !log.sessionId) continue;
    sessionIds.add(log.sessionId);
    const day = dayOf.get(log.sessionId);
    if (!day) continue;
    const weight = asNumber(log.weight ?? log.loadLb);
    if (!first || day < first.day) first = { day, weight };
    if (!last || day > last.day) last = { day, weight };
  }
  if (sessionIds.size === 0) return { ...NO_USAGE, partial: true };
  return {
    firstPerformed: first?.day ?? null,
    lastPerformed: last?.day ?? null,
    timesPerformed: sessionIds.size,
    firstWeight: first?.weight ?? null,
    lastWeight: last?.weight ?? null,
    progressionPct: progressionPct(first?.weight ?? null, current ?? last?.weight ?? null),
    averageTutSeconds: null,
    tutSamples: 0,
    partial: true,
  };
}

/* ------------------------------------------------------------------ *
 * The main adapter
 * ------------------------------------------------------------------ */

export interface ToEquipmentMachinesArgs {
  machines: Machine[];
  clientSettings: Record<string, ClientMachineSetting>;
  allLogs: ExerciseLog[];
  catalogById: Record<string, MachineCatalogEntry>;
  /** activeStudio.machineSettings — per-studio standard overrides, if any. */
  studioMachineSettings?: Record<string, Record<string, string>>;
  /**
   * `client.machineStats` once the lifetime rollup exists. When absent (or
   * not yet backfilled) usage is rebuilt from `allLogs` + `sessions` and
   * marked partial.
   */
  machineStats?: Record<string, ClientMachineStat> | null;
  /** The sessions `allLogs` belong to — needed only for the partial fallback. */
  sessions?: WorkoutSession[];
}

export function toEquipmentMachines({
  machines,
  clientSettings,
  allLogs,
  catalogById,
  studioMachineSettings,
  machineStats,
  sessions = [],
}: ToEquipmentMachinesArgs): EquipmentMachine[] {
  const logCounts = new Map<string, number>();
  for (const log of allLogs || []) {
    if (!log?.machineId) continue;
    logCounts.set(log.machineId, (logCounts.get(log.machineId) || 0) + 1);
  }

  const out: EquipmentMachine[] = [];

  for (const machine of machines || []) {
    const id = machine.id;
    if (!id) continue;

    const kb = MACHINE_DATABASE[id];
    const catalog = catalogById[id];
    const setting = clientSettings?.[id];

    const studioStandards =
      studioMachineSettings?.[id] || machine.standardSettings || catalog?.defaultSettings || {};

    const settings = setting?.settings || {};
    const notes = setting?.machineNotes || [];
    const startingWeight = asNumber(setting?.startingWeight);
    const currentWeight = asNumber(setting?.currentWeight);
    const loggedSetCount = logCounts.get(id) || 0;
    const isConfigured = Object.keys(settings).length > 0;
    /* Time under tension always comes from the logs, whichever way the rest
       of the usage figures were built — the lifetime rollup has no notion of
       it. Merged in after, so both paths report it. */
    const usage: MachineUsage = {
      ...(machineStats
        ? usageFromStats(machineStats[id], currentWeight)
        : usageFromLogs(id, allLogs || [], sessions, currentWeight)),
      ...averageTut(id, allLogs || []),
    };

    out.push({
      id,
      name: machine.fullName || machine.name,
      order: Number(machine.order ?? 999),
      kinematic: machine.kinematicClassification || kb?.kinematicClassification || catalog?.kinematicClassification || null,
      category: kb?.category || machine.anatomicalRegion || catalog?.anatomicalRegion || null,
      region: regionOf(kb?.category || machine.anatomicalRegion || catalog?.anatomicalRegion, machine.name),
      fields: buildFields(machine, catalog, studioStandards),
      guide: buildGuide(machine, catalog),
      baselineLoad: {
        male: kb?.baseMale ?? catalog?.baselineLoad?.male ?? 50,
        female: kb?.baseFemale ?? catalog?.baselineLoad?.female ?? 50,
      },
      standardWeights: machine.standardWeights,
      startingWeight,
      currentWeight,
      settings,
      notes,
      hasMaintenanceFlag: notes.some((n) => n?.isImportant),
      loggedSetCount,
      usage,
      inUse: startingWeight !== null || currentWeight !== null || isConfigured || loggedSetCount > 0 || usage.timesPerformed > 0,
      isConfigured,
    });
  }

  // The existing concurrent sort, unchanged: machines the client trains on
  // first, then studio display order. The rail renders the boundary as a
  // section header so it stops looking accidental.
  out.sort((a, b) => {
    if (a.inUse !== b.inUse) return a.inUse ? -1 : 1;
    return a.order - b.order || a.name.localeCompare(b.name);
  });

  return out;
}

/* ------------------------------------------------------------------ *
 * Summary sentence
 * ------------------------------------------------------------------ */

export function summarise(machines: EquipmentMachine[]): EquipmentSummary {
  const counts = new Map<EquipmentRegion, number>();
  let inUse = 0;

  for (const m of machines) {
    if (!m.inUse) continue;
    inUse += 1;
    counts.set(m.region, (counts.get(m.region) || 0) + 1);
  }

  const byRegion: RegionCount[] = REGION_ORDER.filter((r) => counts.get(r)).map((region) => ({
    region,
    label: REGION_LABELS[region],
    count: counts.get(region) || 0,
  }));

  return { total: machines.length, inUse, byRegion };
}

/**
 * Suggested starting load, same precedence the old tab used: studio standard
 * for the client's experience level, then the machine's own standard, then a
 * multiple of the catalog baseline.
 */
export function suggestedWeight(
  machine: EquipmentMachine,
  experienceLevel: string | undefined,
  gender: string | undefined,
  studioMachineSettings?: Record<string, Record<string, string>>,
): number {
  const level = experienceLevel || "Beginner";
  const levelKey = "weight" + level.charAt(0).toUpperCase() + level.slice(1);

  const studioWeight = studioMachineSettings?.[machine.id]?.[levelKey];
  if (studioWeight) return Number(studioWeight);

  const own = machine.standardWeights?.[level as keyof NonNullable<EquipmentMachine["standardWeights"]>];
  if (own) return Number(own);

  const isFemale = (gender || "").toLowerCase() === "female";
  const base = isFemale ? machine.baselineLoad.female : machine.baselineLoad.male;
  if (level === "Beginner") return Math.round(base * 0.8);
  if (level === "Advanced") return Math.round(base * 1.5);
  return base;
}
