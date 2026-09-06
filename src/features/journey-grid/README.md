# Journey Grid

Design spec for `src/features/journey-grid/` — the sticky client-tracking grid used by the client profile Journey tab (`RecentJourneyView`) and the Active Session tracker (`WorkoutTrackerView` → `JourneyGrid` with a live column). Integrated Sep 3, 2026 on branch `journey-grid`.


Files: `src/features/journey-grid/`. Live prototype: the "Journey Grid" artifact (same code, compiled with Judy Daus's data).

**v6 (Sep 6) — one channel per meaning.** The grid was spending three colour
systems on two facts: a gold cell meant max strength, a green cell meant the
load went up, and arrows meant reps moved. Two of those painted the same
surface, so a trainer walking up to a machine could not read a row at a
glance — which is the only thing this grid exists to do.

Split, one channel per meaning:

- **Cell fill = rep quality, and nothing else.** Green (max) / red (needs
  improvement) / grey (completed). Nothing else in the grid paints a cell.
- **Cell text = load movement, and nothing else.** A blue signed number with
  a ▲/▼. The arrow is load-bearing: blue means "tappable" everywhere else in
  this grid, and a bare blue "+2" reads as a control.

The marks swapped with the colours. Max strength is a **gold star** — the one
shape nobody needs a legend for. "Needs improvement" is the **red kaizen
ring**, deliberately: kaizen is the circle you keep drawing and never finish,
so the mark says "there is a better rep tomorrow" where the old cross said
"this set failed". No client should open their journey to a wall of crosses.
The mark is redundant with the fill on purpose — green-vs-red is exactly the
pair a red-green colour-blind trainer cannot separate, so quality also
carries a shape (★ vs ◯) and a texture (flat vs hatched). Any one of the
three cues is enough on its own.

Also in v6: **row banding and the focus trace**, so a machine can be followed
to the right edge — banding is a neutral overlay rather than a background
swap, because the background now belongs to quality; the machine in focus
carries its orange rail edge across the whole grid. The **grid rail** reads
as one sentence (`Show [All | Routine]`, a quiet count chip, `Edit Routine`,
`‹ Older`) instead of three pieces of chrome describing one idea, and
`start → now` is gone from the corner — it captioned the Analytics column,
which the Active Session turns off. **Edit Routine** moved down from the
session bar, off the edge it shared with DISCARD. Two in-session modals
became one **machine sheet** (`features/equipment/MachineSheet.tsx`), opened
by the machine's name, writing through `features/equipment/mutations.ts` so
a mid-session change reaches the client's Equipment tab and Journal. And the
session bar gained an **Assessment** slide-over onto the running 90-day
check-in draft.

**v5 (Sep 5) — auto-fit density in Recent Journey.** The profile grid now
runs `fit="auto"`: it measures the height and width it is given and solves
for the row height (44 → 26px) that puts EVERY loaded machine on screen and
the column width (84 → 56px) that puts at least ten of the fourteen loaded
sessions across. Under 36px rows the cell goes single-line ("116 · 12↓"),
the Analytics cell drops its context line, the group divider shrinks to
24px, and machine settings fold into a ⋯ menu (`settingsDisplay="menu"`) so
the machine column narrows to 150px. The legend rides in the toolbar so the
grid can reach the nav. Result on the 13" iPad: 21 machines × 12 sessions in
portrait at ~41px rows, 21 × 13 in landscape at 26px rows. The Active
Session keeps `fit="fixed"` and the inline settings rail — a trainer reads
those numbers walking up to the machine. The first Firestore page is 15
sessions (was 10) so fourteen columns arrive with the profile.

**v4 (Sep 4) — the Now bar.** Today's column stopped being the input. It is a
read-only 84px cell the same width and shape as a history cell; all entry
moved to `SessionNowBar`, a fixed bar above the nav. The reason is mechanical:
a CSS Grid row track is as tall as its tallest item, so a 252px input cell was
also setting a 96px row height for every history cell beside it — it cost
width and height at once. With it gone, portrait fits 8 history columns (was
4) and 8 machines with no vertical scroll (was 6).

Also in v4: the density switch is gone (one tuned density — rows 44px, columns
84px, machine rail 184px, with `max-height` steps that protect the 8-machine
rule on shorter screens); Focus and the legend moved from the app header and
the page footer onto a 32px grid rail directly above the list they act on;
Older is a sticky 26px rail rather than the first timeline column; and the
star / half-moon quality glyphs became the **inroad mark** — one wedge, drawn
unbroken for a full inroad and snapped for a set where tension broke, with the
history grid carrying it as edge continuity rather than a glyph per cell. The
app shell is a bounded `100dvh` flex column with the nav as an in-flow last
child, so nothing renders beneath it on any view.

**v2 (Sep 3):** grid lives under the static client header and scrolls in the space below it; the Recent Journey / Active Session toggle is gone (the global bottom action bar owns that transition); lens chips replaced by a sticky **Analytics** column right of the machine names; the most recent logged session is framed as the baseline.

---

## 1. UX rationale & visual hierarchy

### 1.1 The color budget

The old screens spent color on the wrong thing. Every machine row had its own hue (emerald / amber / purple / blue per movement group), every trainer avatar had a hue, and then set quality added a third layer of emerald / amber / rose on top. Three unrelated color systems fought on the same surface, and the eye had nothing to lock on to.

The redesign runs on a **color budget**: color is spent only where it carries a decision.

| Meaning | Color | Why |
|---|---|---|
| **Max strength set** (quality 3) | Green `--jg-q-max-fill` `#dff3e7` / `#103728` dark, plus a **gold ★** | The one thing a trainer should spot from across the room. The fill is the whole cell, so it survives at 26px rows and eight columns out. |
| **Completed set** (quality 2) | Slate tint derived from `--brand-primary-3` | The baseline. A normal week of training should read *calm*. No yellow anywhere — amber reads as a warning, and "you did the work" is not a warning. |
| **Needs improvement** (quality 1) | Crimson `#c0203f` on `#fce3e8`, a diagonal hatch, and a **red kaizen ◯** | Unmistakably "not right" without calling it a failure. The kaizen ring is the point: an open circle means there is another rep tomorrow. |
| **Load movement** | Brand blue text, always with ▲/▼ | Text-level only — it never paints a cell, because the cell belongs to quality. The arrow is what stops a blue number from reading as a control. |
| **Baseline / interactive** | Brand blue `--brand-accent-4` / `--brand-primary-2` | Everything a trainer *acts on* is blue: the LATEST column, the Today column, the Analytics header, a spotlighted date, focus rings, the row trace. Blue never encodes a result. |
| **Now** | Hero orange `--jg-hero` | The set happening this second: the focus machine's name edge and its row trace. Orange means "here", never a result. |
| Everything else | Slate neutrals at OKLCH hue 240 | Greys were generated at the brand slate's hue, so they belong to the palette instead of looking like a stock Tailwind grey. |

**On green and red together.** Putting the two rated states on the one pair a
protanope or deuteranope cannot distinguish is a real cost, taken knowingly
because green/red/grey is what a sighted trainer reads fastest with no
legend at all. It is paid for with two non-colour channels: **shape** (★ vs
◯ vs nothing) and **texture** (the poor cell's hatch). Desaturate the grid
and all three states are still distinct. Any future change to this palette
has to keep both.

Movement groups (Neck / Lower body / Push / Pull / Core) are available as **section divider rows** ("By group"), not as paint. The default order is the studio sequence (`DEFAULT_MACHINE_DISPLAY_ORDER`), unchanged.

### 1.2 Cell anatomy

Every historical cell shows the same two numbers in the same two places, so the eye can scan a row like a sentence:

```
┌──────────────┐
│   116 ▲2   ★ │  weight — 17px semibold, tabular figures
│    12 ↓      │  reps (or ⏱ 1:30 for a timed static contraction) + trend glyph
└──────────────┘
   the whole fill is the rep quality — green / red / grey
   ▲2 blue, only when the load moved vs the previous logged set
   ★ gold (max) or ◯ red kaizen (needs work), top-right, never for a normal set
```

- **The fill is the rating and nothing else.** A load increase used to tint the same cell green, which is the collision v6 removed.
- **The corner mark is the backup channel, not the primary one.** Two states out of three carry one, so a normal week of training shows no glyphs at all. Hidden under 36px rows, where the row is single-line and the fill is the whole cell anyway.
- **Trend glyphs are monochrome on purpose.** `↑↓` = same load, reps changed. Colour says *quality*, the glyph says *direction* — one channel per meaning.
- **Empty cells** show a faint `—`, never a fill, so a sparse machine doesn't look busy.
- **Timed static contractions** show `⏱ 1:30` in the reps slot. Same slot, different unit.

### 1.3 The LATEST column

The most recent logged session is the baseline for today's prescription, so it gets the strongest treatment in the timeline: a 2px blue frame down both sides of the column, a 3px blue underline on its header, the header inverted (`LATEST · #45`, blue date, filled avatar), empty cells tinted blue, and the weight one step larger. Quality fills stay inside the frame, so "max effort last time" and "poor quality last time" are both still readable at a glance. In the Active Session the LATEST column sits directly beside the Today column: **baseline → today**, no scrolling.

### 1.4 Light and dark are two designs, not a flip

Dark mode is derived from the same tokens but re-tuned, because a 14% orange tint that looks warm on white turns to mud on navy:

- Fills mix the brand color into the dark **surface** (22–32%), not into black.
- Accent **text** climbs the same hue: peach `--brand-accent-2` stands in for orange, sky `#8cc4f2` for blue, `#f8a7d4` for plum — so small text on a tinted fill still clears 4.5:1.

Every text/fill pairing was checked against WCAG 2.1 AA. Worst cases:

| Pairing | Light | Dark |
|---|---|---|
| Weight text on any cell fill | 14.5 : 1 | 11.5 : 1 |
| Reps text on any cell fill | 7.7 : 1 | 8.4 : 1 |
| Muted labels on header band | 5.0 : 1 | 6.3 : 1 |
| Green text on max fill | 5.6 : 1 | 8.1 : 1 |
| Blue load delta on max fill | 7.8 : 1 | 7.1 : 1 |
| Crimson text on poor fill | 6.4 : 1 | 7.8 : 1 |
| Gold ★ on max fill (non-text) | 3.4 : 1 | 8.3 : 1 |
| Red kaizen ◯ on poor fill (non-text) | 4.9 : 1 | 6.1 : 1 |
| Banded row overlay, worst pairing | −0.7 : 1 | −0.6 : 1 |
| Blue text on LATEST / Today fill | 7.7 : 1 | 7.7 : 1 |
| Quality edge (non-text) on surface | ≥ 3.5 : 1 | ≥ 5.9 : 1 |

The only pairing that does *not* clear 4.5:1 is white text on solid `#ef5302` in light mode (3.55:1). That is why the hero orange is used for **bars, edges and ≥18px bold buttons only** — small orange text always uses `--jg-hero-text` (`#bc2c00`, 6.0:1).

### 1.5 Typography

- **Saira Condensed** (your display face) for dates, the Analytics header, section labels and the LATEST / TODAY tags — condensed type is what lets an 84px column hold "AUG 24" at 15px without wrapping.
- **Geist** (your app face) for everything else, with `font-variant-numeric: tabular-nums` on every number so columns of weights line up digit-for-digit.

---

## 2. Layout strategy & interaction model

### 2.1 Where the grid lives

The grid is a component *inside* the client profile. Above it, unchanged and static: the app bar, the client header (name, Profile details / Start session), the stats row (top trainer, last / next session, sessions completed) and the section tabs. Below it, the global action bar. `RecentJourneyView` renders as a flex column (`layout="fill"`) that takes whatever height is left between those, and **only the grid's scroller scrolls** — the page never does. The same `layout="fill"` prop drives the Active Session under its own session bar.

There is no view toggle on the grid. Starting a session is the bottom bar's job, exactly as it is today.

### 2.2 One scroller, four sticky rails

The grid is a single element that scrolls on **both** axes. Inside it:

- the **machine column** is `position: sticky; left: 0`
- the **Analytics column** is `position: sticky; left: <machine column width>` — it rides directly behind the machine column and the two form one rail
- the **date header** row is `position: sticky; top: 0`
- the **Today column** (Active Session only) is `position: sticky; right: 0`
- the corner, the Analytics header and the Today header pin on two axes at once

Because every pinned piece is a grid cell with `position: sticky`, the browser's compositor does the pinning. No JavaScript listens to scroll, there is no cloned header table to keep in sync, and nothing janks on an iPad. Vertical scrolling never hides the dates; horizontal scrolling never hides the machines or their numbers.

### 2.3 Chronological flow

Columns run **oldest → newest, left → right**; Today is the last column. The grid opens scrolled to the far right, so the first thing on screen is the LATEST column beside today's input. A `ResizeObserver` keeps it parked there through any resize that happens before the trainer touches the grid (fonts loading, orientation change, a panel opening) — the v1 prototype could open on the wrong end because of this.

History loads backwards: **Older +5** in the section toolbar, and the same control at the far left of the timeline. Prepending five columns compensates the scroll offset in the same frame, so the columns under your thumb don't move.

### 2.4 The Target Weight box is gone

The prescribed weight (`clientMachineSettings.currentWeight`) shows up in exactly one place: **pre-filled in Today's weight input**. The machine cell's readout shows the journey instead: `40 → 66 lb (+65%)`.

### 2.5 The Analytics column

A fixed, sticky column immediately right of the machine names. **Every row shows the same metric**, and the column header is the control:

| Tap the header… | Column shows, per machine | Tie-break |
|---|---|---|
| **First** weight | earliest set on record | — |
| **Lowest** weight | lowest load ever | earliest — when the floor was set |
| **Highest** weight | heaviest load ever | latest — is the ceiling still current? |
| **Most** reps | best rep count in a set | latest, at whatever load it happened |
| **Fewest** reps | lowest rep count in a set | latest — the most recent struggle is the useful one |

Each cell is three lines: the number with its unit (`116 lb` / `12 reps`), the date it happened, and the *other half* of that set as context — reps for a weight metric, `@ 116 lb` for a rep metric — so "Highest 116" and "Most reps 15 @ 116" answer the follow-up question before it is asked. Timed static contractions count for the three weight metrics and are skipped by the two rep metrics.

Interaction rules that make it work on a gym floor:

- **One tap cycles.** The header is one 74px-tall button; five dots under the label show where you are in the cycle. No menu to open, no chips to scan, and the trainer's thumb never leaves the rail.
- **The numbers search the whole loaded history**, not just the visible columns — "Lowest" is the real floor. If the set behind a number lives in a column that isn't loaded yet, the cell says `‹ older`.
- **Tap a value to see it in context.** The timeline scrolls that session's column into view and spotlights it. The source cell also carries a quiet dashed ring (dropped inside the LATEST column, which is already framed).
- All five metrics are computed for every row in a single pass (`computeRowStats`), memoised on the data — cycling the metric only re-renders the 20 Analytics cells.

Two more header taps, both blue because both are interactive:

- **Tap a date header → spotlight** that column (blue ring, inverted header). Tap again to clear.
- **Tap a machine name → trace** its row (blue rules top and bottom). Tap again to clear.

### 2.6 The Today column (Active Session)

The input cell reads in the order the set happens:

1. **Load** — pre-filled, `−`/`+` steppers in 2 lb increments, tap the number for the numeric keypad.
2. **Outcome** — a large reps field (16px so iOS never zooms), with a `TSC` toggle that turns it into seconds under tension.
3. **Quality** — Needs work ◯ / Done / Max ★, using the same tokens and the same two marks the historical cell will use once saved. A trainer taps the mark they will read back tomorrow.

Rows for today's routine are numbered and sit first; every other machine is folded under "Not in today's routine" with an *Add to session* button. The current machine (focus) gets an orange edge on its name, an orange trace across its whole row, and a blue ring on its input; `Next: …` in the session bar advances it.

Tapping a machine's **name** opens the unified machine sheet (`features/equipment/MachineSheet.tsx`) — high-importance notes, the dials, the reason box, the note composer, the set-up guide and the change history, in one bottom sheet. It replaced a settings dialog and a notes dialog that used to be two separate targets on the same row. Every write goes through `features/equipment/mutations.ts`, so a mid-session change lands on the client's Equipment tab and in their Journal.

### 2.7 Density

Three densities, one CSS attribute. **Full** (64px rows, weight + reps + trend, three-line Analytics cells), **Comfortable** (56px), **Compact** (44px, weight only, two-line Analytics). The choice persists in `localStorage`, mirroring the existing density preference.

---

## 3. React & CSS architecture

### 3.1 Files

```
src/features/journey-grid/
  journey-grid.tokens.css   brand + semantic tokens, light / dark / system
  journey-grid.css          grid layout, sticky rails, cell states, controls
  types.ts                  view models (JourneySession, JourneyRow, LiveSet, StatMetric…)
  stats.ts                  pure functions: computeRowStats, trend, summary, date formatting
  adapters.ts               WorkoutSession / ExerciseLog / Machine → view models
  QualityMark.tsx           the gold star and the red kaizen ring
  JourneyCell.tsx           memoised historical cell
  StatCell.tsx              memoised Analytics cell
  LiveInputCell.tsx         Today's input cell
  GridToolbar.tsx           section caption + density + legend
  JourneyGrid.tsx           the sticky grid (header, sections, rows, scroll logic)
  RecentJourneyView.tsx     profile → Journey tab
  ActiveSessionView.tsx     live tracker + useLiveSession() state hook
  index.ts
```

### 3.2 Why CSS Grid, not `<table>`

- A table can't pin a column on the **right** while also pinning two on the left without wrapper hacks; a grid cell can be sticky to any edge, at any offset (`left: var(--jg-col-machine)` is what stacks the Analytics column behind the machine column).
- Grid tracks are declared once (`grid-template-columns`) — machine, Analytics, N sessions, Today — so widths never drift between header and body.
- Rows are `display: contents` wrappers carrying `role="row"`, so the DOM still reads as a table to VoiceOver (`role="grid"` / `columnheader` / `rowheader` / `gridcell` with full `aria-label`s), while the browser lays out one flat grid.

Two rules that bit during the build and are worth knowing: **never leave an empty track in the template** (a 0px placeholder made auto-placement flow the next row's first cell into it — optional tracks exist only when their cells render, via `data-stats` / `data-live`), and **size session tracks as `minmax(col, 1fr)`** so a short timeline still pushes Today to the right edge.

### 3.3 Performance on mobile Safari

- **Sticky is compositor-driven.** No scroll listeners, no transforms, no `will-change` sprinkled everywhere. Avoid `transform` or `overflow: hidden` on any ancestor of `.jg-scroller` — either one breaks sticky.
- **Two more sticky cells per row cost nothing measurable.** The Analytics column is 20 more composited items (one per row) with `contain: layout style`; the only scroll listener in the component is the passive "has the user touched this yet" flag.
- **Cells are `React.memo`.** Cycling the Analytics metric re-renders 20 `StatCell`s and the cells whose dashed ring changes; typing a rep count re-renders exactly one row, because `useLiveSession` replaces only that machine's `LiveSet` object.
- **Aggregates run once per data change** (`useMemo` over rows × history), never per cell, never per tap.
- **No per-cell inline styles.** Widths, row heights and font sizes are CSS custom properties on the container; density is one attribute flip.
- `overscroll-behavior: contain` on the scroller (no page bounce-through), `touch-action: pan-x pan-y`, `-webkit-tap-highlight-color: transparent`.
- Ceiling before you need virtualisation: ~20 rows × ~60 columns ≈ 1,200 cells renders comfortably. Past ~150 columns, window the `sessions` array by `scrollLeft` (the "Older" paging already keeps you far below this).

### 3.4 Data flow

```
Firestore ──► adapters.ts ──► JourneyRow[] + JourneySession[] ──► JourneyGrid
                                   │
   ExerciseLog { weight:"116", reps:"12", isTSC, repQuality:1|2|3 }
   WorkoutSession { sessionNumber, date, trainerInitials }
   ClientMachineSetting { settings, startingWeight, currentWeight }
```

`repQuality` keeps its existing meaning — **1 = poor, 2 = completed, 3 = max strength** — so nothing in Firestore changes. `toIsoDate()` normalises the mixed date strings without going through `new Date(string)`, so a set logged on Sep 2 never shows as Sep 1 on a device in another timezone.

### 3.5 Integration steps

1. Copy `src/features/journey-grid/` into the app. Import `journey-grid.css` once (e.g. in `main.tsx`); it imports the tokens file itself.
2. In `ClientProfileView.tsx`, make the Journey tab's content area a flex column that fills the height under the tabs (`display:flex; flex-direction:column; min-height:0; flex:1`), then replace the table with:
   ```tsx
   const journeySessions = useMemo(() => toJourneySessions(sessions), [sessions]);
   const journeyRows = useMemo(
     () => toJourneyRows(orderedMachines, allLogs, clientSettings, starredIds),
     [orderedMachines, allLogs, clientSettings, starredIds],
   );
   <RecentJourneyView
     sessions={journeySessions}
     rows={journeyRows}
     hasMoreOnServer={hasMoreSessions}
     onLoadMore={handleLoadMoreHistory}
     loadingMore={isLoadingMore}
     layout="fill"
   />
   ```
   `orderedMachines` is the list already sorted by `resolveMachineOrder`. If the profile page must keep scrolling as a whole, pass `layout="auto" maxHeight="…"` instead.
3. In `WorkoutTrackerView.tsx`, feed `ActiveSessionView` the same rows plus `useLiveSession(routineMachineIds, existingLogsAsLiveSets)`, and write `live.values` back through your existing `updateLog` on change (debounced) or on Finish.
4. Delete `lib/machine-colors.ts` once nothing else imports it. Movement groups now come from `movementGroupFor()` in `adapters.ts` (same rules, no colours).
5. Optional: expose the semantic tokens to Tailwind by adding to `@theme inline` in `index.css`:
   ```css
   --color-jg-hero: var(--jg-hero);
   --color-jg-live: var(--jg-live);
   --color-jg-poor: var(--jg-q-poor);
   ```

### 3.6 Things deliberately left for you to decide

- Unilateral machines (Torso Rotation L/R): the adapter keeps one set per cell (Left wins). If you want both, give each side its own row — the grid doesn't care.
- The per-studio custom machine order overrides the default; the "Sequence / By group" toggle respects whatever order the rows arrive in.
- Saving cadence for the live column (debounce vs. on-blur vs. on-Finish) — the hook is agnostic.
- Whether the Analytics column stays on in the Active Session (`showStats={false}` turns it off there if the rail feels too wide in portrait).
