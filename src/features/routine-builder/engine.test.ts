/**
 * The doctrine, as executable assertions.
 *
 * These tests exist so that a future edit to academy.ts cannot quietly change
 * what the app tells a trainer. Each block names the Academy document it is
 * defending; if a test fails, either the code drifted or the doctrine changed,
 * and both need a human before the test is edited.
 */

import { describe, expect, it } from "vitest";
import {
  BIG_FIVE,
  EXERCISE_COUNT,
  FOUNDATIONAL_CATEGORIES,
  MACHINE_ABBR,
  MACHINE_CATEGORY,
  MODEL_AB_ROUTINE,
  SELECTION_TEMPLATES,
  asAcademyString,
  matchTemplates,
  preferenceFromGender,
} from "./academy";
import {
  analyzeRotation,
  analyzeRoutine,
  autoSequence,
  findViolations,
  resolveRoutineAnatomy,
  substitutesFor,
  suggestMachines,
} from "./engine";
import { MACHINE_ANATOMY } from "../../data/machine-anatomy-map";

const ALL = Object.keys(MACHINE_CATEGORY);

describe("data integrity", () => {
  it("every categorised machine has anatomy, and vice versa", () => {
    for (const id of ALL) {
      expect(MACHINE_ANATOMY[id], `${id} missing from MACHINE_ANATOMY`).toBeDefined();
    }
    const anatomyIds = Object.keys(MACHINE_ANATOMY).filter((k) => k.startsWith("m-"));
    for (const id of anatomyIds) {
      expect(MACHINE_CATEGORY[id], `${id} has no Academy category`).toBeDefined();
    }
  });

  it("every machine has an Academy abbreviation", () => {
    for (const id of ALL) expect(MACHINE_ABBR[id], `${id} has no abbreviation`).toBeTruthy();
  });

  it("the Big 5 is one movement from each of the five patterns named in the doctrine", () => {
    expect(BIG_FIVE).toHaveLength(5);
    expect(BIG_FIVE).toContain("m-chest-press"); // horizontal push
    expect(BIG_FIVE).toContain("m-compound-row"); // horizontal pull
    expect(BIG_FIVE).toContain("m-overhead-press"); // vertical push
    expect(BIG_FIVE).toContain("m-pulldown"); // vertical pull
    expect(BIG_FIVE).toContain("m-leg-press");
  });

  it("every selection template runs seven exercises in its eventual A and B", () => {
    // "most of the workouts were constructed with 7 exercises"
    for (const t of SELECTION_TEMPLATES) {
      expect(t.eventualA, `${t.id} A`).toHaveLength(EXERCISE_COUNT.target);
      expect(t.eventualB, `${t.id} B`).toHaveLength(EXERCISE_COUNT.target);
    }
  });

  it("no selection template repeats a machine within one routine", () => {
    for (const t of SELECTION_TEMPLATES) {
      expect(new Set(t.eventualA).size, `${t.id} A has a duplicate`).toBe(t.eventualA.length);
      expect(new Set(t.eventualB).size, `${t.id} B has a duplicate`).toBe(t.eventualB.length);
    }
  });

  it("every selection template covers all three foundational categories in each routine", () => {
    for (const t of SELECTION_TEMPLATES) {
      for (const routine of [t.eventualA, t.eventualB]) {
        const cats = new Set(routine.map((m) => MACHINE_CATEGORY[m]));
        for (const f of FOUNDATIONAL_CATEGORIES) {
          expect(cats.has(f), `${t.id} is missing ${f}`).toBe(true);
        }
      }
    }
  });

  it("the model A/B routine splits Lumbar and Leg Press across the rotation", () => {
    for (const pref of ["female", "male", "neutral"] as const) {
      const { a, b } = MODEL_AB_ROUTINE[pref];
      expect(a.includes("m-leg-press") && a.includes("m-lumbar"), pref).toBe(false);
      expect(b.includes("m-leg-press") && b.includes("m-lumbar"), pref).toBe(false);
    }
  });

  it("the model A/B routine is the female row of the selection template", () => {
    // The two documents must agree; they were written to.
    const template = SELECTION_TEMPLATES.find((t) => t.id === "clear-female")!;
    expect([...template.eventualA].sort()).toEqual([...MODEL_AB_ROUTINE.female.a].sort());
    expect([...template.eventualB].sort()).toEqual([...MODEL_AB_ROUTINE.female.b].sort());
  });
});

describe("sequencing rules", () => {
  it("flags a push straight into another push", () => {
    // Chest Flye into Chest Press is the doctrine's own worked example.
    const v = findViolations(["m-chest-fly", "m-chest-press", "m-leg-press"]);
    expect(v.some((x) => x.severity === "avoid" && x.indices[0] === 0)).toBe(true);
  });

  it("flags a pull straight into another pull", () => {
    const v = findViolations(["m-compound-row", "m-pulldown", "m-leg-press"]);
    expect(v.some((x) => x.severity === "avoid")).toBe(true);
  });

  it("explains Pulldown next to Compound Row with the grip reason, not generic prefatigue", () => {
    const v = findViolations(["m-pulldown", "m-compound-row"]);
    expect(v[0].ruleId).toBe("grip-pd-cr");
    expect(v[0].why).toMatch(/grip/i);
  });

  it("flags Lumbar directly into Leg Press but not the reverse", () => {
    expect(findViolations(["m-lumbar", "m-leg-press"]).some((v) => v.ruleId === "lumbar-into-leg-press")).toBe(true);
    expect(findViolations(["m-leg-press", "m-lumbar"]).some((v) => v.ruleId === "lumbar-into-leg-press")).toBe(false);
  });

  it("flags a quad movement directly into Lumbar or Abdominals", () => {
    expect(findViolations(["m-leg-press", "m-lumbar"]).some((v) => v.ruleId === "quad-into-trunk")).toBe(true);
    expect(findViolations(["m-ext", "m-abs"]).some((v) => v.ruleId === "quad-into-trunk")).toBe(true);
  });

  it("raises Leg Extension + Leg Press as a same-session caution that escalates", () => {
    const v = findViolations(["m-ext", "m-compound-row", "m-leg-press"]);
    const rule = v.find((x) => x.ruleId === "le-with-lp");
    expect(rule?.severity).toBe("caution");
    expect(rule?.escalate).toMatch(/Studio Leader/i);
  });

  it("does not fire prefatigue across body regions", () => {
    // Leg Press and Chest Press are both 'push' but share no fibres.
    const v = findViolations(["m-leg-press", "m-chest-press"]);
    expect(v.some((x) => x.ruleId.startsWith("prefatigue"))).toBe(false);
  });

  it("reports each adjacent pair once, with its most specific reason", () => {
    const v = findViolations(["m-pulldown", "m-compound-row"]);
    const adjacent = v.filter((x) => x.scope === "adjacent");
    expect(adjacent).toHaveLength(1);
  });

  it("a clean seven-exercise routine raises nothing at avoid severity", () => {
    const analysis = analyzeRoutine(MODEL_AB_ROUTINE.female.a);
    const avoid = analysis.violations.filter((v) => v.severity === "avoid");
    expect(avoid.map((v) => `${v.ruleId} @${v.indices}`)).toEqual([]);
    expect(analysis.clean).toBe(true);
  });
});

describe("auto-sequencing", () => {
  it("clears an avoidable adjacency", () => {
    const before = ["m-chest-press", "m-chest-fly", "m-leg-press", "m-compound-row"];
    expect(findViolations(before).some((v) => v.severity === "avoid")).toBe(true);
    const after = autoSequence(before);
    expect(findViolations(after).some((v) => v.severity === "avoid")).toBe(false);
  });

  it("keeps every machine, changing only the order", () => {
    const before = ["m-lumbar", "m-leg-press", "m-compound-row", "m-pulldown", "m-abs"];
    const after = autoSequence(before);
    expect([...after].sort()).toEqual([...before].sort());
  });

  it("leaves an already-valid routine untouched", () => {
    const good = MODEL_AB_ROUTINE.male.b;
    expect(autoSequence(good)).toEqual([...good]);
  });

  it("terminates on a routine that cannot be fully resolved", () => {
    // Nothing but pushes: some adjacency must survive.
    const impossible = ["m-chest-press", "m-chest-fly", "m-dip", "m-overhead-press"];
    const after = autoSequence(impossible);
    expect(after).toHaveLength(4);
  });
});

describe("one-tap fixes", () => {
  it("offers to move Abdominals ahead of Lumbar, not the other way round", () => {
    const ids = ["m-compound-row", "m-lumbar", "m-leg-press", "m-abs"];
    const v = findViolations(ids).find((x) => x.ruleId === "lumbar-with-abs");
    expect(v).toBeDefined();
    const fix = v!.fixes.find((f) => /before/i.test(f.label));
    expect(fix).toBeDefined();
    const next = fix!.apply(ids);
    expect(next.indexOf("m-abs")).toBeLessThan(next.indexOf("m-lumbar"));
  });

  it("offers the documented Leg Press → Leg Extension swap for Lumbar", () => {
    const ids = ["m-lumbar", "m-leg-press"];
    const v = findViolations(ids).find((x) => x.ruleId === "lumbar-into-leg-press")!;
    const swap = v.fixes.find((f) => /Leg Extension|LE/i.test(f.label));
    expect(swap).toBeDefined();
    expect(swap!.apply(ids)).toEqual(["m-lumbar", "m-ext"]);
  });

  it("every offered fix actually reduces the problem it was offered for", () => {
    const cases = [
      ["m-chest-fly", "m-chest-press", "m-leg-press", "m-compound-row"],
      ["m-compound-row", "m-pulldown", "m-leg-press", "m-abs"],
      ["m-lumbar", "m-leg-curl", "m-compound-row", "m-chest-press"],
    ];
    for (const ids of cases) {
      const before = findViolations(ids).filter((v) => v.severity === "avoid").length;
      for (const v of findViolations(ids)) {
        for (const fix of v.fixes) {
          const after = findViolations(fix.apply(ids)).filter((x) => x.severity === "avoid").length;
          expect(after, `${v.ruleId} / ${fix.label}`).toBeLessThanOrEqual(before);
        }
      }
    }
  });

  it("a fix never drops or duplicates a machine", () => {
    const ids = ["m-lumbar", "m-leg-press", "m-compound-row", "m-pulldown", "m-abs", "m-chest-press"];
    for (const v of findViolations(ids)) {
      for (const fix of v.fixes) {
        const next = fix.apply(ids);
        if (/^Swap /.test(fix.label)) continue; // a swap is meant to change the set
        expect([...next].sort(), fix.label).toEqual([...ids].sort());
      }
    }
  });
});

describe("coverage", () => {
  it("names the foundational category a routine is missing", () => {
    const analysis = analyzeRoutine(["m-leg-press", "m-compound-row", "m-lumbar"]);
    expect(analysis.missingFoundational).toEqual(["upper-push"]);
  });

  it("the Big 5 covers all three foundational categories", () => {
    const analysis = analyzeRoutine([...BIG_FIVE]);
    expect(analysis.missingFoundational).toEqual([]);
  });

  it("calls seven the target", () => {
    const analysis = analyzeRoutine(MODEL_AB_ROUTINE.neutral.a);
    expect(analysis.countAdvice?.tone).toBe("ok");
  });

  it("warns past nine exercises", () => {
    const ten = [...MODEL_AB_ROUTINE.neutral.a, "m-bicep", "m-tricep-ext", "m-neck"];
    expect(analyzeRoutine(ten).countAdvice?.tone).toBe("heavy");
  });

  it("only calls a routine thin for an established client", () => {
    const three = ["m-leg-press", "m-compound-row", "m-lumbar"];
    expect(analyzeRoutine(three).countAdvice).toBeNull();
    expect(analyzeRoutine(three, { established: true })?.countAdvice?.tone).toBe("thin");
  });
});

describe("anatomy union", () => {
  it("promotes a muscle to primary if any machine targets it primarily", () => {
    // Pullover is primary lats; Compound Row lists lats primary too.
    const a = resolveRoutineAnatomy(["m-pullover", "m-bicep"]);
    expect(a.primary).toContain("lats");
    expect(a.secondary).not.toContain("lats");
  });

  it("never lists the same region as both primary and secondary", () => {
    const a = resolveRoutineAnatomy(MODEL_AB_ROUTINE.female.a);
    for (const m of a.secondary) expect(a.primary).not.toContain(m);
  });

  it("records which machines drove each highlight", () => {
    const a = resolveRoutineAnatomy(["m-leg-press", "m-ext"]);
    expect(a.primaryHits.quads).toContain("m-leg-press");
    expect(a.primaryHits.quads).toContain("m-ext");
  });

  it("reports machines it cannot map rather than silently ignoring them", () => {
    const a = resolveRoutineAnatomy(["m-leg-press", "sm-studio1-custom-sled"]);
    expect(a.unmapped).toEqual(["sm-studio1-custom-sled"]);
  });
});

describe("rotation analysis — the twice-weekly rule", () => {
  it("clears the two overlaps the model A/B routine was designed around", () => {
    // The document's own worked examples: the upper back is covered by
    // CR + PO in A and SR + Pd in B; the lower body by LP in A and
    // LE + ABD + Lumb in B. Both must come back with no gap.
    const r = analyzeRotation(MODEL_AB_ROUTINE.female.a, MODEL_AB_ROUTINE.female.b);
    const gaps = r.underDosed.map((g) => g.muscle);
    for (const m of ["lats", "rhomboids", "traps", "quads", "glutes", "adductors"] as const) {
      expect(gaps, `${m} should be covered in both routines`).not.toContain(m);
    }
    expect(r.overlap).toBeGreaterThanOrEqual(0.85);
  });

  it("still reports the model routine's one real once-weekly region", () => {
    // Torso Rotation sits in A with nothing in B reaching the obliques. The
    // document does not claim otherwise — it says an eighth or ninth exercise
    // can be added and that "key exercises should be repeated in the A and B".
    // Surfacing this is the feature working, not a false positive.
    const r = analyzeRotation(MODEL_AB_ROUTINE.female.a, MODEL_AB_ROUTINE.female.b);
    expect(r.underDosed.map((g) => g.muscle)).toEqual(["obliques"]);
  });

  it("catches the doctrine's own counter-example: pecs in A, neglected in B", () => {
    const a = ["m-chest-press", "m-compound-row", "m-leg-press"];
    const b = ["m-pulldown", "m-leg-curl", "m-hip-abd"];
    const r = analyzeRotation(a, b);
    expect(r.underDosed.map((g) => g.muscle)).toContain("pecs");
    expect(r.underDosed.find((g) => g.muscle === "pecs")?.machineIds).toContain("m-chest-press");
  });

  it("accepts secondary coverage in the counterpart as adequate frequency", () => {
    // Compound Row (biceps secondary) in A, Pulldown (biceps secondary) in B —
    // the document treats this pairing as sufficient.
    const r = analyzeRotation(["m-compound-row"], ["m-pulldown"]);
    expect(r.underDosed.map((g) => g.muscle)).not.toContain("biceps");
  });

  it("reports categories missing from both halves of the rotation", () => {
    const r = analyzeRotation(["m-leg-press", "m-compound-row"], ["m-chest-press", "m-ext"]);
    expect(r.missingAcrossRotation).toContain("trunk");
    expect(r.missingAcrossRotation).toContain("hips");
  });

  it("recognises the Lumbar / Leg Press split", () => {
    expect(analyzeRotation(MODEL_AB_ROUTINE.male.a, MODEL_AB_ROUTINE.male.b).lumbarLegPressSplit).toBe(true);
    expect(analyzeRotation(["m-lumbar", "m-leg-press"], []).lumbarLegPressSplit).toBe(false);
  });
});

describe("suggestions", () => {
  const available = ALL;

  it("puts a missing foundational category first", () => {
    const s = suggestMachines({ machineIds: ["m-leg-press", "m-compound-row"], available });
    expect(s[0].reasons[0].kind).toBe("foundational-gap");
    expect(MACHINE_CATEGORY[s[0].machineId]).toBe("upper-push");
  });

  it("in B mode, prioritises what A trains and B does not", () => {
    const a = ["m-chest-press", "m-compound-row", "m-leg-press", "m-lumbar"];
    const s = suggestMachines({
      machineIds: ["m-pulldown", "m-leg-curl", "m-hip-abd"],
      counterpart: a,
      available,
      slot: "B",
    });
    const top = s.slice(0, 3).map((x) => x.machineId);
    // Something has to cover the chest, which A trains and B currently does not.
    expect(top.some((id) => id === "m-chest-press" || id === "m-chest-fly" || id === "m-dip")).toBe(true);
    expect(s[0].reasons.some((r) => r.kind === "frequency-gap")).toBe(true);
  });

  it("never suggests a machine the studio does not have", () => {
    const small = ["m-leg-press", "m-compound-row", "m-chest-press"];
    const s = suggestMachines({ machineIds: ["m-leg-press"], available: small });
    for (const x of s) expect(small).toContain(x.machineId);
  });

  it("never suggests something already in the routine", () => {
    const current = ["m-leg-press", "m-compound-row"];
    const s = suggestMachines({ machineIds: current, available });
    for (const x of s) expect(current).not.toContain(x.machineId);
  });

  it("marks a suggestion that would clash if appended at the end", () => {
    const s = suggestMachines({ machineIds: ["m-leg-press", "m-compound-row"], available });
    const pulling = s.find((x) => x.machineId === "m-pulldown" || x.machineId === "m-simple-row");
    if (pulling) expect(pulling.conflictsAtEnd).toBe(true);
  });

  it("surfaces the documented Lumbar + Leg Extension pairing", () => {
    const s = suggestMachines({
      machineIds: ["m-lumbar", "m-compound-row", "m-chest-press"],
      available,
      limit: 12,
    });
    const le = s.find((x) => x.machineId === "m-ext");
    expect(le?.reasons.some((r) => r.kind === "pair")).toBe(true);
  });

  it("weights a matched selection template", () => {
    const s = suggestMachines({
      machineIds: ["m-leg-press", "m-compound-row", "m-chest-press"],
      available,
      purposeText: "Client reports chronic low back pain from a disc issue",
      slot: "A",
      limit: 12,
    });
    expect(s.some((x) => x.reasons.some((r) => r.kind === "template"))).toBe(true);
  });

  it("gives every suggestion a reason a trainer can read", () => {
    const s = suggestMachines({ machineIds: ["m-leg-press"], available });
    for (const x of s) {
      expect(x.headline.length).toBeGreaterThan(10);
      expect(x.reasons.length).toBeGreaterThan(0);
    }
  });
});

describe("substitutes", () => {
  it("returns the documented replacements for Leg Press", () => {
    const subs = substitutesFor("m-leg-press", ALL);
    expect(subs.length).toBeGreaterThanOrEqual(4);
    expect(subs[0].machineIds).toEqual(["m-ext", "m-hip-abd", "m-lumbar"]);
  });

  it("marks a substitute unavailable when the studio lacks a machine in the set", () => {
    const subs = substitutesFor("m-chest-press", ["m-chest-fly", "m-dip"]);
    expect(subs.find((s) => s.machineIds.join() === "m-chest-fly,m-tricep-ext")?.availableHere).toBe(false);
    expect(subs.find((s) => s.machineIds.join() === "m-chest-fly,m-dip")?.availableHere).toBe(true);
  });

  it("resolves legacy ids before looking up", () => {
    expect(substitutesFor("leg_press", ALL).length).toBeGreaterThan(0);
  });
});

describe("template matching", () => {
  it("matches a condition from intake text", () => {
    expect(matchTemplates("history of rotator cuff surgery")[0].id).toBe("shoulder");
  });

  it("ranks a condition above a goal when both match", () => {
    const hits = matchTemplates("knee pain, wants to work on posture");
    expect(hits[0].kind).toBe("condition");
  });

  it("returns nothing for empty intake", () => {
    expect(matchTemplates("")).toEqual([]);
    expect(matchTemplates(null)).toEqual([]);
  });
});

describe("presentation helpers", () => {
  it("writes a routine the way the Academy writes it", () => {
    expect(asAcademyString(MODEL_AB_ROUTINE.female.a)).toBe("ADD, SD, CR, TR, OH, PO, LP");
  });

  it("maps client gender onto a model preference, tolerating dirty data", () => {
    expect(preferenceFromGender("Female")).toBe("female");
    expect(preferenceFromGender("M")).toBe("male");
    expect(preferenceFromGender("Other")).toBe("neutral");
    expect(preferenceFromGender(undefined)).toBe("neutral");
  });
});
