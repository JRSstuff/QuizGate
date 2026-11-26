# QuizGate

QuizGate is an offline-first classroom quiz platform and Grade 10 Quarter 2 Mathematics Progressive Web App (PWA) built with Next.js App Router, IndexedDB (Dexie), Web Crypto API, and optional Supabase PostgreSQL sync.

It is designed for real classrooms where internet is unavailable, slow, or drops mid-exam: students sign in without emails, take encrypted quizzes with timer protection, never lose answers on weak signal, and hand back tamper-evident Result QRs or encrypted submission files—while still supporting real-time multi-device cloud runs when connected.

---

## System Overview & Flow Diagram

```text
[Teacher Device (/teacher)]                         [Student Device(s) (/student)]
  1. Register / Login (username + password)           1. Open site once online -> PWA caches ("Ready Offline")
  2. Create Class -> gets Join Code + Printable QRs   2. Register / Login (Student No + PIN or ID QR)
  3. Load Grade 10 Quiz or Author Custom Quiz         3. Enter quiz via:
     (Optional Passcode Lock)                            - Cloud Live Run (online)
  4. Click Start Run -> Opens Live Run Dashboard         - Local Teacher Run (same device)
     - Online: pushes live run to class                  - Camera Scan of Classroom Quiz QR (QPK1.*)
     - Offline: shows Quiz QR (QPK1.*), .qpack.json      - Import .qpack.json file or ?pack= link
  5. Monitor / Collect Scores:                        4. Answer 1 item at a time -> written to IndexedDB
     - Cloud mode: polls live scores every 5s         5. Finish -> receives Result QR + .qres.json file
     - Offline mode: Scan Student Result QR (QG1O.*)  6. Show Result QR on screen or send .qres.json back
       or batch-import .qres.json files in Roster
  6. Click End Run -> Export Class Grades CSV
```

---

## Operating Modes

QuizGate automatically selects the right workflow based on network connectivity and server configuration:

| Capability | Offline / Local Classroom Mode | Connected Cloud Mode (Supabase + Vercel) |
| --- | --- | --- |
| **Teacher Auth** | Plain string `username` + `password` stored locally via salted SHA-256 in IndexedDB (`accounts`) | Plain string `username` + `password` verified against `public.teachers` (`pgcrypto` bcrypt) + `teacher_sessions` |
| **Student Auth** | Class Join Code + `studentNo` + PIN (or `SELF`), or offline `QG1L.*` ID QR | Class Join Code + `studentNo` + PIN, or teacher-issued `QG1.*` ID QR (`student_sessions`, newest device wins) |
| **Quiz Delivery** | Compact camera Quiz QR (`QPK1.*`), encrypted `.qpack.json` file, `?pack=` link, or same-device active run | Teacher clicks **Start Run** (`ends_at = now() + duration`); waiting student phones auto-poll & unlock quiz |
| **Timer Integrity** | `startedAt` persisted in IndexedDB on first open; survives page reloads without resetting clock | Server-side `ends_at` + `/api/time` client clock offset calculation; late answers rejected past deadline |
| **Offline Answers** | Every tap writes to IndexedDB `answerQueue` & `attempts`; zero network blocking | Every tap queues in IndexedDB and auto-syncs via `syncEngine` on `online`, `focus`, and `visibilitychange` |
| **Score Collection** | Teacher scans each student's `QG1O.*` Result QR or batch-imports `.qres.json` files inside the Run Roster | Server grades responses; live teacher roster refreshes every 5s; optional `QG1R.*` QR verified against DB HMAC |

> **Mode visibility:** The Teacher Console header checks `/api/health` on load and clearly displays whether **Cloud Sync Active** (requires `SUPABASE_SERVICE_ROLE_KEY`) or **Classroom Offline Mode** is running.

---

## Complete End-to-End Walkthrough

### Before Class (One-Time PWA Cache Warmup)
- Student devices should open the QuizGate URL **once while online** (at home, on school Wi-Fi, or briefly via teacher hotspot) until the top bar shows the green **`Ready Offline`** badge.
- Once cached by [public/sw.js](public/sw.js), all app routes (`/`, `/auth`, `/student`, `/student/play`, `/teacher`, `/verify`) load and function in full Airplane Mode.

### Part 1 — Teacher Setup (`/auth?role=teacher` → `/teacher`)
1. **String-Only Account (`/auth`):** Select **Teacher → Register**, enter a **Display Name**, a **Username** (minimum 2 characters, no spaces, no email required), and a **Password** (minimum 6 characters).
   - Online with cloud database active: submits to `POST /api/teacher/auth` (`teacher_register_username`).
   - Offline or without `SUPABASE_SERVICE_ROLE_KEY`: creates a local classroom teacher profile in IndexedDB (`offlineDb.accounts`).
2. **Create Classes & Roster (`Classes` tab):**
   - Enter a class name (e.g., `Grade 10 - Rizal`) and click **Create Class** to generate a unique 6-character **Student Join Code**, or click **Load Demo Classroom** to generate a ready-to-test class (`DEMO10`) with 5 sample students and a Grade 10 quiz.
   - Add students manually or via **Bulk CSV Import** (`Full Name, Student No`).
   - Share the **Student Invite Link** or open the **QR Sheet** tab to print both the **Class Join Pass QR** and individual **Student ID QR Cards**.
3. **Prepare Quizzes (`Quizzes` tab):**
   - Load any built-in **Grade 10 Math Assessment** (`Diagnostic 25`, `Mastery 7`, `Quick Checkpoint 5`) or author a custom multiple-choice quiz (2–5 options, duration in minutes, toggles for **Instant feedback popup on wrong answers** and **Allow answer changes**).
   - Set an **Optional export passcode** if you want to distribute quiz packs ahead of time while preventing students from reading questions until you write the passcode on the board.

### Part 2 — Running the Quiz in Class
1. Click **Start Run** on any quiz:
   - **Connected Mode:** Starts a timed `quiz_runs` record on the server and opens the **Cloud Live Run Roster** (polls every 5s, with manual refresh, **End Run**, and **Export CSV**).
   - **Offline / Local Mode:** Creates a persisted `LocalTeacherRun` in IndexedDB `teacherRuns`, switches to the **Live Run Active** dashboard with a running countdown clock, merges any existing same-device attempts, and generates a compact **`QPK1.*` Classroom Quiz QR** when the encrypted payload compresses to `<= 2,650` characters.
2. **Distributing Without Internet:**
   - **Small/Medium Quizzes (5–10 items):** Display **Classroom Quiz QR** on your laptop or projector. Students tap **Scan Quiz QR** in `/student` and aim their camera.
   - **Large Quizzes (e.g., 25-item Diagnostic):** Click **`.qpack.json`** or **Copy Link** and share via local Wi-Fi, hotspot, Nearby Share, AirDrop, Bluetooth, or USB. Students tap **Import `.qpack.json`**.

### Part 3 — Student Experience (`/auth?role=student` → `/student` → `/student/play`)
1. **Sign In / Register:**
   - **QR Scan:** Scan a teacher-printed `QG1.*` / `QG1L.*` card under `/auth` → **Scan QR**.
   - **Self-Register:** Enter **Full Name**, **Student Number**, the teacher's **Class Join Code** (or `SELF`), and a 4+ character **PIN**. Students receive a downloadable Personal Identity QR pass. When registering locally with a class join code present on the device, the student is automatically enrolled in that class's `Enrolled Students` list and any active local run.
2. **Classroom & Practice Workspace (`/student`):**
   - **`Quizzes` tab:** Shows **Teacher Started Classroom Quiz** (if local run matches), **Live Cloud Classroom Quiz** (auto-polls every 10s when online in Supabase mode), **Load Teacher Quiz Offline** (**Scan Quiz QR** / **Import `.qpack.json`**), and pre-loaded encrypted Grade 10 quizzes.
   - **`G10 Topics` tab:** Sequentially unlocks 10 Grade 10 Quarter 2 Math modules (`Week 1` to `Week 10`), each with worked concepts, matching pairs, numeric drills, two applied scenario MCQs, and a reflection checkpoint.
   - **`ID & Results` tab:** Always keeps the student's Personal Identity QR and all completed Result QRs + `.qres.json` export buttons.
3. **Quiz Play (`QuizRunner`):**
   - Displays one question at a time with connectivity badge (`Synced` / `Saved Offline`) and countdown timer (`MM:SS`).
   - Writes every answer immediately to IndexedDB (`answerQueue` + `attempts`).
   - If retries are disabled (`allow_retry = false`, default), the chosen option locks immediately; if `instant_feedback` is enabled, wrong picks open an immediate feedback modal while keeping the wrong choice recorded.
   - Reaching `00:00` locks further option clicks cleanly.
   - Clicking **Finish & Generate QR** grades locally (offline pack) or submits via `/api/student/quiz-finish` (cloud run) and produces the **Result QR** + downloadable **`.qres.json`** file.

### Part 4 — Teacher Score Collection, Verification & CSV Export
1. **Offline Score Collection Inside Teacher Console:**
   - In the active or ended run card on `/teacher`, click **Scan Result QR** (camera or paste `QG1O.*` text) or **Import `.qres.json` File(s)** (batch-select all collected student submission files).
   - Valid scans verify checksums/AES-GCM integrity seals, match the student by `studentNo` (or auto-enroll separate-phone self-registered students into the class), mark them green in **Class Run Roster & Scores**, and persist across browser reloads.
2. **Standalone Verifier (`/verify`, `/teacher/verify`):**
   - Scan/paste `QG1O.*` or `QG1R.*` Result QRs or batch-import `.qres.json` files outside of a specific run; logs all scans into `verificationLogs` with CSV export.
3. **Finish & Export:**
   - Click **End Run** to lock the session (finalizes server `in_progress` attempts in cloud mode; stops the local countdown in offline mode) and click **Export Class CSV** (`Student Name, Student No, Status, Answered, Score, Max Score, Late Sync Answers, Verified`).

---

## Cryptographic & QR Format Reference

Handled uniformly in [lib/crypto/quizVault.ts](lib/crypto/quizVault.ts) using Web Crypto (`AES-256-GCM`, `PBKDF2` 60k iterations, `SHA-256`):

| Prefix / Extension | Purpose | Contents & Integrity |
| --- | --- | --- |
| `QG1.<student_id>.<secret>` | Supabase Student Login QR | Random 48-hex secret; Postgres stores SHA-256 hash only |
| `QG1L.<id>.<no>.<nameB64>.<class>.<sig>` | Offline Student Identity QR | Base64URL identity signed with `NEXT_PUBLIC_QUIZGATE_QR_KEY` SHA-256 checksum |
| `QPK1.<deflatedB64Url>` / `QPK0.<b64Url>` | Classroom Quiz QR | Deflate-compressed `EncryptedQuizPack` payload for camera scanning |
| `.qpack.json` (`QGATE_PACK`) | Offline Quiz Pack File | Pre-compressed JSON encrypted with AES-256-GCM (+ optional passcode) and integrity `sig` |
| `QG1O.<pack>.<no>.<nameB64>.<score>.<max>.<late>.<epoch>.<sig>` | Offline Result QR | Score & timestamp signed against `NEXT_PUBLIC_QUIZGATE_QR_KEY` |
| `QG1R.<attempt_id>.<score>.<max>.<epoch>.<hmac>` | Server-Signed Result QR | HMAC-SHA256 verified against `public.app_secrets` on teacher verification |
| `.qres.json` (`QGATE_RESULT`) | Offline Submission Packet | AES-256-GCM encrypted attempt payload including full question answers & timestamps |

---

## Classroom Safeguards & Honest Security Notes

- **Weak/Lost Signal:** Every answer saves to IndexedDB before any network call. Pending remote answers (`answerQueue`) and offline-finished remote attempts (`pending_sync`) automatically flush on `online`, `focus`, and `visibilitychange` via [lib/offline/syncEngine.ts](lib/offline/syncEngine.ts).
- **Late-Sync Time Enforcement:** Server clock offset is computed via `/api/time`. In cloud runs, answers answered before server `ends_at` and synced `> 10s` after deadline are accepted as `late_sync = true`, while answers stamped past `ends_at` or `> 30s` in the future are rejected by Postgres `student_submit_answers`.
- **Tampered Scores:** Modifying digits in `QG1O.*`, `QG1R.*`, `.qpack.json`, or `.qres.json` fails signature/HMAC validation and blocks acceptance. *(Note: in purely offline mode without a server, public `NEXT_PUBLIC_QUIZGATE_*` keys exist in client JS bundles; use **Connected Cloud Mode** for strict server-only secrets and hidden answer keys.)*
- **Instant Feedback Tradeoff:** When `instant_feedback` is enabled, remote quizzes send `feedback_salt` and `correct_hash` (`SHA-256(id:index:salt)`) so wrong-answer modals work offline. A determined student inspecting browser memory could brute-force 2–5 options; turn **Instant feedback** off for high-stakes exams.
- **Cross-Device Resume (Connected Mode):** Scanning a student QR on a second device revokes prior `student_sessions`; the previous device shows *"Signed in on another device"* on the next poll/sync (401).
- **School Wi-Fi NAT Burst Handling:** Shared classroom router IPs allow up to `120` logins/min (`/api/student/login`), `80` registrations/min (`/api/student/register`), and `200` verifications/min (`/api/teacher/verify-result`) without false `429` lockouts, while [lib/security/ratelimit.ts](lib/security/ratelimit.ts) prunes expired buckets cleanly.

---

## Key Project Structure

```text
app/
  api/
    health/route.ts               # Public & service-role Supabase health + server clock
    time/route.ts                 # Uncached server timestamp for clock-offset sync
    student/
      login/route.ts              # QG1.*/QG1L.* QR or Join-Code + PIN login
      register/route.ts           # Self-registration via class join code or offline SELF
      quiz-state/route.ts         # Active run state, attempt restore & hashed feedback keys
      quiz-sync/route.ts          # Batch offline answer sync + late-sync grading
      quiz-finish/route.ts        # Finalize attempt and return QG1R.* HMAC QR
    teacher/
      auth/route.ts               # String-only teacher register/login RPC proxy
      workspace/route.ts          # Cloud classes, students, QR regeneration, quizzes, runs
      verify-result/route.ts      # QG1R.* (DB HMAC), QG1O.* (offline signature), & .qres.json
  auth/page.tsx                   # Role-aware Student/Teacher Login, Register & QR Scanner
  student/page.tsx                # Student Workspace (Quizzes, 10-Week Study Track, ID/Results)
  student/play/page.tsx           # Quiz Runner shell (supports live run:* & encrypted packs)
  teacher/page.tsx                # Teacher Console (Classes, Demo loader, Runs, QR Sheet)
  verify/page.tsx                 # Result QR camera/paste + batch .qres.json verifier & CSV

components/                       # AppShell, AuthScreen, TeacherConsole, StudentWorkspace, QuizRunner,
                                  # Grade10ModuleDrawer, VerifyScreen, HomeScreen, QrCanvas, MathText
lib/
  crypto/quizVault.ts             # AES-256-GCM vault, DEFLATE QPK1 compression, QR signers/verifiers
  data/grade10Math.ts             # 10 weekly modules, 20 practice checks, 20 scenarios, 25+7 bank items
  offline/
    storage.ts                    # Dexie v2 IndexedDB database (QuizGateOfflineDB_v2)
    syncEngine.ts                 # Deduplicated online/focus/visibilitychange remote sync engine
    runRosterSync.ts              # Same-device attempt <-> Teacher run roster & CSV helpers
  security/ratelimit.ts           # Bounded sliding-window IP rate limiter
  supabase/                       # config.ts & server.ts (publishable/anon & service-role wrappers)
  timer/clockSync.ts              # Server clock offset & countdown formatter

utils/supabase/                   # Next.js SSR helpers (env.ts, client.ts, server.ts, middleware.ts)
middleware.ts                     # Refreshes sb-* Supabase cookies cleanly; zero-overhead offline/anon
supabase/schema.sql               # Idempotent PostgreSQL schema, RLS, student & teacher RPCs
BACKEND.md                        # Database tables, security grants, and RPC reference
```

---

## Local Development

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. All offline classroom features, encryption, Grade 10 math tracks, and unit/E2E tests work right away once local keys are in `.env.local`.

### Scripts

- `npm run dev` — Start local Next.js dev server
- `npm run build` — Compile production build (`next build`) and validate TypeScript/ESLint
- `npm test` — Run Vitest suites (18 tests across vault cryptography, math bank answer verification, server clock rules, serverless routes, and 50-student classroom scale/NAT throughput simulation)
- `npm run test:e2e` — Run Playwright mobile & desktop E2E tests against `next start` (covers Grade 10 study grading, offline quiz completion & reload, and a two-browser-context Teacher + 2-Student offline classroom run with `QPK1.*` & `QG1O.*` QR exchange)

---

## Deploying to Vercel & Supabase

QuizGate deploys directly to Vercel. Offline PWA quizzes, QR sheets, and `.qpack.json` / `.qres.json` workflows operate even without Supabase configured.

### 1. Environment Variables
Copy [.env.example](.env.example) to `.env.local` locally or add these in **Vercel → Project Settings → Environment Variables**:

- `NEXT_PUBLIC_QUIZGATE_VAULT_KEY` — Encryption key base for `.qpack.json` and `.qres.json` files
- `NEXT_PUBLIC_QUIZGATE_QR_KEY` — Signing key base for offline `QG1L.*` and `QG1O.*` QR codes
- `VERIFICATION_HMAC_SECRET` — Server receipt key
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL *(optional; enables Supabase connectivity)*
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY`) — Supabase public publishable key *(optional)*
- `SUPABASE_SERVICE_ROLE_KEY` — **Server-only** Supabase `service_role` / `sb_secret_...` key required for cloud Teacher auth/workspace routes (`/api/teacher/*`) and cloud Student RPCs (`/api/student/*`). **Never prefix with `NEXT_PUBLIC_`.**

### 2. Supabase Database Setup (Required for Multi-Device Wi-Fi Sync)
1. Paste and execute [supabase/schema.sql](supabase/schema.sql) in your Supabase **SQL Editor** (safe to re-run; creates/updates `teachers`, `teacher_sessions`, `classes`, `students`, `quizzes`, `questions`, `quiz_runs`, `attempts`, `answers`, `student_sessions`, `verifications`, `app_secrets`, RLS rules, and RPCs).
2. Add `SUPABASE_SERVICE_ROLE_KEY` to `.env.local` (for local cloud testing) and Vercel Environment Variables, then redeploy.
