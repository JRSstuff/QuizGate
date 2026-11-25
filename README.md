# QuizGate

QuizGate is an offline-first classroom quiz and Grade 10 Quarter 2 Mathematics Progressive Web App (PWA) built with Next.js, IndexedDB (Dexie), Web Crypto, and optional Supabase sync. Teachers can run live timed quizzes when connected or distribute AES-256-GCM encrypted quiz files (`.qpack.json`) offline, then verify student scores from signed QR codes or encrypted submission files (`.qres.json`).

---

## How It Works

### Two Operating Modes

| Feature | Connected Mode (Supabase + Vercel) | Offline Mode (PWA + Encrypted Files) |
| --- | --- | --- |
| Student Auth | Register with class join code + PIN, or scan printed `QG1.*` QR card | Register locally (`SELF` or class code) and generate offline `QG1L.*` ID QR |
| Quiz Delivery | Teacher starts a timed server run (`start_run`); questions sync via API | Built-in Grade 10 Math bank or teacher-shared `.qpack.json` / `?pack=` link (AES-256-GCM) |
| Offline Answers | Saved immediately in IndexedDB and synced to Postgres on reconnect | Saved in IndexedDB with local instant feedback (if enabled) |
| Score Proof | Server-signed `QG1R.*` Result QR verified against Postgres (`verify_result`) | Signed `QG1O.*` Result QR + AES-256-GCM encrypted `.qres.json` submission file |

### Student Flow

1. **Register or Log In (`/auth`)**: Enter your name, student number, class join code (or `SELF`), and PIN/password to generate a personal Identity QR Card, or scan an existing QR pass.
2. **Take Quizzes (`/student`, `/student/play`)**: Open an active classroom run, import a teacher's encrypted `.qpack.json` file, or open one of the pre-loaded Grade 10 Term 2 assessments (25-item Diagnostic, 7-item Mastery Challenge, or 5-item Quick Checkpoint).
3. **Study Track (`/student` → `G10 Topics`)**: Work sequentially through all 10 Grade 10 Term 2 math modules (Rational Exponents, Operations on Radicals, Discriminant, Quadratic Functions, Optimization, Circle Forms, Center & Radius, Point Position, Deriving Circles, and Tangents).
4. **Submit & Verify**: View your score and Result QR code immediately after finishing, or export the encrypted `.qres.json` file to send back to your teacher offline.

### Teacher Flow

1. **Account & Classes (`/teacher`)**: Sign in via Supabase or local classroom mode, create classes with 6-character invite codes and shareable student registration links, add students manually or via CSV, and print student QR sheets.
2. **Authoring & Sharing**: Create custom multiple-choice quizzes (2–5 options) or load the built-in Grade 10 math assessments. Export quizzes as encrypted `.qpack.json` files (with an optional passcode) or copy encrypted `?pack=` share links.
3. **Verification (`/verify`, `/teacher/verify`)**: Scan student Result QRs (`QG1O.*` or `QG1R.*`) with the device camera, paste codes manually, or upload `.qres.json` submission files. Export verified results to CSV.

---

## Key Architecture & Files

- **Cryptography & Quiz Vault**: [lib/crypto/quizVault.ts](lib/crypto/quizVault.ts) — AES-256-GCM encryption (`PBKDF2` key derivation + SHA-256 integrity seal) for `.qpack.json` and `.qres.json` files, plus signed QR builders/verifiers.
- **Grade 10 Math Bank**: [lib/data/grade10Math.ts](lib/data/grade10Math.ts) — 10 structured weekly modules, 25 diagnostic items, and 7 mastery challenge items.
- **Offline Storage**: [lib/offline/storage.ts](lib/offline/storage.ts) — Dexie IndexedDB schema (`accounts`, `session`, `importedPacks`, `answerQueue`, `attempts`, `studyProgress`, `teacherClasses`, `teacherQuizzes`, `verificationLogs`).
- **PWA Shell & Caching**: [public/sw.js](public/sw.js), [public/manifest.json](public/manifest.json), [components/ServiceWorkerRegister.tsx](components/ServiceWorkerRegister.tsx) — caches routes and static assets for offline reloads.
- **Serverless API Routes**: `app/api/health`, `app/api/time`, `app/api/student/*`, `app/api/teacher/verify-result` — stateless Next.js App Router handlers compatible with Vercel serverless functions.
- **Supabase Schema**: [supabase/schema.sql](supabase/schema.sql) and [BACKEND.md](BACKEND.md) — Postgres tables, RLS policies, column-level student secret isolation, and `service_role` student RPCs.

---

## Local Development

```bash
npm install
cp .env.example .env.local
npm run dev
```

Fill in `.env.local` (or `.env`) with your local keys and Supabase project URL/keys. Open `http://localhost:3000`.

### Scripts

- `npm run dev` — start local Next.js dev server
- `npm run build` — compile production build and check TypeScript/ESLint
- `npm test` — run Vitest unit tests (cryptography vault, math bank hashes, clock sync, serverless route handlers)
- `npm run test:e2e` — run Playwright end-to-end offline PWA and desktop teacher/student flow tests against `next start`

---

## Deploying to Vercel

QuizGate deploys directly to Vercel with **zero required environment variables** for offline PWA, encrypted pack export/import, and standalone QR verification.

### Environment Variables

See [.env.example](.env.example).

1. Run [supabase/schema.sql](supabase/schema.sql) once in your Supabase SQL Editor (safe to re-run) if using Supabase sync.
2. Add environment variables in **Vercel → Project Settings → Environment Variables** (or in your local `.env.local` / `.env`):
   - `NEXT_PUBLIC_QUIZGATE_VAULT_KEY` — encryption key for offline `.qpack.json` and `.qres.json` files
   - `NEXT_PUBLIC_QUIZGATE_QR_KEY` — signing key for offline Student ID & Result QR codes
   - `NEXT_PUBLIC_SUPABASE_URL` — your Supabase project URL *(optional)*
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY`) — your Supabase public publishable key *(optional)*
   - `SUPABASE_SERVICE_ROLE_KEY` — server-only secret/service role key used by student `/api/student/*` RPC routes (never expose to client code or prefix with `NEXT_PUBLIC_`) *(optional)*
   - `VERIFICATION_HMAC_SECRET` — optional HMAC key for server verification receipts
