# Pre-Session Briefing

The last screen before a trainer puts hands on a client. Reached from the
client profile via `WorkoutTrackerView`, and the only screen in the app whose
job is to answer **"is there anything here that could hurt them"**.

```
briefing.tokens.css   colour, two layers: brand pigment -> semantic names
briefing.css          layout, one file, class names in the markup
BriefingScreen.tsx    the screen
index.ts              barrel — import from "../features/briefing"
```

## The order of the page is the whole design

1. **Who is in front of you** — name, last session, clinical flags.
2. **Before you start** — critical journal entries. Above the goal, deliberately.
3. **Global goal** — the direction, quoted.
4. **Coaching focuses** — what this trainer is currently working on.
5. **Today's routine** — A or B, suggested but overridable.
6. **Execution sequence** — drag to reorder, edit to add or remove.
7. **Check-in** — sleep, stress, energy, mood, body state, notes. All optional.
8. **START SESSION** — one loud action, and the only orange on the page.

Steps 2 and 3 used to be the other way round. A goal is a direction; a
contraindication is a thing that must not happen in the next ninety minutes.

## Conventions, same as every other feature folder here

- **Tokens only.** No hex, no `slate-###`, no `dark:` pairs in the component.
  Every colour resolves through `--br-*`, which means light and dark cannot
  drift apart one element at a time — which is exactly what had happened.
- **44px minimum** on anything tappable. Gym floor, tablet, gloved hands.
- **WCAG 2.1 AA**, ratios recorded beside each token value.
- **One scroller, and it is `<main>`.** This view does not declare its own
  height or its own `overflow`. See the header of `briefing.css`.
- **One loud action.** `--br-hero` is spent on START SESSION and nothing else.

## Known: three shared children still carry their own styling

`ConditionChip`, `JournalEntryCard`, `RoutineCompareCard` and `SequenceRow`
are used on other screens too, so converting them would be a change to those
screens as much as this one. They read acceptably against the new surfaces.
Worth a pass of its own when the next screen that uses them is redesigned.
