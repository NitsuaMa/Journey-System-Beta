# Trainer Profile + Kaizen Roster

Round: Trainer Dossier, Sep 2026.
Replaces `src/components/TrainerProfileView.tsx` (617 lines, one file, a
hardcoded navy background and a military vocabulary nothing else in the app
shares).

The old page answered "what does the system know about this person". The new
one answers the two questions a trainer actually opens a profile with:
**"how much are they carrying"** and **"who are they working on"**.

---

## 1. Three problems, and only one of them was design

### 1.1 "Total Ops Vol: 0 Logged Sessions" was structural

`useSessions` loads **24 hours of sessions for one studio**:

```ts
where("createdAt", ">=", Timestamp.fromDate(twentyFourHoursAgo)),
where("hostedAtStudioId", "==", activeStudioId)
```

That is the right query for the Hub — nobody wants 40,000 session documents
streaming into a tablet — but the profile counted that array and called it a
career total. It was never going to be anything but 0 on a quiet day. Same
reason "Recently Logged" showed "No recent activity recorded." for a trainer
who had worked all week: true of the loaded window, false of the trainer.

Counting server-side at read time would be worse: every profile open would
read every session that trainer had ever coached. So the count happens **once,
at the moment a session completes**, in `functions/src/trainerRollups.ts`, and
the profile reads the answer.

### 1.2 The dossier was hardcoded because nothing wrote to it

`bio`, `certifications` and `employmentStartDate` were already on `Trainer`.
No editor in the app had ever written them, so every trainer fell to the same
three placeholders. Two of them read as data rather than as absence — "Level 1
Practitioner" looked like a qualification somebody had recorded. The fields
now have inputs (`EditTrainerModal`), and the empty states say plainly that
nothing is recorded.

### 1.3 The voice

"Tactical Command Center", "Combat Grade Certifications", "Total Ops Vol",
"Station Access (Permanent)", "Guest Credentials (Temporary)", "No Active
Guest Ops". The Equipment tab, Journey Grid, Journal and Client Dossier are
plain, dense and calm. This is now too.

---

## 2. Layout

```
┌──────────────────────────────────────────────────────────────────────────┐
│ [photo]  AUSTIN JURGENS  "AJ"            ▸ Edit profile  ▸ Studio cal.   │
│          Franchise Owner · Solon · AJ · Mindbody synced                  │
├──────────────────────────────────────────────────────────────────────────┤
│ COACHING LOAD                              Last session 2 days ago       │
│   1,284 Sessions coached │ 63 Last 30 days │ 41 Clients │ 14.2 Per week   │
├────────────────────────────────┬─────────────────────────────────────────┤
│ ABOUT                          │ STUDIO ACCESS                           │
│  bio · certifications · started│  Home · Also works at · Cross-train     │
├──────────────────────────────────────────────────────────────────────────┤
│ ◈ KAIZEN ROSTER                                        12 tracked        │
│   Progression 5 · Form 4 · Return 3                                      │
│   ◈ Judy Daus     Next Tue · watching hip depth      [Progression]  ×    │
├────────────────────────────────┬─────────────────────────────────────────┤
│ UPCOMING · 6 booked            │ RECENTLY COACHED · last 30 days         │
└────────────────────────────────┴─────────────────────────────────────────┘
```

The Kaizen Roster sits **above** the schedule deliberately. The schedule
answers "what is next"; the roster answers "who am I actually working on",
and the second question is the one a profile page exists for.

Portrait stacks in the same order. Tokens are lifted unchanged from
`equipment.tokens.css` — the brief was "match the rest of the application",
and inventing a ninth set of near-identical greys is how you fail that.

---

## 3. Who sees what — `visibility.ts`

Trainers can now open each other's profiles, so one rule runs through all of
it:

> **Client names require a shared studio.**

Certifications, tenure and session counts are professional credentials and
travel company-wide. The Kaizen Roster, upcoming schedule and recently-coached
list are lists of clients, and a trainer at another location has no business
reading them.

| Scope | Who | Adds |
| --- | --- | --- |
| `outside` | no studio in common | identity, about, tenure, coaching load, studio access |
| `peer` | shares a studio | roster, upcoming, recently coached |
| `leadership` | can already edit this person | contact details, Mindbody integration state, Edit |
| `self` | you | everything |

Studio Leaders and Head Trainers are leadership **only where they share a
studio** — the same distinction `isStudioOwnerOrHeadTrainer` draws in
`firestore.rules`, kept in step so the UI never offers an affordance the rules
would refuse. Firestore rules are what actually protect the data (trainer
documents are readable by any authenticated user, which is what makes a
team-visible roster work at all); this module decides what is worth putting on
screen.

---

## 4. The Kaizen Roster

Up to **40** clients a trainer has decided to work on, each with a reason, an
optional note and an optional date to check back on.

### 4.1 The colour rule — do not undo this

The **red kaizen mark means "this rep needs work"** in the session grid
(`journey-grid/QualityMark.tsx`). The roster **never** borrows it.

- `KaizenMark.tsx` is drawn here rather than imported, and has **no prop that
  could make it red**.
- Roster colour is `--tp-kaizen` (action blue) and `--tp-kaizen-quiet` (brand
  slate). `--tp-alert` exists for genuine alerts and is not for roster use.
- The small glyph on a client row is slate, a sibling of the note indicator,
  not of a quality mark.

If a glance at a client card cannot separate *"I am tracking you"* from
*"you are doing it wrong"*, the roster is worse than useless.

### 4.2 Decisions

**Reason is required, nothing pre-selected.** A reason nobody chose is a
reason nobody meant, and it is the field that turns a list of names into a
plan. The one exception is the client-header toggle, which uses `Progression`
by default — a trainer mid-conversation should not be handed a form, and the
reason is editable on the profile afterwards.

**Sorted due-first, then most recently added.** Deliberately not alphabetical:
a working list answers "who did I say I would check back on" and "who am I
thinking about", and a name sort answers neither.

**Removal has no confirmation.** It is a bookmark, not a record, and it goes
back in one tap.

**Nobody is notified, ever.** Adding someone to your own working list is not
an event anyone needs told about, and the Sep 4 freeze on contacting clients
and trainers stands.

### 4.3 Why an array on the trainer document

`useTrainers` already streams every trainer document to every device. Putting
the roster there means membership badges work everywhere — client list, client
header, calendar — for **zero extra reads**. Forty entries is ~8 KB against a
1 MB document limit. A subcollection would be right at 500 entries; at 40 it
is a second listener for nothing.

Written with `updateDoc` on the whole array rather than
`arrayUnion`/`arrayRemove`: `arrayRemove` needs a byte-exact object match to
find an element, and `serverTimestamp()` cannot be written inside an array at
all, so `addedAt` is a client-clock `Timestamp` either way. A device with a
wrong clock misorders its own roster and nothing else. Safe to rewrite
wholesale because a roster has exactly one writer — `firestore.rules` only
lets a trainer write their own.

---

## 5. Where the numbers come from

| Field | Written by | When |
| --- | --- | --- |
| `rollups.sessionsCoached` | `onSessionRollup` | the moment a session completes |
| `rollups.lastSessionAt` | `onSessionRollup` | same |
| `rollups.sessionsCoached30d/90d`, `clientsCoached90d`, `avgPerWeek` | `recalcTrainerWindows` | nightly, 03:00 ET |
| `rollups.rollupVersion`, `firstSessionAt` | `backfillTrainerRollups` | once, by an admin |

The trigger owns the lifetime counter and touches nothing else, so the nightly
job can rewrite every window field without racing it. `rollupCounted` on the
session — not the status change — is what makes it safe: Cloud Functions
deliver **at least once**, and the flag is what stops a redelivery inflating
the count. Reopening or deleting a counted session reverses it, clamped at
zero.

**Before the backfill runs, `lifetime` is `null` and the headline falls back
to the 30-day figure.** A counter that started at deploy time, labelled
"Sessions Coached", would be a wrong number presented confidently. A
backfilled trainer with no sessions shows `0` — a new hire has genuinely
coached zero, and that is a fact rather than missing data.

`useRecentlyCoached` fetches one trainer's last 30 days once on open — a
`getDocs`, not a listener, because a profile is a page you look at rather than
a screen you work from — and merges the loaded 24-hour window so a session
finished thirty seconds ago still appears. It needs the composite index
`sessions(trainerId ASC, createdAt DESC)`.

---

## 6. Mindbody staff sync

`functions/src/mindbody/staffResolver.ts` + `staffProfile.ts`, wired into the
webhook's new `staff.*` branch. Two rules:

**A webhook never creates a trainer document.** `ensureCanonicalClient` may
create a client, and that is safe — a client document grants nothing. A
trainer document is an RBAC principal carrying `role`, `pinHash` and studio
access. Unmatched staff waits in `mindbodyLimbo` for a human to link it.

**The sync writes only the nested `mindbody` map.** Role, studio access,
`bio`, `certifications`, `kaizenRoster` and `rollups` are out of reach by
construction rather than by review. Deactivation is *reported*, never
*enforced*: `mindbody.isActive` goes false and the profile says so, but a
mis-mapped staff id must not lock a trainer out mid-session.

Trainers resolve by **field query**, not doc id, because a trainer document id
is the Firebase Auth uid. The resolver queries both the string and the number
form of the staff id: older documents stored it numerically and Firestore's
`==` is type-strict.

Photos come from the cheapest source that has them — the bulk
`/staff/staff?Limit=200` call the pickers already make returns `ImageUrl` for
the whole roster. `GET /staff/{staffId}/imageurl` is one round trip per person
and is used only for a deliberate refresh and the weekly sweep, behind a
7-day TTL. **Initials are the primary avatar everywhere**; most Max Strength
staff have no Mindbody photo, and that is not a degraded state.

---

## 7. Files

| File | Job |
| --- | --- |
| `TrainerProfileView.tsx` | shell, layout, visibility gating |
| `IdentityBar.tsx` | avatar, name, role chips, actions |
| `CoachingLoad.tsx` | the four numbers |
| `AboutPanel.tsx` | bio, certifications, tenure, contact |
| `StudioAccessPanel.tsx` | home, also works at, cross-train |
| `KaizenRoster.tsx` / `KaizenRosterRow.tsx` / `AddToRosterDialog.tsx` | the roster |
| `KaizenMark.tsx` | the mark, blue/slate, never red |
| `TodaySchedule.tsx` / `RecentlyCoached.tsx` | client-facing lists |
| `TrainerAvatarImage.tsx` | initials first, photo layered over |
| `visibility.ts` | who sees what (tested) |
| `stats.ts` | reading the counters (tested) |
| `roster.ts` | cap, de-dupe, sort (tested) |
| `adapters.ts` | schedule/session view models |
| `useKaizenRoster.ts` | roster mutations |
| `useRecentlyCoached.ts` | the 30-day fetch |
| `trainer-profile.tokens.css` | light + dark, AA, incl. the kaizen pair |

---

## 8. Before this ships

1. `firebase deploy --only firestore:indexes` — `sessions(trainerId, createdAt desc)` or the recently-coached list comes back empty.
2. `firebase deploy --only firestore:rules` — `rollups` and `mindbody` become server-write-only and `kaizenRoster` becomes owner-only.
3. `firebase deploy --only functions` — it will offer to delete `issueMindbodyUserToken`; say yes, it was dead code carrying credentials.
4. Run **Rebuild trainer rollups** once, from Admin › System Backend › System Tools, outside studio hours.
5. Only then `node register-webhook.js`, which adds `staff.created/updated/deactivated` to the live subscription. Real staff events start arriving the moment it succeeds.
