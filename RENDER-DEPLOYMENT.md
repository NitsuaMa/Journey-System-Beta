# Deploying the Journey System on Render

Everything Render needs is in `render.yaml`. This file is the human half: what
each service is for, the order to do things in, and the handful of errors that
are actually going to happen.

**Nothing in the live blueprint can contact a client or a trainer.** The
notification pipeline is built and committed but deliberately not deployed -
see [Later: turning notifications on](#later-turning-notifications-on) at the
bottom, which is the only part of this document that could put a message in
front of anyone.

---

## What you are adding

You have one service today: the web app at `maxstrength-app-beta.onrender.com`.
You are adding one more, and putting both under one file in git.

| Service | Type | What it does | Contacts anyone? | Cost |
|---|---|---|---|---|
| `maxstrength-app-beta` | Web | The app. Unchanged, just described in the file now. | No | $25/mo |
| `journey-cron-leaderboards` | Cron, 3am ET | Rebuilds `leaderboards/global` and `leaderboards/studio_<id>` from every exercise log. | **No** | ~$1/mo |

That is ~$26/mo of services, plus the $25/mo workspace plan.

Written, committed, and **not deployed**: the background worker and the daily
reminder / Sunday coach-report cron jobs. They are commented out in
`render.yaml` with everything they need already filled in.

Also not included: **Postgres** and **Key Value**. The reasoning is written into
`render.yaml` next to each commented block. Short version: nothing in this
codebase can talk to either one, and Firestore is already doing the job the
plan assigns to Postgres.

### What is unchanged, and worth knowing

`functions/src/index.ts` has two Cloud Functions writing into the
`notificationQueue` collection - `onBookingReminderWrite` on every booking for
a reminders-enabled studio, and `sendDailySummary` each morning. Nothing has
ever read those documents back out.

That does not change here. They keep accumulating in Firestore, harmlessly,
exactly as they have been. Deploying the worker is what would give them a
reader, and the worker is not being deployed. Nothing in this blueprint alters
what any studio, coach or client experiences today.

---

## Step 1 - Get a Firebase service account key

The cron job talks to Firestore as the server, not as a signed-in trainer, so
it needs its own credential. Your web service has never needed one because it
never touches Firestore.

1. [Firebase console](https://console.firebase.google.com/) → your project
2. Gear icon → **Project settings** → **Service accounts**
3. **Generate new private key** → confirm. A `.json` file downloads.

Treat that file the way you would treat the keys to the studio. It bypasses
every rule in `firestore.rules`.

Now turn it into one line, because Render's environment editor will happily eat
a newline out of the middle of a private key and the failure it produces
(`DECODER routines::unsupported`) tells you nothing. In PowerShell:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\to\your-key.json")) | Set-Clipboard
```

That is now on your clipboard. `server/firebase-admin.ts` accepts either the
base64 or the raw JSON, so if you skip this and paste the file's contents
directly it still works - it is just more fragile.

---

## Step 2 - Get the branch onto GitHub

```bash
git push -u origin render-infrastructure
```

Render reads `render.yaml` from the branch each service names. Both services in
the file say `branch: master`, so **merge to `master` before you sync the
blueprint** - or change those two `branch:` lines to `render-infrastructure`
first if you would rather try it on the branch. Do not do half of each; a
blueprint pointing at a branch that lacks the file just fails.

---

## Step 3 - Create the blueprint

1. Render dashboard → **New +** → **Blueprint**
2. Pick this repository
3. Render reads `render.yaml` and lists what it is about to do

**Read that list before approving.** You want to see your existing web service
being *updated*, and exactly one cron job being *created*. If it offers to
create a second web service, the name in `render.yaml` no longer matches the
real one - fix the name, do not proceed. Render matches by name and nothing
else, and two web services both serving the app is a confusing afternoon.

**A note on region.** `render.yaml` leaves `region` unset everywhere, so the
cron job is created in Render's default, Oregon. If your web service lives
elsewhere that is a split-region deployment, which is harmless here - the cron
talks to Firestore over the public internet and never to the web service. It
would only matter if you later switch on Key Value or Postgres, which use
Render's private network. Region cannot be changed after creation, so if you
think either is coming, look up the web service's region now (dashboard →
service → Settings) and add `region: <that one>` to the cron before syncing.

Render will then prompt for every `sync: false` value it does not already have.
There is no shared env group, because Render does not allow a `sync: false`
variable inside one - so each service carries its own list.

**On the web service** (most of these are already set on the live service, and
Render leaves existing values alone - but have them to hand): the eight
`VITE_FIREBASE_*` values from your local `.env`, plus `GEMINI_API_KEY`,
`MINDBODY_API_KEY`, `MINDBODY_SOURCE_NAME`, `MINDBODY_SOURCE_PASSWORD`,
`MINDBODY_WEBHOOK_SECRET`, `VITE_MICROSOFT_TENANT_ID`.

**On the cron job** - three values:

| Variable | Value |
|---|---|
| `VITE_FIREBASE_PROJECT_ID` | same as your `.env` |
| `VITE_FIREBASE_FIRESTORE_DATABASE_ID` | same as your `.env` |
| `FIREBASE_SERVICE_ACCOUNT` | the base64 string from Step 1 |

The cron does not get the other five Firebase values, and no Mindbody or Gemini
keys. Those exist to be baked into the browser bundle or used by the API
routes; a cron job has no browser and serves no requests. Fewer copies of a
secret is fewer places it can leak from.

`VITE_FIREBASE_FIRESTORE_DATABASE_ID` is the one to get right. This project
does not use Firestore's `(default)` database. Point a service at the wrong one
and it reads an empty database and reports no error at all.

---

## Step 4 - Check it works

The cron will not run until 3am, so do not wait for it. Open
`journey-cron-leaderboards` → **Trigger Run** → watch the log. Healthy looks
like:

```
[cron-leaderboards] started 2026-09-04T...
[firebase-admin] Firestore ready (project=..., database=...)
[LeaderboardCron-xxxxx] Fetching active clients...
[LeaderboardCron-xxxxx] Processing N logs...
[LeaderboardCron-xxxxx] Calculation complete and saved.
[cron-leaderboards] finished OK in 12.3s
```

Check the `database=` on that second line against your `.env`. If it says
`(default)` the job will run happily and find nothing.

This is a safe thing to trigger by hand as often as you like: it only writes
`leaderboards/*`, which it rebuilds from scratch every night regardless.

If you see a warning that `leaderboards/global` is approaching 1 MB, that is
worth telling me about - Firestore rejects documents over 1 MiB, and the fix
(sharding the leaderboard per machine) wants doing before it starts failing at
3am rather than after.

---

## Which command runs where, and why

| npm script | Used by | Notes |
|---|---|---|
| `npm run build` | Web only | Vite front end **plus** `dist/server.cjs`. |
| `npm start` | Web only | `node dist/server.cjs`. |
| `npm run build:backend` | The cron (and the parked services) | Backend entry points only - **no Vite**. |
| `npm run cron:leaderboards` | Nightly cron | Wraps the existing `calculateLeaderboards()`. |
| `npm run start:worker` | *parked* | Long-running; restarts if it exits. |
| `npm run cron:reminders` | *parked* | |
| `npm run cron:coach-report` | *parked* | |

Two things about that table are load-bearing:

**The cron must not run `npm run build`.** It has no front end. Running Vite on
it adds about ten seconds to *every single run* - and cron is billed by the
minute.

**`build:backend` does not generate `firebase-applet-config.json`.** That file
is gitignored and exists to feed the browser bundle; the backend services read
their project and database ids straight from their environment variables
instead, which is why they each need those two set.

---

## The errors you are actually going to hit

**`Could not load the default credentials`**
`FIREBASE_SERVICE_ACCOUNT` is missing from that service. Note it throws on the
first Firestore *read*, not at startup, so the service can look healthy for a
while first.

**`error:1E08010C:DECODER routines::unsupported`**
The private key's newlines got mangled on paste. Use the base64 form from
Step 1.

**The job runs, finds nothing, and everything looks fine**
Almost always `VITE_FIREBASE_FIRESTORE_DATABASE_ID` - it is reading
`(default)`, which is empty. Check the `[firebase-admin] Firestore ready` line
in the log; it prints the database it opened.

**`vite: not found` during a build**
Something set `NODE_ENV=production`, so `npm ci` skipped devDependencies and
took Vite and esbuild with them. Express does not need that variable. Remove
it.

**The cron ran an hour later than you expected**
Render's schedules are UTC and do not move for daylight saving, so 3am Eastern
becomes 2am Eastern in winter. Shift the `schedule:` line by an hour when the
clocks change, or leave it - nobody is awake either way.

---

## Later: turning notifications on

**Everything below this line is switched off.** Read it when the studio is
ready to send something; ignore it until then.

Three gates stand between the current state and a client receiving a message,
and all three have to be opened deliberately:

1. **The services are not deployed.** The worker and the two notification cron
   jobs are commented out in `render.yaml`.
2. **Dry run is on.** `NOTIFICATION_DRY_RUN=true` means the worker logs exactly
   what it would send and parks each document as `dry_run` - not `sent`, so
   nothing is silently consumed and the backlog can be replayed.
3. **There is no provider.** No SMS or email SDK is installed, and `deliver()`
   in `server/worker.ts` throws if asked to send for real.

When the time comes, in this order:

1. Uncomment the three blocks in `render.yaml` and sync. Give each service the
   same three Firebase variables the leaderboard cron gets.
2. Watch the worker's log against the existing backlog with dry run still on.
   Expect a mix of `DRY RUN ... would send ...` and
   `skipped ... session is 412h away ...` - the second is `onBookingReminderWrite`'s
   booking-time documents, which are not day-of reminders and are correctly
   refused.
3. Prove the daily cron end to end. Reminders are opt-in per studio and the log
   says so: `2 of 5 studio(s) have notificationSettings.bookingRemindersEnabled
   = true`. If that reads `0 of 5`, the job is working perfectly and every
   studio has the box unticked. Set the flag on **one** studio, trigger the
   cron, and watch the worker pick each document up within a second or two -
   including whether that client has a phone or email on file at all.
   Trigger it a second time: it should report everything as *already queued*
   and write nothing new.
4. Only then pick a provider (Twilio for SMS, SendGrid or Resend for email),
   `npm install` it, and fill in the spots marked
   `>>> WIRE A PROVIDER IN HERE <<<`. Pass the notification's document id as
   the provider's idempotency key if it supports one - if a send succeeds but
   the write recording it fails, the stuck-document sweep will retry, and that
   key is the only thing standing between that and a second text.
5. Decide what to do with the `dry_run` backlog: replay what still matters by
   setting those documents back to `status: "queued"`, or leave them.
6. **Last**, set `NOTIFICATION_DRY_RUN` to `false`.

Do not reorder those. Flipping the flag before a provider exists makes every
notification fail on the spot.

Two guards worth knowing about, because they are not obvious from the outside:
the cron writes each reminder at a fixed document id per booking per day, so it
cannot duplicate its own work; and the worker separately checks for an
already-delivered sibling before sending, because the Cloud Function and the
cron can both describe the same session. Two producers, two different guards -
neither one covers the other.

---

## Rolling back

Each phase of this work is its own commit on `render-infrastructure`, so any
one can be reverted without the others:

```bash
git log --oneline render-infrastructure   # find the phase
git revert <sha>
```

On the Render side, deleting the cron job costs nothing but the minutes already
used and leaves the web service exactly as it is now. Nothing in this branch
changes how the app behaves for anyone using it - the web service's build,
start command and health check are all unchanged from what it runs today.
