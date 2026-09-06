import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The colour budget, enforced.
 *
 * v6 put rep quality on GREEN and RED — the one pair a protanope or
 * deuteranope cannot separate. That is a cost taken knowingly, and it is
 * paid for by two non-colour channels (the ★/◯ shape and the poor cell's
 * hatch) plus contrast that never drops below AA anywhere.
 *
 * The README used to carry those ratios as a table someone typed by hand.
 * A hand-typed table is a claim; this is a check. Every pairing below is
 * computed from the ACTUAL token file, in both themes, and again with the
 * row-banding overlay on top — because half the rows in the grid are
 * banded, and a pairing that only clears AA on unbanded rows clears it
 * half the time.
 *
 * If you retune a token and this fails, the fix is the token, not the test.
 */

const TOKENS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "journey-grid.tokens.css"),
  "utf8",
);

/** Pull one `:root`-style block's custom properties out of the token file. */
function readBlock(selector: string): Record<string, string> {
  const i = TOKENS.indexOf(selector);
  if (i < 0) throw new Error(`token block not found: ${selector}`);
  const open = TOKENS.indexOf("{", i);
  const close = TOKENS.indexOf("\n}", open);
  const body = TOKENS.slice(open, close);
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    out[m[1]] = m[2].trim();
  }
  return out;
}

/** Resolve `var(--x)` chains, then require a literal #rrggbb. */
function hex(vars: Record<string, string>, name: string, depth = 0): string {
  const v = vars[name];
  if (v === undefined) throw new Error(`missing token ${name}`);
  const ref = /^var\((--[\w-]+)\)$/.exec(v);
  if (ref) {
    if (depth > 4) throw new Error(`var() cycle at ${name}`);
    return hex(vars, ref[1], depth + 1);
  }
  if (!/^#[0-9a-f]{6}$/i.test(v)) throw new Error(`${name} is not a hex colour: ${v}`);
  return v;
}

const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function luminance(h: string): number {
  const n = parseInt(h.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => channel(c / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The banding overlay, composited the way the browser will composite it. */
function band(over: string, base: string, alpha: number): string {
  const [o, b] = [parseInt(over.slice(1), 16), parseInt(base.slice(1), 16)];
  const mix = (s: number) =>
    Math.round((((o >> s) & 255) * alpha + ((b >> s) & 255) * (1 - alpha)));
  return `#${[16, 8, 0].map((s) => mix(s).toString(16).padStart(2, "0")).join("")}`;
}

/** WCAG 2.1: 4.5:1 for text under 18pt, 3:1 for non-text UI. */
const TEXT = 4.5;
const UI = 3;

const PAIRINGS: Array<[string, string, string, number]> = [
  // fg token, bg token, what it is, floor
  ["--jg-ink", "--jg-q-max-fill", "weight on a max-strength cell", TEXT],
  ["--jg-ink", "--jg-q-poor-fill", "weight on a needs-work cell", TEXT],
  ["--jg-ink", "--jg-q-done-fill", "weight on a completed cell", TEXT],
  ["--jg-ink-2", "--jg-q-max-fill", "reps on a max-strength cell", TEXT],
  ["--jg-ink-2", "--jg-q-poor-fill", "reps on a needs-work cell", TEXT],
  ["--jg-ink-2", "--jg-q-done-fill", "reps on a completed cell", TEXT],
  ["--jg-delta-up", "--jg-q-max-fill", "blue load delta on a max cell", TEXT],
  ["--jg-delta-up", "--jg-q-poor-fill", "blue load delta on a needs-work cell", TEXT],
  ["--jg-delta-up", "--jg-q-done-fill", "blue load delta on a completed cell", TEXT],
  ["--jg-delta-up", "--jg-surface", "blue load delta on an unrated cell", TEXT],
  ["--jg-q-max-text", "--jg-q-max-fill", "max-strength accent text", TEXT],
  ["--jg-q-poor-text", "--jg-q-poor-fill", "needs-work accent text", TEXT],
  // Non-text: the two marks that carry quality when colour cannot.
  ["--jg-q-star", "--jg-q-max-fill", "the gold star", UI],
  ["--jg-q-poor", "--jg-q-poor-fill", "the red kaizen ring", UI],
  ["--jg-q-max-edge", "--jg-surface", "the max-strength cell edge", UI],
  ["--jg-hero", "--jg-surface", "the focus row trace", UI],
];

describe.each([
  ["light", ":root {", "--jg-ink", 0.035],
  ["dark", ".dark,", "--jg-ink", 0.045],
])("%s theme", (_theme, selector, bandInk, bandAlpha) => {
  const light = readBlock(":root {");
  // The dark block only overrides; anything it does not restate is inherited.
  const vars = selector === ":root {" ? light : { ...light, ...readBlock(selector) };

  it.each(PAIRINGS)("%s on %s — %s clears %s:1", (fg, bg, _what, floor) => {
    expect(ratio(hex(vars, fg), hex(vars, bg))).toBeGreaterThanOrEqual(floor);
  });

  // Half the rows in the grid carry the banding overlay. A pairing that only
  // clears AA on unbanded rows clears it every other row.
  it.each(PAIRINGS)("%s on %s — %s clears %s:1 on a BANDED row", (fg, bg, _what, floor) => {
    const banded = band(hex(vars, bandInk), hex(vars, bg), bandAlpha);
    expect(ratio(hex(vars, fg), banded)).toBeGreaterThanOrEqual(floor);
  });

  it("keeps the three quality fills separable with no colour at all", () => {
    // The one this caught for real: the first cut of the v6 palette put the
    // green max fill 0.002 luminance from the grey completed fill. In
    // greyscale, at distance, or for a trainer with achromatopsia, "max
    // strength" and "ordinary set" were the same cell -- while the whole
    // point of v6 is that the fill is what you read at a glance.
    //
    // A ratio, not an absolute difference: dark-mode fills all sit within
    // 0.05 luminance of black, so an absolute threshold means something
    // completely different in the two themes.
    const fills = ["--jg-q-max-fill", "--jg-q-poor-fill", "--jg-q-done-fill"];
    for (let i = 0; i < fills.length; i++) {
      for (let j = i + 1; j < fills.length; j++) {
        expect(ratio(hex(vars, fills[i]), hex(vars, fills[j]))).toBeGreaterThanOrEqual(1.15);
      }
    }
  });
});
