# Settings RBAC Teardown + Studio Task Board

**Round:** Settings tiers & Task Board — Sep 5 2026
**Branch:** `settings-rbac-task-board` (off `master`), one commit per phase
**Status:** proposal + build in one pass

---

## 0. What I found before designing anything

Two things changed the shape of this round, so they belong up front.

**The Task Board already exists.** `src/features/studio-tasks/` is in `master` today —
about 2,600 lines across 14 files. It already has recurring templates, per-day
instances, personal vs studio tiers, a note dialog, and a `MachineUpkeepCard`
wired into the Catalog's machine detail. So Part 2 is **not** a from-scratch
build. It is four additions to a model that already works:

| You asked for | Today | Gap |
|---|---|---|
| Recurring maintenance workflows | ✅ daily / weekly / monthly / once, with AM / PM / anytime shifts | none |
| Catalog shortcut to mark a machine cleaned | ✅ `MachineUpkeepCard` in `MachineDetail` → "Upkeep" | none |
| Create tasks onto a shared studio board | ✅ studio-scoped templates | none |
| **Claim a task** | ❌ | **new** |
| **Creator alerted on completion** | ❌ no notification model at all | **new** |
| **Floating requests / trainer comms** | ❌ | **new** |
| **Open-ended, not rigid categories** | ⚠️ four hard-coded categories | **new** |

**One of your requirements contradicts a decision you made yesterday.** On Sep 4
you deliberately commented the notification worker and both reminder cron jobs
out of `render.yaml` — nothing in the app is allowed to contact a trainer or a
client yet. "The creator should receive an automated alert on completion" walks
straight into that. You chose **in-app only**: a bell badge and an inbox inside
the app, nothing leaving the system. That is what §5 below designs, and it is
the right call for beta regardless — an email per completed cleaning task would
be unbearable at 30 tasks a day.

---

# PART 1 — Trainer Settings

## 1.1 The problem with just deleting things

If you remove A, B2, B4, C, D, E, F and G, what is left of Hub Settings is
**one card: Report a Bug.** A settings screen containing a single bug form does
not read as "streamlined", it reads as broken — the trainer assumes the page
failed to load. So the teardown has to be paired with a rebuild, or the
minimalism backfires.

The fix is to stop thinking of it as a *settings* screen. A trainer has almost
nothing to configure — that is the whole point of the RBAC work. What they do
have is an **identity** (who am I, where do I work) and a **voice** (here is
what is broken). So the screen becomes those two things, and the bug reporter
gets to be the hero instead of the leftover.

## 1.2 Proposed structure — "Trainer Settings"

Three cards, single column on portrait, two on landscape. No left nav — a nav
rail with one destination is noise.

```
┌──────────────────────────────────────────────────────────┐
│  TRAINER SETTINGS                            [ AJ ▾ ]    │
│  Your account and feedback.                              │
├──────────────────────────────────────────────────────────┤
│  ╔══════════════════════════════════════════════════╗    │  ← HERO
│  ║  🐞  HELP US BUILD THIS                          ║    │
│  ║  You are in beta. Tell us what is broken, what   ║    │
│  ║  feels wrong, and what is missing.               ║    │
│  ║                                                  ║    │
│  ║  [ 🐞 Report a bug ] [ 🎨 UI feedback ]          ║    │
│  ║  [ 💡 Feature idea ]                             ║    │
│  ║                                                  ║    │
│  ║  ─────────────────────────────────────────────   ║    │
│  ║  Your reports          3 open · 7 resolved       ║    │
│  ║  › Journey grid dates truncate      OPEN         ║    │
│  ║  › Studio name cut off in header    FIXED ✓      ║    │
│  ╚══════════════════════════════════════════════════╝    │
├──────────────────────────────────────────────────────────┤
│  👤  MY ACCOUNT                                          │
│  Austin Jurgens · Owner · System Admin                   │
│  Home studio      Strongsville Ohio                      │
│  Also works at    Solon · Willoughby · Westlake          │
│  Mindbody staff   100000012              ● Linked        │
│                                        [ Sign out ]      │
├──────────────────────────────────────────────────────────┤
│  🏋  MY STUDIO — SOLON                                   │
│  22 machines · 6 trainers on the roster                  │
│  [ Open machine catalog › ]     [ Studio to-do › ]       │
└──────────────────────────────────────────────────────────┘
```

**Why this feels complete rather than gutted:**

- **My Account is read-only.** It shows the trainer their home studio,
  cross-training access and Mindbody link *without* letting them change any of
  it — those are Admin writes now (C). Read-only rows still make a page feel
  substantial, and they answer the questions trainers actually ask ("am I
  linked to Mindbody?", "why can't I see Solon's clients?") without a support
  message.
- **My Studio is two links, not a module.** It gives the page a third block and
  a route to the two places a trainer actually needs, without re-creating a
  settings surface.
- **Sign out lives here** (G). Removing the "Switch Trainer" button from the
  header is right — but a sign-out that exists *only* behind an avatar menu is
  a discoverability risk on a shared floor tablet where people switch
  constantly. Putting it on the account card costs nothing and gives the header
  menu a partner.

## 1.3 The bug reporter (B3) — what "prominently enhance" means

Today the reporter is a `<select>` and a `<textarea>` buried three clicks deep
in App Settings, and it captures `userAgent` and `platform`. That is the least
useful half of a bug report. Two changes:

**(a) It becomes global, not a page.** A `FeedbackDrawer` mounted once in
`AppContent`, opened from anywhere by:

| Entry point | Where | Why |
|---|---|---|
| 🐞 icon in the global header | next to the bell | always visible, one tap, on every screen |
| Hero card in Trainer Settings | the screen above | the deliberate, considered report |
| "Report this" on any error toast | wherever the app already surfaces a failure | catches the bug **at the moment it happens**, which is the only time the context is still true |

That third one is the highest-value entry point in the whole feature. A trainer
who hits an error mid-session will not walk to a settings screen afterwards and
reconstruct it — but they will tap a button that is already on the failure.

**(b) It captures context automatically.** The trainer describes the problem in
their own words; the app attaches what an engineer actually needs:

```
context: {
  view:        "active-session",       // currentView at open time
  studioId:    "solon",
  clientId:    "c_8842",               // only when a client screen is open
  sessionId:   "s_20260905_1730",
  viewport:    "1024x1366",            // catches iPad portrait-only bugs
  orientation: "portrait",
  theme:       "dark",
  appVersion:  "<build sha>",
  recentErrors: [ ...last 3 from the existing capped client error reporter ]
}
```

Nothing here is typed by the trainer. `recentErrors` reuses the capped client
error reporter you already shipped in `deploy-hardening`, so it costs one array
read.

**(c) Three kinds, one form.** `kind: "bug" | "ui" | "idea"`. You asked for
bugs, UI feedback *and* feature ideas — same collection, one field, so the Admin
Bug Reports tab can filter instead of you running three inboxes.

## 1.4 Question A — where does studio machine editing go?

> *"Propose whether this localized studio editing should remain as a lightweight
> shortcut in the Trainer settings or be moved entirely to the equipment catalog."*

**Move it entirely to the Catalog.** Do not keep a shortcut in Trainer Settings.

Three reasons:

1. **A shortcut re-creates the bloat you are deleting.** The moment Trainer
   Settings owns an editor — even a lightweight one — the next feature has a
   precedent to land there too. The screen stays thin only if it owns nothing.
2. **The Catalog is where the machines already are.** `MachineDetail` already
   renders Setup notes, Execution, Musculature, Contraindications, Upkeep and
   Studio notes for exactly one machine at exactly one studio. A studio's
   settings for that machine are the missing seventh section, not a separate
   destination.
3. **It matches the physical workflow.** A studio leader adjusting the gap
   range on the Hip Adduction is standing at the Hip Adduction. They open it in
   the Catalog. Making them remember that machine *settings* live under Settings
   while machine *everything else* lives under Catalog is a mental model split
   with no payoff.

So: a **"Studio setup"** section in `MachineDetail`, visible to
`isStudioLeader()` and above, writing the same `studioMachineSettings`
documents `TrainerMachineEditor` writes today. Trainers below that level see the
values, greyed, with no edit affordance — which is genuinely useful to them,
because "what is the studio standard gap" is a question they ask.

The Admin global Machine Editor (`AdminMachinesTab` → Catalog / Studio
Equipment) stays exactly as it is for cross-studio work.

## 1.5 Where each removed module lands

| | Module | Action | New home |
|---|---|---|---|
| **A** | Equipment Settings Setup | delete from trainer hub | Catalog → `MachineDetail` → **Studio setup** (leaders) · Admin → Machines (global) |
| **B2** | Interface Theme | delete outright | already in the top nav — no relocation |
| **B3** | Report a Bug | **keep + promote** | global drawer + Trainer Settings hero |
| **B4** | Historical Workout CSV | delete from trainer hub | Admin → **Data & Reports** → Legacy ingestion |
| **C** | Team Management | delete from trainer hub | Admin → Staff & Roles (gains studio-access + Mindbody staff editing) |
| **D** | Data & Reports | delete from trainer hub | Admin → **Data & Reports** (new tab) |
| **E** | Alerts & Comms | delete from trainer hub | Admin → Communications → **Alerts** (stays toggled off) |
| **F** | Integrations & Webhooks | delete button from trainer hub | Admin → System Backend → Mindbody (already exists) |
| **G** | Switch Trainer | delete button | avatar menu + My Account card |

**The one risk worth naming:** you chose hard-delete over role-gating. That is
cleaner, but `TrainerControlHubView.tsx` is 2,963 lines and serves trainers,
studio leaders and admins from one file with role filters. Deleting the trainer
paths means the leader/admin paths have to keep working through the same file
until Phase 4 finishes moving them. I am doing the delete and the relocation in
**adjacent commits** so there is never a commit where a working feature is
unreachable — and where the relocated code is already correct (the CSV importer,
the export generators), I am *moving* it rather than retyping it from zero.
Rewriting working export logic for its own sake would only add bugs.

---

# PART 2 — Studio Task & Communication Board

## 2.1 The one design decision everything else follows from

You described two things that feel like one thing:

- *"daily machine cleaning, taking out the trash, birthday calendar setups"* — a
  **checklist**. It repeats, it resets, it is the same every Tuesday, and the
  interesting question is *was it done today*.
- *"Can someone cover these clients for me?"* — a **conversation**. It happens
  once, it has replies, it is never done again, and the interesting question is
  *who answered*.

Modelling both as the same document is the trap. Today's model is
**template + instance**, and that split exists for exactly one reason: the list
has to reset without erasing who did what last Tuesday. A shift-cover request
never resets. Forcing it through a template with `recurrence: "once"` gives it a
recurrence engine it does not use, a shift it does not have, and no way to hold
a reply thread.

So: **two collections, one board.**

```
studios/{studioId}/
├── taskTemplates/{templateId}      ← EXISTS. "what should happen, how often"
├── taskInstances/{instanceId}      ← EXISTS. "one occurrence, on one day"
├── taskRequests/{requestId}        ← NEW.    "one ad-hoc ask, with replies"
│   └── replies/{replyId}           ← NEW.
└── taskCategories/{categoryId}     ← NEW.    "this studio's own labels"

trainers/{uid}/
├── taskTemplates/{templateId}      ← EXISTS. personal list
├── taskInstances/{instanceId}      ← EXISTS.
└── notifications/{notificationId}  ← NEW.    in-app inbox
```

The UI merges them into one list. The storage keeps them apart because they
have genuinely different lifecycles.

## 2.2 What gets added to the existing task model

### Claims — `TaskInstance`

```ts
interface TaskInstance {
  // ...everything that exists today...

  /** Soft claim. Advisory, never a lock — see below. */
  claimedBy?: { id: string; name: string } | null;
  claimedAt?: Timestamp | null;
}
```

**A claim is advisory, not a lock.** Anyone can still complete a task someone
else has claimed. This is deliberate: the alternative is a trainer claiming the
trash at 9am, getting pulled into a consultation, and the bin staying full
because the app told everyone else it was handled. A claim answers *"is someone
on this?"*, which is a coordination question, not a permissions question. The UI
shows `⏳ AJ has this` and still leaves the tick box live.

Claiming writes the instance document early — which looks like it breaks the
existing "nothing is written until someone acts" rule. It does not: **claiming
is acting.** The deterministic id still makes it safe if two trainers claim the
same task in the same second (last write wins, one document, no duplicates).

Claims die with the day. An instance is already per-`localDate`, so tomorrow's
row is a different document and starts unclaimed. Nothing to expire.

### Studio-defined categories

Today `TaskCategory` is a closed union of four. Your requirement —
*"must feel fluid and customizable, not rigidly confined to strict categories"* —
breaks that. The change:

```ts
/** Free-form. The four built-ins are seeds, not a whitelist. */
export type TaskCategory = string;

/** studios/{studioId}/taskCategories/{categoryId} */
export interface StudioTaskCategory {
  id: string;              // "cleaning", or "front-desk", or "aj-stuff"
  label: string;           // "Front desk"
  color?: string;          // brand-palette token
  order?: number;
  /**
   * The catch. useMachineUpkeep answers "when was this machine last
   * cleaned / serviced" by matching category === "cleaning" | "maintenance".
   * A studio that renames cleaning to "Wipe-down" would silently break that.
   * So a custom category can declare which upkeep question it answers.
   */
  upkeepRole?: "cleaning" | "maintenance";
}
```

Opening the union is a **one-line type change with a five-line consequence**,
and that consequence is the whole reason to think about it before typing:
`useMachineUpkeep` currently hard-matches the strings `"cleaning"` and
`"maintenance"`. Without `upkeepRole`, the first studio manager who renames a
category quietly empties the "Last cleaned" row on every machine in the
Catalog — a bug that would take a long time to trace back to a settings screen.
Existing documents keep working untouched: the four built-in ids stay valid and
map to themselves.

## 2.3 Requests — the new collection

```ts
/** studios/{studioId}/taskRequests/{requestId} */
export interface TaskRequest {
  id: string;
  studioId: string;

  /**
   * What kind of ask this is. Drives the icon and the default urgency,
   * nothing else — a request is deliberately loose.
   *   cover      "can someone take my 4pm?"
   *   question   "what's the deal with Client X's shoulder?"
   *   heads-up   "the AC is out in the back room"
   *   help       "need a hand moving the leg press"
   *   other
   */
  kind: "cover" | "question" | "heads-up" | "help" | "other";

  title: string;          // the post itself, one line
  detail?: string;

  /** Optional links that make a request actionable rather than chatty. */
  clientId?: string;      // "…regarding Client X's routine" → deep-links the profile
  machineId?: string;     // "…the leg press is making a noise" → flags the machine
  sessionDate?: string;   // studio-local YYYY-MM-DD, for cover requests

  createdBy: { id: string; name: string };
  createdAt: Timestamp;

  /** Same advisory-claim semantics as a task. */
  claimedBy?: { id: string; name: string } | null;
  claimedAt?: Timestamp | null;

  status: "open" | "resolved" | "cancelled";
  resolvedBy?: { id: string; name: string } | null;
  resolvedAt?: Timestamp | null;
  resolution?: string;    // "I've got the 4pm" — the closing note

  replyCount: number;     // denormalized so the list needs no subcollection read
  lastReplyAt?: Timestamp;

  /** Low-priority by default. This is the "floating" part. */
  priority: "low" | "normal" | "urgent";

  /** Auto-tidy: a resolved request drops off the board after this date. */
  expiresOn?: string;     // studio-local YYYY-MM-DD
}

/** studios/{studioId}/taskRequests/{requestId}/replies/{replyId} */
export interface TaskRequestReply {
  id: string;
  body: string;
  author: { id: string; name: string };
  createdAt: Timestamp;
}
```

**Why `replyCount` is denormalized:** the board renders every open request. If
the count lived only in the subcollection, drawing a list of 12 requests would
cost 12 extra reads on every snapshot. One integer, incremented on reply, and
the subcollection is read only when someone opens the thread.

**Why requests are not per-day:** a task belongs to a date; a request belongs to
the studio until someone deals with it. "Can anyone cover Thursday?" posted on
Tuesday must still be on the board on Wednesday. So requests are read by
`status == "open"`, not by `localDate`, and resolved ones age off via
`expiresOn`.

## 2.4 Notifications — in-app inbox

```ts
/** trainers/{uid}/notifications/{notificationId} */
export interface TrainerNotification {
  id: string;
  kind: "task-completed"      // your task got done
      | "request-claimed"     // someone picked up your request
      | "request-replied"     // someone answered your question
      | "request-resolved"
      | "machine-flagged";    // a machine you manage was reported broken

  title: string;              // "Michael completed 'Deep clean leg press'"
  body?: string;

  studioId: string;
  /** Where tapping it goes. */
  link: { view: string; id?: string };

  actor: { id: string; name: string };
  createdAt: Timestamp;
  readAt?: Timestamp | null;
}
```

**Written by the client, not a Cloud Function.** When Michael ticks a task, his
device writes one document into the creator's notification subcollection. This
keeps the whole feature function-free, exactly like the rest of `studio-tasks` —
no deploy step, no cold start, nothing to break in the Cloud Run pipeline that
has already given you trouble.

**The security consequence, stated plainly:** that means one trainer's device
writes into another trainer's document tree. The rule has to allow it, and a
sloppy rule here would let any authenticated user spam or read anyone's inbox.
So the rule is **create-only, self-read**:

```
match /trainers/{trainerId}/notifications/{notifId} {
  // Only the owner ever reads or updates (marks read) or deletes.
  allow read, update, delete: if request.auth.uid == trainerId;

  // Anyone signed in may CREATE one, but:
  //   - they must stamp themselves as the actor (no forging someone else)
  //   - the shape is validated (no arbitrary payloads)
  //   - it lands unread
  allow create: if request.auth != null
    && request.resource.data.actor.id == request.auth.uid
    && request.resource.data.kind is string
    && request.resource.data.title is string
    && request.resource.data.title.size() <= 200
    && request.resource.data.readAt == null;
}
```

No read access, no update access, no way to impersonate another actor. The worst
a bad actor can do is write a truthfully-attributed notification into someone's
inbox — which is what the feature is for.

**Notification is opt-out per template.** A studio with 40 daily cleaning tasks
would bury the creator. So `TaskTemplate` gains
`notifyCreatorOnComplete?: boolean`, **default false for recurring templates and
true for one-off tasks and requests**. Recurring trash duty does not need a
receipt; "restock the InBody paper before Thursday" does.

## 2.5 The complete Firestore map

```
studios/{studioId}/
  taskTemplates/{templateId}
    title, detail, kind, category, target, recurrence,
    timeOfDay, requiresNote, assigneeTrainerId, order, active,
    notifyCreatorOnComplete,            ← NEW
    createdAt/By, updatedAt/By

  taskInstances/{instanceId}            ← id = template:date:shift:machine
    templateId, localDate, shift, machineId,
    status, note, flagged,
    claimedBy, claimedAt,               ← NEW
    completedAt, completedBy,
    title, category, kind               (denormalized)

  taskRequests/{requestId}              ← NEW
    replies/{replyId}                   ← NEW

  taskCategories/{categoryId}           ← NEW

trainers/{uid}/
  taskTemplates/{templateId}            personal list
  taskInstances/{instanceId}
  notifications/{notificationId}        ← NEW
```

**Indexes needed:** one composite on `taskRequests` — `status ASC, createdAt DESC`.
Everything else is single-field equality, which Firestore indexes automatically.
That is deliberate: composite indexes have to be deployed, and a query that
fails on a missing index fails silently in the console and loudly on the floor.

---

## 2.6 User flow — a trainer's shift

**07:50 — arrival.** Opens the app. The bottom nav's **To-Do** tab carries a
badge: `4`. Four open items at Solon today.

**Board, top to bottom:**

```
┌─────────────────────────────────────────────────────────┐
│  STUDIO TO-DO — SOLON            Fri Sep 5      [ + ]   │
│  [ All ] [ Opening ] [ Anytime ] [ Closing ] [ Mine ]   │
├─────────────────────────────────────────────────────────┤
│  💬 REQUESTS                                        2   │  ← floating lane,
│  ┌───────────────────────────────────────────────────┐  │    always on top
│  │ 🔄 Can anyone cover my 4pm + 5pm Thursday?        │  │
│  │    Christian · 2h ago · 1 reply         [ Claim ] │  │
│  ├───────────────────────────────────────────────────┤  │
│  │ ❓ Anyone know why Ruth's hip adduction gap       │  │
│  │    keeps drifting?                                │  │
│  │    Michael · yesterday · 3 replies       [ Reply ]│  │
│  └───────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────┤
│  ☀ OPENING                                    1 of 3   │
│  ☑ Unlock + lights            Done · AJ 7:02            │
│  ☐ Wipe down all 22 machines             [ Claim ] [ ] │
│  ☐ Check InBody paper                    ⏳ Michael     │
├─────────────────────────────────────────────────────────┤
│  ● ANYTIME                                    0 of 2   │
│  ☐ Birthday calendar — week of Sep 8     [ Claim ] [ ] │
│  ☐ New lead outreach — 3 pending         [ Claim ] [ ] │
├─────────────────────────────────────────────────────────┤
│  🌙 CLOSING                                   0 of 2   │
└─────────────────────────────────────────────────────────┘
```

Requests sit **above** the checklist, not mixed into it. A shift-cover ask is
time-sensitive in a way that "take out the trash" is not, and burying it under
opening duties is how it gets missed.

**08:10 — claiming.** Taps `Claim` on "Wipe down all 22 machines". The row
becomes `⏳ You have this` and, on every other trainer's iPad, `⏳ AJ has this`.
The tick box stays live for everyone — the claim is a signal, not a lock.

**09:30 — the Catalog integration.** AJ is at the Leg Curl with the Catalog
open, checking a client's setup. Scrolls to **Upkeep**:

```
  UPKEEP
  ✨ Last cleaned    Sep 4 · Michael
  🔧 Last serviced   Aug 22 · AJ
  ─────────────────────────────────
  ☐ Wipe down          ⏳ You     [ ✓ ]  [ Note ]
```

One tap. **This does not create an ad-hoc record** — it completes *today's real
instance* of the studio's own cleaning template for this machine. The To-Do
board's "1 of 22" ticks up in real time on every device. If no cleaning task is
scheduled for this machine today, the card says so rather than inventing a
record that belongs to no checklist. (This is already built; the claim chip is
the only addition.)

If something is wrong, `Note` → *"Left pad seam splitting"* → **Flag**. That
sets `flagged: true`, and the machine now carries a red banner in the Catalog
for everyone, plus a `machine-flagged` notification to the studio leader.

**11:00 — a floating request.** AJ's 4pm cancels but his 5pm is a new consult he
wants covered. Taps `+` → the composer:

```
  ┌─ NEW ─────────────────────────────────────┐
  │  [ Task ]  [• Request ]                   │  ← one composer, two outputs
  │                                           │
  │  Kind   [🔄 Cover] [❓ Question]           │
  │         [📢 Heads-up] [🤝 Help] [• Other] │
  │                                           │
  │  "Can anyone take my 5pm consult today?"  │
  │                                           │
  │  Link a client   [ Ruth Kessler ▾ ]       │
  │  Link a machine  [ none ▾ ]               │
  │  Priority        [ Low ] [• Normal ]      │
  │                                     [Post]│
  └───────────────────────────────────────────┘
```

The Task / Request toggle is the only place a trainer meets the two-collection
split, and it reads as a natural choice ("is this a job or a question?") rather
than a technical one.

**11:04 — the notification.** Michael taps `Claim`. AJ's header bell shows `1`:
*"Michael claimed 'Can anyone take my 5pm consult today?'"*. Tapping it opens
the request thread. Nothing was emailed or texted.

**16:00 — daily schedule integration.** On the Hub's daily schedule, a session
whose client has an open linked request shows a small 💬 marker on the row —
so the trainer walking into Ruth's 4pm sees the unanswered question about her
hip adduction *before* the session, not after.

**19:45 — closing.** Filters to `Closing`, works down the list,
`Mark all done` on the group. Each completion with
`notifyCreatorOnComplete` writes one notification to whoever created that
template. Recurring closing duties have it off by default, so the studio leader
does not get seven receipts a night.

## 2.7 The studio manager who does not train

You called this out specifically, and it changes one thing: **a board filtered
to "today at this studio" is the wrong default for someone who never sets foot
on the floor.** They think in weeks and in people, not in shifts.

So the board gets a second view, toggled in the header, available to
`isStudioLeader()` and above:

```
  [ ☰ Board ]  [ ▤ Manage ]
```

**Manage** is not a different feature — same documents, different question:

- **Templates** — author and edit the recurring workflows (this is
  `TaskManager`, which already exists, moved behind this toggle)
- **Compliance** — a 7 / 30-day grid: rows are templates, columns are days,
  cells are done / missed / flagged. Answers "is closing actually getting
  done on Sundays?", which is the question a manager has and a trainer does not.
- **Open requests** — everything unresolved, oldest first, so nothing floats
  forever.
- **Flagged machines** — every machine with an open flag, with the note and who
  raised it.

`Board` stays the default for everyone; `Manage` is where the non-training
manager lives. Same data, no second data model.

---

## 3. Build order — one commit per phase

| # | Phase | Files |
|---|---|---|
| 1 | Global feedback drawer + context capture (B3) | `features/feedback/*`, `AppContent.tsx` header |
| 2 | Lean `TrainerSettingsView` | `features/settings/TrainerSettingsView.tsx` |
| 3 | Hard-delete A/B2/B4/C/D/E/F/G | `components/TrainerControlHubView.tsx` |
| 4 | Relocate into Admin Dashboard | `components/AdminDashboardView.tsx`, `components/admin/*` |
| 5 | Catalog "Studio setup" section (answers A) | `features/catalog/MachineDetail.tsx` |
| 6 | Claims + studio categories | `features/studio-tasks/types.ts`, `mutations.ts` |
| 7 | Requests + replies | `features/studio-tasks/requests.ts`, `RequestCard.tsx` |
| 8 | In-app notification inbox | `features/notifications/*` |
| 9 | Unified board UI + Manage view | `features/studio-tasks/StudioTasksView.tsx` |
| 10 | Rules, indexes, tests | `firestore.rules`, `firestore.indexes.json` |

Each phase is its own commit, so any single phase can be reverted without
touching the others.
