# Deploying the Journey System on Render

Everything Render needs is in `render.yaml`. This file is the human half: what
each service is for, the order to do things in, and the handful of errors that
are actually going to happen.

---

## What you are adding

You have one service today: the web app at `maxstrength-app-beta.onrender.com`.
You are adding four more, and putting all five under one file in git.

| Service | Type | What it does | Cost |
|---|---|---|---|
| `maxstrength-app-beta` | Web | The app. Unchanged, just described in the file now. | $25/mo |
| `journey-worker` | Worker | Watches `notificationQueue` and does the sending. | $7/mo |
| `journey-cron-daily-reminders` | Cron, 7am ET | Queues a reminder for every client booked today. | pennies |
| `journey-cron-coach-report` | Cron, Sun 8pm ET | Queues each coach a summary of their week. | pennies |
| `journey-cron-leaderboards` | Cron, 3am ET | Runs the leaderboard maths already in `server/leaderboard-cron.ts`. | pennies |

Not included, on purpose: **Postgres** and **Key Value**. The reasoning is
written into `render.yaml` next to each commented block. Short version: nothing
in this codebase can talk to either one yet, and Firestore is already doing the
job the plan assigns to Postgres.

### The one thing you should know before anything else

**The worker is not speculative, and its first run needs care.**
`functions/src/index.ts` has two functions writing into `notificationQueue`
already, and nothing has ever read them back out:

- `onBookingReminderWrite` files a `booking_reminder` the *instant a booking is
  created* - for a session that might be three weeks away.
- `sendDailySummary` files a `daily_summary` per studio at 6am ET.

So if reminders have been enabled for any studio for a while, there is a pile
of documents sitting in that collection right now, and a naive worker turned
loose on it would text every client who has a future booking - about a session
they have not got to yet. Two guards in `server/worker.ts` exist for exactly
this:

- a reminder for a session more than `REMINDER_WINDOW_HOURS` (24) away is
  **skipped**, not sent - the daily cron queues the real day-of reminder
- before sending, it checks whether another queued document for the same
  booking was already delivered, because the Cloud Function and the cron can
  both describe the same session

And the whole thing ships with `NOTIFICATION_DRY_RUN=true`, which sends
nothing at all. Do not turn that off on day one.

---

## Step 1 - Get a Firebase service account key

The worker and the crons talk to Firestore as the server, not as a signed-in
trainer, so they need their own credential. Your web service has never needed
one because it never touches Firestore.

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

Render reads `render.yaml` from the branch each service names. Every service in
the file says `branch: master`, so **merge to `master` before you sync the
blueprint** - or change those five `branch:` lines to `render-infrastructure`
first if you would rather try it on the branch. Do not do half of each; a
blueprint pointing at a branch that lacks the file just fails.

---

## Step 3 - Create the blueprint

1. Render dashboard → **New +** → **Blueprint**
2. Pick this repository
3. Render reads `render.yaml` and lists what it is about to do

**Read that list before approving.** You want to see your existing web service
being *updated*, and four services being *created*. If it offers to create a
fifth new web service, the name in `render.yaml` no longer matches the real one
- fix the name, do not proceed. Render matches by name and nothing else, and
two web services both serving the app is a confusing afternoon.

**Before you approve: check the region.** Every service in `render.yaml` leaves
`region` unset, so the four new ones will be created in Render's default,
Oregon. If your web service lives somewhere else that is a split-region
deployment - harmless today (nothing here talks to anything but Firestore), but
region cannot be changed later, and it would matter if you ever switch on Key
Value or Postgres. If you think you might, look up the web service's region now
and add `region: <that one>` to the four new services first.

Render will then prompt for every `sync: false` value it does not already
have. There is no shared env group here, because Render does not allow a
`sync: false` variable inside one - so each service carries its own list.

**On the web service** (most of these are already set on the live service, and
Render leaves existing values alone - but have them to hand): the eight
`VITE_FIREBASE_*` values from your local `.env`, plus `GEMINI_API_KEY`,
`MINDBODY_API_KEY`, `MINDBODY_SOURCE_NAME`, `MINDBODY_SOURCE_PASSWORD`,
`MINDBODY_WEBHOOK_SECRET`, `VITE_MICROSOFT_TENANT_ID`.

**On the worker and each of the three crons** - three values each:

| Variable | Value |
|---|---|
| `VITE_FIREBASE_PROJECT_ID` | same as your `.env` |
| `VITE_FIREBASE_FIRESTORE_DATABASE_ID` | same as your `.env` |
| `FIREBASE_SERVICE_ACCOUNT` | the base64 string from Step 1 |

The backend services do not get the other five Firebase values, and they do not
get any Mindbody or Gemini keys. Those exist to be baked into the browser
bundle or used by the API routes; a worker has no browser and serves no
requests. Fewer copies of a secret is fewer places it can leak from.

`VITE_FIREBASE_FIRESTORE_DATABASE_ID` is the one to get right. This project
does not use Firestore's `(default)` database. Point a service at the wrong one
and it reads an empty database and reports no error at all.

---

## Step 4 - Check each service actually came up

**Worker** (`journey-worker` → Logs). Healthy looks like:

```
[firebase-admin] Firestore ready (project=..., database=...)
[worker] watching notificationQueue (batch=25, maxAttempts=5, dryRun=true)
```

If anything is queued, expect it to work through the backlog immediately,
logging one line per document. Nothing leaves the building. Expect a mix of:

- `DRY RUN ... would send ...` - a document it would have delivered, parked as
  `status: "dry_run"`
- `skipped ... session is 412h away ...` - a booking-time reminder for a
  session too far off to remind anyone about
- `FAILED ... No handler for notification type "x"` - only if some other
  producer exists that this worker does not know about, and worth telling me
  about if you see one

`dry_run` is deliberately not `sent`. The documents stay distinguishable, so
the backlog can be replayed later by flipping them back to `queued` rather
than being quietly consumed by a test.

**Crons.** They will not run until their scheduled time, so do not wait.
Open one → **Trigger Run** → watch the log. The leaderboard job is the safest
to try first: it only writes to `leaderboards/*`, which is a derived
collection it rebuilds from scratch every night anyway.

---

## Step 5 - Test the reminder pipeline end to end

Reminders are opt-in per studio, and the cron log tells you the count:

```
[reminders] 2 of 5 studio(s) have notificationSettings.bookingRemindersEnabled = true
```

If that says 0 of 5, the job is working perfectly and every studio has the box
unticked. Set `notificationSettings.bookingRemindersEnabled = true` on **one**
studio document in Firestore, then:

1. Trigger `journey-cron-daily-reminders` by hand
2. Its log tells you how many it queued
3. Look at `journey-worker`'s log - within a second or two it should pick each
   one up and print exactly what it would have sent, including whether that
   client has a phone or email on file at all
4. Look at the `notificationQueue` collection: those documents are now
   `status: "sent"` with a `result` field saying `dry-run: ...`

Trigger the cron a second time. It should report everything as *already
queued* and write nothing new - reminders use a fixed document id per booking
per day, so the cron cannot duplicate its own work.

That covers the cron duplicating itself. The other direction - the Cloud
Function and the cron both describing one session - is handled in the worker,
which checks for an already-delivered sibling before it sends. Two producers,
two different guards; neither one covers the other.

That is the whole pipeline proven, with nothing having reached a client.

---

## Step 6 - When you are ready to actually send

Nothing here is wired to a provider, because you have not picked one. When you
do:

1. `npm install` the provider's SDK (Twilio for SMS, SendGrid or Resend for
   email)
2. Fill in the two spots marked `>>> WIRE A PROVIDER IN HERE <<<` in
   `server/worker.ts`
3. Add the provider's API key to the worker as a `sync: false` env var
4. Decide what to do with the `dry_run` backlog - replay what still matters by
   setting those documents back to `status: "queued"`, or leave them
5. **Then** set `NOTIFICATION_DRY_RUN` to `false` on the worker

Do them in that order. Flipping the flag first makes every notification fail
on the spot.

One thing to pass the provider when you get there: the notification's document
id, as an idempotency key if it supports one. If a send succeeds but the write
recording it fails, the sweep will eventually retry that document - an
idempotency key is what stops the client getting a second message.

---

## Which command runs where, and why

| npm script | Used by | Notes |
|---|---|---|
| `npm run build` | Web only | Vite front end **plus** `dist/server.cjs`. |
| `npm start` | Web only | `node dist/server.cjs`. |
| `npm run build:backend` | Worker + all crons | Backend entry points only - **no Vite**. |
| `npm run start:worker` | Worker | Long-running; restarts if it exits. |
| `npm run cron:reminders` | Daily cron | Runs, exits 0, service stops. |
| `npm run cron:coach-report` | Sunday cron | |
| `npm run cron:leaderboards` | Nightly cron | Wraps the existing `calculateLeaderboards()`. |

Two things about that table are load-bearing:

**The worker and crons must not run `npm run build`.** They have no front end.
Running Vite on them adds about ten seconds to every worker deploy and to
*every single cron run* - and cron is billed by the minute.

**`build:backend` does not generate `firebase-applet-config.json`.** That file
is gitignored and exists to feed the browser bundle; the backend services read
their project and database ids straight from their environment variables
instead, which is why they each need those two set.

---

## The errors you are actually going to hit

**`Could not load the default credentials`**
`FIREBASE_SERVICE_ACCOUNT` is missing from that service, or the group is not
attached to it. Note it throws on the first Firestore *read*, not at startup,
so the service can look healthy for a while first.

**`error:1E08010C:DECODER routines::unsupported`**
The private key's newlines got mangled on paste. Use the base64 form from
Step 1.

**The job runs, finds nothing, and everything looks fine**
Almost always `VITE_FIREBASE_FIRESTORE_DATABASE_ID` - it is reading
`(default)`, which is empty. Check the `[firebase-admin] Firestore ready`
line in the log; it prints the database it opened.

**`FAILED_PRECONDITION: The query requires an index`**
Something added a second `.where()` to a query. The current queries filter on
`startTime` alone and sort status out in memory specifically to avoid needing a
composite index that `firestore.indexes.json` does not have. If you add one on
purpose, the error message contains a link that creates the index for you.

**`vite: not found` during a build**
Something set `NODE_ENV=production`, so `npm ci` skipped devDependencies and
took Vite and esbuild with them. Express does not need that variable. Remove
it.

**The cron ran an hour later than you expected**
Render's schedules are UTC and do not move for daylight saving. The jobs work
out "today" in studio time so they always pick the right bookings - only the
hour they fire at drifts. Shift the `schedule:` line by one hour when the
clocks change, or leave it and accept 6am instead of 7am in winter.

---

## Rolling back

Each phase of this work is its own commit on `render-infrastructure`, so any
one can be reverted without the others:

```bash
git log --oneline render-infrastructure   # find the phase
git revert <sha>
```

On the Render side, deleting the four new services costs nothing but the
minutes already used and leaves the web service exactly as it is now. Nothing
in this branch changes how the app behaves for anyone using it - the web
service's build, start command and health check are all unchanged from what it
runs today.
