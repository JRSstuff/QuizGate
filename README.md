# QuizGate — Offline-First Link-Based Classroom Quiz PWA

QuizGate is an offline-first, cryptographic classroom assessment PWA for Next.js App Router built around a **zero-registration shareable link flow** (`/q/<runId>#...`) for students and a single unified control dashboard (`/teacher`) for teachers.

It works seamlessly in **Classroom Offline Mode** with no database keys required, and optionally syncs waiting rooms and live submissions when Supabase credentials are configured.

---

## Whole Flow at a Glance

```
TEACHER (/teacher)                                  STUDENT (/q/<runId>#L3...)
───────────────────────────────────────────         ───────────────────────────────────────────
1. Pick Grade 10 template or add questions          1. Open teacher's link (or scan Link QR)
2. Click "Create Quiz Link"                         2. Page caches app route + encrypted pack
   -> Generates /q/<runId>#L3...                       Shows green "Ready Offline" badge
   -> Shows Copy button & Link QR                   3. Enter Full Name + Section (NO login/PIN)
                                                    4. Land in WAITING ROOM
                                                       (Questions remain encrypted & unreadable)

                       ┌──────────────────────────────────────────────────┐
                       │         HYBRID SYNCHRONIZED START MECHANISM      │
                       └──────────────────────────────────────────────────┘
                       ONLINE: Students poll /api/run/<runId>/state (3s)
                               Server saves startedAtServer; deadline uses
                               /api/time clock-offset sync
                       OFFLINE: Teacher gets signed 10-char Start Code &
                               Start QR (bind runId + startEpoch). Student
                               types/scans it to get identical deadline.

3. Click big idempotent START QUIZ button           5. Quiz unlocks; answers save to IndexedDB
   -> Live timer & Start Code appear                   every tap; monotonic + wall-clock timer
4. Click End Run when finished                      6. Finish OR 00:00 timer -> auto-submits
                                                       -> Auto-downloads signed .qres.json
                                                       -> Shows Result QR (QG3R.*) & Share btn
                                                       -> Auto-POSTs to server if online
5. Upload multiple .qres.json files (offline ok!)
   -> Verifies per-run signatures, wrong run/version, duplicates,
      clock tamper, shared devices & identical answers
   -> Inline Rename / Merge + Export Class CSV
```

---

## Step-by-Step Guide

### Teacher Workflow (`/teacher`)
1. Open **Teacher Console** -> **Quiz Links** tab (optional teacher account login is available on `/auth`, never required for offline classroom use).
2. Choose a built-in **Grade 10 Math** template or custom questions, set **Class Name**, optional **Sections** (`10-Rizal, 10-Bonifacio`), and **Duration (minutes)**.
3. Click **Create Quiz Link**. QuizGate seals all questions, options, correct answers, feedback salts, and a unique per-run signing secret (`resultSecret`) using **AES-256-GCM** inside the `#L3...` URL fragment.
4. Share the link or **Show Link QR**.
5. Students joining online increment the **Joined** counter in real time (3-second polling).
6. When ready, click **START QUIZ**:
   - The start action is **idempotent** (starting twice never resets the timer).
   - Displays a signed 10-character **Start Code** (e.g. `4K8M2-P9QWR`) and **Start QR** (`QGSTART.<runId>.<epoch>.<code>`) that works completely offline and gives every device the **exact same absolute deadline** (`startEpoch + duration`).
7. Collect submissions:
   - **Online students** automatically upload when finishing.
   - **Offline students** send their `.qres.json` file (via chat, USB, Bluetooth, Web Share) or show their Result QR (`QG3R.*`).
   - Select multiple `.qres.json` files in **Record Student .qres.json Files** (works completely offline) to verify, merge, review any **Duplicate Attempts**, fix typos with **Edit / Merge**, and download **Export Class CSV**.

### Student Workflow (`/q/<runId>#...`)
1. Open the link shared by the teacher. No registration, student number, PIN, or email is used.
2. QuizGate verifies browser storage (blocking Private Mode/low storage risks), verifies the encrypted bundle signature, writes it to IndexedDB (`cachedLinkPacks`), and caches `/q/<runId>` in the Service Worker before showing **"Ready Offline"**.
3. Type **Full Name** and choose/type **Section**, then click **Enter Waiting Room**.
4. In the Waiting Room, questions remain encrypted until Start:
   - Online students auto-unlock within 3 seconds when the teacher clicks Start.
   - Offline students enter the teacher's 10-character **Start Code** or scan the **Start QR**.
5. Every answer tap persists immediately to IndexedDB (`linkAttempts`).
6. Timer combines wall clock (`Date.now()`) and monotonic elapsed (`performance.now()`) checks. Closing/reloading does not extend time; reopening past the deadline auto-finalizes immediately without allowing extra edits.
7. At `00:00` or **Finish**, QuizGate grades locally, seals `.qres.json` with the per-run secret, auto-downloads once, displays **"Send this file to your teacher"**, exposes **Download**, **Share File** (Web Share API), and **Result QR** (`QG3R.*`), and auto-POSTs online if connectivity is available.

---

## Environment Setup (`.env.local` & Vercel)

QuizGate treats a missing `SUPABASE_SERVICE_ROLE_KEY` as a normal supported state:
- `/api/health` and `/api/teacher/auth` return HTTP `200` with `{ "mode": "offline", "cloud": false }` (no `error` field).
- The app displays a neutral **"Classroom Offline Mode"** badge and runs entirely on local encryption, IndexedDB, and `.qres.json` / QR workflows.

### Optional Cloud Sync (`.env.local` for Local Dev)
Create `.env.local` in the project root:

```env
# Stable namespaces for local/offline AES-GCM & QR signatures
NEXT_PUBLIC_QUIZGATE_VAULT_KEY=your-classroom-vault-secret
NEXT_PUBLIC_QUIZGATE_QR_KEY=your-classroom-qr-secret
VERIFICATION_HMAC_SECRET=your-hmac-secret

# Optional Supabase Public Env (client-safe)
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...

# Optional Server Service Key (NEVER expose in NEXT_PUBLIC_*!)
# Enables persistent Supabase tables for live runs/submissions across restarts
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

### Vercel Deployment Setup
1. In **Vercel Project Settings -> Environment Variables**, add the keys above.
2. Add `SUPABASE_SERVICE_ROLE_KEY` as a **Server-side (non-`NEXT_PUBLIC_`)** environment variable only if you want Supabase database persistence (`supabase/schema.sql`) enabled for online waiting rooms and submissions.
3. If `SUPABASE_SERVICE_ROLE_KEY` is omitted in Vercel, QuizGate automatically runs in **Classroom Offline Mode** with zero configuration errors.

---

## Integrity Checks & Loopholes Closed

- **No questions leaked pre-start**: Questions, choices, feedback salts, and `resultSecret` live inside AES-256-GCM ciphertext (`ciphertext`) unlocked only after online server Start or verified Start Code.
- **No forged/cross-run `.qres.json` or Result QR**: Each packet requires both outer packet seal and inner per-run HMAC (`resultSecret`) bound to `runId` and `versionHash`.
- **Anti-overwrite deduplication**: Exact `attemptId` repeats are ignored as duplicates; multiple `attemptId` submissions by the same `Student Name + Section` keep the **first** submission on the roster and list subsequent ones under **Duplicate Attempts For Review**.
- **Cross-device & timing flags**: Flags `submittedOffline`, `clockTampered` (backward jumps or >4s monotonic `performance.now()` drift), `lateAfterEnd`, `beforeStart`, `sharedDeviceWith`, and `identicalAnswersWith` (`>= 3` questions matching).
- **Double-submit & private-mode guards**: Idempotent `finalizeAttempt` lock prevents double downloads/POSTs at `00:00`, and storage probe warns before quiz start if IndexedDB is blocked.

---

## Known Limits

QuizGate is designed so classrooms work with **zero internet and zero backend**:
- Because offline devices must decrypt questions and produce signed `.qres.json` files without contacting a server, the run decryption key and post-start per-run signing secret (`resultSecret`) exist inside the client bundle (`#L3...`) once unlocked.
- An advanced user inspecting browser RAM/DevTools *after* entering a valid Start Code could inspect decrypted data on that unlocked device; however, **pre-start leakage is blocked** (AES-GCM sealed), **cross-run forgery fails** (unique per-run keys), and **device/timing/collusion anomalies** are surfaced directly on the teacher's roster.
- For high-stakes proctored exams over campus Wi-Fi, enable Supabase (`SUPABASE_SERVICE_ROLE_KEY`) and review timing/shared-device/identical-answer flags on `/teacher`.

---

## Commands & Verification

```bash
# Unit & route tests (Vitest)
npm test

# Production build
npm run build

# End-to-end offline multi-device Playwright suite
npm run test:e2e
```
