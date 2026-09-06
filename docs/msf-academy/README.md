# MSF Academy — reference corpus

Plain-text conversion of the MSF Academy Google Drive
(`drive.google.com/drive/folders/11EQ0ebZENz4zdQ1Im6Q3UFktCs5-8ye8`),
committed so the methodology is greppable from any checkout without
needing Drive access.

**This is the source of truth for training methodology.** When a feature
encodes a rule about exercise selection, sequencing, rep ranges, or
progression, that rule must trace back to a file in here — and the code
that encodes it should cite the filename in a comment.

## Where the rules that are already in code came from

| Code | Source document |
| --- | --- |
| `src/features/routine-builder/academy.ts` → `ACADEMY_CATEGORIES`, `BIG_FIVE` | `Academy 6/Academy - Programming and Progression 1 - Workout Programming Considerations.txt` |
| `academy.ts` → `SEQUENCING_RULES` | `Academy 6/Programming and Progression 7 - Exercise Selection Template.txt` ("Programming and/or sequencing to potentially avoid") |
| `academy.ts` → `EXERCISE_SUBSTITUTES` | `Academy 6/Exercise Substitutes.txt` |
| `academy.ts` → `SELECTION_TEMPLATES` | `Academy 6/Programming and Progression 7 - Exercise Selection Template.txt` (condition/goal table) |
| `academy.ts` → `MODEL_AB_ROUTINE`, `TWICE_WEEKLY_RULE` | `Academy 6/Programming and Progression 6 - AB Routines - How to Optimize Programming.txt` |
| `academy.ts` → `REP_RANGE_BY_LEVEL`, `EXERCISE_COUNT` | `Academy 6/Academy - Programming and Progression 2/3/4 - Novice/Intermediate/Advanced Level Trainees.txt` |
| `academy.ts` → `PAIN_PROTOCOL` | `Academy 6/Considerations for Training with Pain.txt` |

## Layout

```
Academy/                       the numbered curriculum, 1–9
  Academy 1 - Introduction/            philosophy, glossary, the 4 P's
  Academy 2 - Benefits.../             why resistance training
  Academy 3 - Basic Principles.../     overload, intensity, volume, progression
  Academy 4 - Exercise Performance/    cadence, turnarounds, breathing
  Academy 5 - Continuous Tension.../   the core MSF protocol
  Academy 6 - General Recommendations for Programming and Progression/
                                       ← programming rules live here
  Academy 7 - Variations.../           TSC, static hold, forced reps, drop sets
  Academy 8 - Basic Equipment.../      per-machine setup + quick-reference guides
  Academy 9 - Exercise Instruction/    scripts and cueing
Academy 2/                     Fundamentals of High Intensity Exercise
Initial Setups (...)           starting-weight tables
Set Up Machines/               standardized setup guides (batches 1–4)
Workout Setups and Instruction/ upper / lower / spine-trunk-core
```

Binary originals (`.docx`, `.xlsx`, `.pdf`, machine photos) were **not**
committed — only the extracted text. Spreadsheets that matter
(`MSF - Suggested Starting Weights.xlsx`, `Exercise Loading Guidelines.xlsx`)
are still Drive-only; if their numbers get encoded in the app, add them here
in a structured form at the same time.

## Refreshing

Re-export the Drive folder, convert `.docx` → `.txt` preserving the tree, and
replace the contents of this directory. Nothing reads these files at runtime —
they exist for humans and for agents doing research before a change.
