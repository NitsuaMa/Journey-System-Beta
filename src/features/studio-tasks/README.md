# Studio To-Do — cleaning, maintenance and floor operations

Round: **Studio To-Do, Sep 2026.** Branch `studio-tasks`, one commit per phase.
Round B of the Catalog work; the original outline is §8 of
`src/features/catalog/README.md`.

Two screens over one model. Trainers close items on the floor; managers author
the list. The Catalog grows an Upkeep section so a trainer standing at a machine
can record it there instead of walking to a checklist.

---

## 1. Templates and instances, not a `done` flag

The obvious model is one document per task with a checkbox on it. It does not
survive the requirement, because the list has to **reset** — nightly, on certain
weekdays, or per AM/PM shift.

Under a single document, "reset on Mondays" is a destructive write that erases
who did what, and there is no way to answer *was the leg press wiped down last
Tuesday*.

```
studios/{studioId}/taskTemplates/{templateId}     what should happen, how often
studios/{studioId}/taskInstances/{instanceId}     one occurrence, on one day
```

Templates are edited by managers and rarely change. Instances are the record of
action against them and are kept.

### 1.1 The deterministic id is the point

```
instanceId = `${templateId}__${localDate}__${shift}`            facility / client
             `${templateId}__${localDate}__${shift}__${machineId}`   machine
```

Derived entirely from its coordinates. Three trainers opening the list on three
iPads in the same second compute the same ids and write the same documents
instead of three copies of the day.

Which means this ships with **no Cloud Function**. A scheduled one can be added
later to pre-materialize; it writes the same ids and collides with nothing.

### 1.2 `localDate` is studio-local, always

Computed with `lib/studio-time`, never the device clock. A trainer whose iPad is
in another timezone would otherwise cross midnight at the wrong moment and mint a
second day's worth of instances — the list appearing to reset at random, which is
close to unreportable as a bug.

---

## 2. Nothing is written until someone acts — a departure from the spec

§8.1 had the first trainer of the day materializing that day's instances. The
deterministic ids made it safe, but it is unnecessary work.

The day's plan is **derived** (`planDay`), so a row with no stored document
simply *is* an open task. Materializing eagerly would mean:

- a burst of 50+ writes the first time anyone opens the app each morning, on a
  tablet on studio wifi, for a day that might see no work at all;
- a document for every task on every day the studio was closed;
- a create permission open to every trainer for documents nobody asked for.

So instances are written lazily, on the first action. The tradeoff is that "what
was outstanding last Tuesday" is recomputed rather than read back — the right
direction, since the plan is the source of truth and the instances are the record
of action against it. `planDay` is pure, so recomputing costs nothing.

---

## 3. Decisions worth arguing with

| Decision | Why |
|---|---|
| An empty weekly day-selection means **every day**, not never | It is a half-finished edit. A manager who thinks they scheduled something and silently gets nothing has no way to tell why. |
| A monthly task on the 31st **does not fire** in a 30-day month | Clamping to the last day would silently reschedule a quarterly service check. Skipping is visible; moving is not. |
| `am` and `pm` generate **separate instances** | Closing is not satisfied by having opened. |
| `machineIds: "all"` is stored as the literal string | Expanded against the *current* roster at read time, so equipment added next month is covered without anyone re-saving the template. |
| Retire, don't delete | Instances reference the template; deleting orphans the record of every time the task was done. Hard delete is behind a second tap and a warning. |
| A trainer re-opens a wrong tick; they cannot delete it | The audit trail survives being wrong. |

---

## 4. Authority — who may write what

The same split as `machineNotes` in the Catalog round, for the same reason.

```
taskTemplates    manager-write    they set the standard the floor is held to
taskInstances    trainer-write    closing one is the job
delete           manager-only     history is not the floor's to erase
```

`manage_studio_tasks` in `lib/permissions.ts` rides the existing `manage_studio`
case. Completing a task is **not** gated — any trainer closes one.

### 4.1 Why flagging does not write the roster

A flagged maintenance task is exactly the signal that should set
`rosterStatus: 'maintenance'`. It does not, because the roster is manager-write —
it carries `overrides`, which can rewrite `clinicalWarnings` — and the person who
finds a broken thigh pad is a trainer on the floor.

So the flag lives on the **instance**, which trainers own, and `useMachineUpkeep`
derives the Catalog's badge from it. The floor can always report a problem; only
management can change the record.

---

## 5. The two screens

**`StudioTasksView`** — grouped by template, not flattened. "Wipe down every
machine" across a 22-machine roster is 22 rows; as a flat list it buries the four
facility tasks that also have to happen and gives no way to close the set at
once. As a card with its own count and its own *Mark all*, it is one line of
scanning and one tap. Multi-select is deliberately secondary: the common case at
close is *all of them*.

**`TaskManager`** — a small, boring form. Every decision here is made once and
revisited rarely, so it optimises for being unambiguous rather than fast, and it
explains its own rules inline (the three in §3 that people get wrong).

**`MachineUpkeepCard`** — rendered inside the Catalog's detail pane. Completes
the studio's *real* scheduled task for that machine; if nothing is scheduled
today there is nothing to tick and it says so, rather than manufacturing a record
that belongs to no checklist.

---

## 6. Files

```
types.ts             the model, and the reasoning above in comment form
recurrence.ts        PURE: is it due, what ids, what does a day contain
recurrence.test.ts   26 tests — the whole scheduling policy, no Firestore
mutations.ts         every write; batching, lazy creation, template CRUD
useStudioTasks.ts    live templates + instances joined to the derived plan
useMachineUpkeep.ts  per-machine cleaning/service/flag state, for the Catalog
StudioTasksView.tsx  the trainer screen
TaskManager.tsx      the manager's editor
TaskNoteDialog.tsx   complete-with-note, and the flag
MachineUpkeepCard.tsx rendered by features/catalog
studio-tasks.css     .st (screen) and .stu (the card in the Catalog)
```

`useMachineUpkeep` sorts on `localDate`, not `completedAt`: `YYYY-MM-DD` sorts
lexicographically with no date parsing, and `completedAt` is a server timestamp
that reads back `null` for a moment after a write — which would make a
just-completed task look like the oldest one.

---

## 7. Still to do

- **Deploy `firestore.rules`.** New `taskTemplates` and `taskInstances` blocks.
  Until deployed, every write from this feature fails with a permission error.
- **Verify on the iPad.** Both themes, portrait and landscape. Author a daily
  all-machines cleaning task, check off three, "Mark all", flag one with a note,
  confirm the badge and the Upkeep section in the Catalog. An AM+PM template
  producing two separate cards. A weekly task on a day it is not due showing
  nothing. Sign in at a second studio and confirm none of it is there.
- **InBody has no screen of its own.** `target.action: 'inbody'` opens the client
  profile, which is the closest honest destination; `assessment` opens the
  consultation wizard and `progress-report` opens the report editor. When an
  InBody flow exists, point it there.
- No scheduled reminder or digest. Everything is pull, not push.
- A studio with hundreds of days of history will eventually want the instances
  query bounded by date range rather than by day; the current query is a single
  day, so this is not urgent.

---

## Two tiers: studio tasks and personal tasks (Sep 5, 2026)

A studio task is authored by a manager and belongs to the location — everyone
on the floor sees it and anyone can close it. A personal task belongs to one
trainer and nobody else can see it, not even a studio owner.

**The tier is a path, not a field.**

    studios/{studioId}/taskTemplates/{id}    scope: "studio"
    studios/{studioId}/taskInstances/{id}
    trainers/{uid}/taskTemplates/{id}        scope: "personal"
    trainers/{uid}/taskInstances/{id}

The cheaper design is one collection with a `scope` field and a rule that hides
other people's rows. It was rejected. Firestore cannot enforce "only your own
rows" on a **list** query unless every query carries a matching constraint, so
privacy would depend on every future query being written correctly — and a
single unconstrained read added months from now leaks every trainer's private
list at once. With separate paths the rule is `request.auth.uid == trainerId`
and there is nothing for a future caller to remember.

`scope` is stored on the document as well, so a row that has already been read
knows where to write itself back. `taskLocationOf()` in `types.ts` is the only
place either tier becomes a path, and it falls back to the studio path when a
personal template has somehow lost its `ownerId` — writing to the shared list
is wrong, but writing to `trainers/undefined/...` is worse.

**`ownerId` is the Firebase Auth uid, not the trainer document id.** They
coincide for trainers created through Auth and not necessarily for older
documents, and the uid is what the path and the rule are keyed on.

**Ownership is by trainer; visibility is by location.** A personal task still
carries a `studioId` and the day list filters on it, so "restock the towels"
does not follow a trainer to another location.

**Mixed writes.** A multi-select can span both tiers, and they are different
collections, so one batch cannot cover both. `StudioTasksView.writeMany()`
groups the selection by location and writes each group.

### Still open

- No Studio / Mine filter on the day list yet; personal rows carry a "Mine"
  chip and that is all. A segmented filter is the obvious next step.
- A task cannot be moved between tiers after it is created. Promoting a
  personal task to the studio list is a copy-and-delete across two collections
  and wants a deliberate design rather than a drive-by one.

---

## Shelf life, one-tap replies, and where tasks get authored (Sep 6, 2026)

Three changes, all aimed at the same failure: **a board that rots is a board
people scroll past, and once it is scrolled past the cover request that
mattered is missed and everyone goes back to the group text.**

### An expiry on a request

`TaskRequest.expiresAt` — a real Timestamp, set by whoever posted it, offered
as four choices at post time: **No expiry** (the default), **Today**, **3
days**, **A week**.

Do not confuse it with the existing `expiresOn`. That is a studio-local date
key the *system* writes when a request is **resolved**, so a closed ask ages
out of the "recently resolved" list after a fortnight. `expiresAt` applies to
an **open** request and is the author's own statement that it has a shelf
life. "Anyone free to spot me at 2" is noise at 4pm.

- **No expiry stays the default, and stays first in the picker.** Most asks
  have no honest deadline, and a picker that defaults to one would stamp a
  made-up shelf life on every request on the board.
- **"Today" means the end of the *studio's* day** (`endOfStudioDay`), not 24
  hours out and not midnight on the iPad's clock. A device left on Pacific
  time would otherwise keep tonight's ask up through tomorrow's opening shift.
- **`useStudioRequests` re-evaluates on a 60s tick.** An expiry is the one
  thing on this board that becomes true with *nothing being written* — the
  document at 9pm is identical to the document at 8. Without the tick, a board
  left open on the front-desk iPad keeps showing an expired request until
  somebody happens to post something else.
- **Expired ≠ deleted ≠ resolved.** It drops off the floor's board and appears
  under **Aged out** in Manage. The difference between an ask that was
  answered and one that ran out of time is the only interesting thing when
  somebody asks why nobody covered Thursday.

### Preset reactions

```
reactions[reactionId][uid] = { name, at }
```

Five fixed presets: **Got it · On it · Done · Thanks · Can't**.

- **A fixed list, not open emoji.** Each one is a *state* a person can be in
  with respect to the ask, so a row of them reads as status — "two saw it, one
  is on it, one can't" — rather than as applause.
- **A map of maps, not an array.** The write we care about is one person
  toggling one reaction, which as a map is a single-field update at a known
  path (`new FieldPath("reactions", id, uid)`, explicit segments so nothing is
  parsed). Two people tapping in the same second write different fields and
  neither can lose the other. `arrayUnion`/`arrayRemove` would need the exact
  object back, timestamp included, to undo it.
- **Removing writes `deleteField()`**, not `false` — an untapped reaction
  leaves nothing behind, so the map *is* its reactors.
- **Reactions never notify and never toast.** A nod is not an event, and five
  bells behind one heads-up is the exact volume problem `notify.ts`'s four
  filters exist to prevent.
- Names are denormalized so a row renders without a read per reactor.

### Manage owns studio task authoring

The **Studio task list** panel is now the first thing in Manage, listing every
studio template with a tap to edit, a **New studio task** button, and four
one-tap starters (all-machine wipe-down, opening & closing, weekly machine
check, client follow-ups).

Authoring used to be reachable only from a dialog opened out of the *board's*
header — the screen built for the opposite job, closing things off on the
floor. Nothing about the model changed: same templates, same dialog for the
detail. It is simply reachable from where the decision is made.

The starters exist because the empty-list problem is not that authoring one
task is hard, it is that the first one asks a manager to answer six questions
(kind, category, recurrence, shift, target, note-required) before anything
exists to look at. Each starter lands as an ordinary editable template — there
is no such thing as a "preset task" in the model.

### `canManage` is temporarily `true`, and it has a date on it

`StudioTasksView` no longer hides anything behind
`hasPermission("manage_studio_tasks")`. The permission is still evaluated —
it decides the button's *label* — but the Manage section is being built out
and the role model it should hang off is separate work; gating a half-built
surface against a permission model that is also about to change means testing
neither.

**This is a UI gate only, and it always was.** `firestore.rules` decides who
may write `studios/{id}/taskTemplates` and is unchanged. A trainer without the
right still cannot save a studio task — they now see the attempt fail honestly
instead of not seeing the button. **Restore the gate when RBAC lands.**

### Still open

- **Reactions and `expiresAt` need no rules change, and that is the problem.**
  The deployed `taskRequests` update rule pins one thing — `createdBy.id` must
  not change — and allows any authenticated trainer to write every other
  field. So both new fields work in production today, and so would a trainer
  deleting somebody else's reaction, rewriting the title, or clearing an
  expiry they did not set. That permissiveness predates this round (it is what
  lets anyone claim or close a request) and reactions do not widen it, but a
  rule restricting a writer to their **own key** under `reactions` is the
  obvious tightening and belongs with the RBAC pass.
- **`expiresAt` has no index.** Expiry is filtered client-side over a studio's
  requests, which is a handful of documents. If a busy studio ever makes that
  read expensive, the query wants `where("status", "==", "open")` plus an
  ordered `expiresAt` bound and the composite index to match.
- A reaction cannot be seen from Manage. "Six people saw the heads-up and
  nobody reacted" is a real signal and is currently invisible there.
