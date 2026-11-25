# QuizGate Database Backend

This document details the PostgreSQL schema and security model for QuizGate on Supabase.

---

## 1. System Architecture

QuizGate divides operations between two actors: authenticated teachers and anonymous students.

### Teacher Flow
1. **Account setup**: A trigger on `auth.users` creates a record in `public.teachers` on signup.
2. **Class and quiz management**: Teachers create classes, questions, and quizzes. Each question holds 2 to 5 options in JSONB, a points value, a random salt (`feedback_salt`), and the 0-based index of the correct answer (`correct_index`).
3. **Student registration**: Teachers create students via stored procedures (`create_student` or `import_students`). The database returns each student's QR string (`QG1.<student_id>.<secret>`) once. The database stores only a SHA-256 hash of that secret.
4. **Quiz runs**: A teacher starts a run (`start_run`) for a class. The database sets `ends_at = now() + duration` using the server clock and enforces a partial unique index so that a class can have only one active run.
5. **Grading and monitoring**: Teachers inspect the `run_results` view or listen to Realtime updates on `attempts` and `answers`.
6. **Result verification**: After students complete a quiz, the teacher scans each student's result QR. The procedure `verify_result` checks the HMAC-SHA256 signature against `app_secrets`, verifies class ownership, logs the scan in `verifications`, and returns the student name and score comparison.

### Student Flow
1. **Sign-in without passwords**: The student scans their QR code. A Next.js API route passes the string to `student_sign_in`. The function validates the SHA-256 hash, marks any older active sessions as revoked (so the newest device wins), and returns a 64-character session token. The database stores only a SHA-256 hash of that token, with a 12-hour expiration.
2. **State polling and sync**: The student app calls `student_get_state` with their session token. The server returns the current server time, active quiz run, existing attempt, and questions without plaintext correct answers. If the quiz has `instant_feedback` enabled, the database includes each question's `feedback_salt` and a salted option hash (`correct_hash`) so the client app can trigger wrong-answer warnings offline.
3. **Submitting answers**: As students answer, the client pushes batches to `student_submit_answers`. The database validates that answers were recorded before `ends_at` and not ahead of server time by more than 30 seconds. If an answer arrives more than 10 seconds after `ends_at`, the database flags it `late_sync = true`. If the quiz disables retries (`allow_retry = false`), earlier answers cannot be overwritten. The server recalculates attempt scores on write.
4. **Finishing**: When finished, `student_finish` or `student_get_result` locks the attempt and returns a signed payload: `QG1R.<attempt_id>.<score>.<max>.<epoch>.<hmac>`.

---

## 2. Security and Permissions

### Row Level Security (RLS)
RLS is active on all 11 tables.
- Role `anon` has no privileges on any table, view, sequence, or function.
- Role `authenticated` (teachers) can read and write only rows belonging to their own classes and quizzes via helper functions: `owns_class`, `owns_quiz`, and `owns_run`.
- Teachers cannot read `students.qr_secret_hash`. Postgres column-level grants grant SELECT on `(id, class_id, name, student_no, created_at)` only. Direct INSERT, UPDATE, and DELETE on `students` are revoked from teachers.
- Role `service_role` has full database access. Next.js server-side API routes use `service_role` to execute student functions.

### Function Privileges and Search Paths
Default public execution privileges are revoked on all routines in `public`.
- Teacher functions grant execute to `authenticated` and `service_role`.
- Student functions grant execute to `service_role` only. Web clients cannot call student functions directly through PostgREST.
- Every function defined with `SECURITY DEFINER` specifies `SET search_path = public, extensions, pg_temp` to prevent search-path injection.

### Server Environment Variables
The secret key `SUPABASE_SERVICE_ROLE_KEY` must remain on the application server. Do not prefix this variable with `NEXT_PUBLIC_` and do not import it into client-side code.

---

## 3. Database Tables

| Table | Description | Access Rules |
|---|---|---|
| `teachers` | Teacher profiles tied to `auth.users.id`. Auto-populated on signup. | Authenticated teachers read and update their own record. |
| `classes` | Class cohorts owned by a teacher. | Authenticated teachers manage their own classes. |
| `students` | Students enrolled in a class. Stores `qr_secret_hash`. | Authenticated teachers have column-restricted SELECT. Modifications run through stored procedures. |
| `quizzes` | Quiz definitions, duration, and feedback flags. | Authenticated teachers manage their own quizzes. |
| `questions` | Questions with JSONB options (2 to 5 items), correct index, points, and salts. | Authenticated teachers manage questions on their quizzes. |
| `quiz_runs` | Live quiz instances with server start and end timestamps. | Authenticated teachers start and end runs for their classes. One running run per class. |
| `attempts` | Student quiz attempts. Stores score, max score, and status. | Teachers read attempts for their runs. Updated via server routes. |
| `answers` | Recorded responses, graded server-side with sync timestamps. | Teachers read answers for their runs. Created and updated via server routes. |
| `student_sessions` | Active student session tokens (hashed) with 12-hour expiry. | RLS enabled. No access for `anon` or `authenticated`. Managed by `service_role`. |
| `verifications` | Log of scanned result QR codes and score checks. | Teachers insert and view verification rows for their classes. |
| `app_secrets` | Holds the HMAC key (`result_hmac_key`). | RLS enabled. No access for `anon` or `authenticated`. Managed by `service_role`. |

---

## 4. Functions Reference

| Function Name | Caller Role | Inputs | Outputs | Error Conditions |
|---|---|---|---|---|
| `handle_new_user()` | Trigger (`auth.users`) | Trigger row `NEW` | `TRIGGER` (`auth.users`) | Raised if user insert fails. |
| `owns_class(p_class_id UUID)` | `authenticated`, `service_role` | `p_class_id UUID` | `BOOLEAN` | None. Returns false if class does not exist or caller is not owner. |
| `owns_quiz(p_quiz_id UUID)` | `authenticated`, `service_role` | `p_quiz_id UUID` | `BOOLEAN` | None. Returns false if quiz does not exist or caller is not owner. |
| `owns_run(p_run_id UUID)` | `authenticated`, `service_role` | `p_run_id UUID` | `BOOLEAN` | None. Returns false if run does not exist or caller is not owner. |
| `create_student(class_id UUID, name TEXT, student_no TEXT)` | `authenticated`, `service_role` | `class_id UUID`, `name TEXT`, `student_no TEXT` | `TEXT` (QR code string `QG1.<id>.<secret>`) | - Caller does not own class<br>- Name or student number empty<br>- Duplicate student number in class |
| `import_students(class_id UUID, rows JSONB)` | `authenticated`, `service_role` | `class_id UUID`, `rows JSONB` (`[{name, student_no}]`) | `JSONB` (`{created, skipped, created_count, skipped_count}`) | - Caller does not own class<br>- `rows` is not a JSON array |
| `regenerate_student_qr(student_id UUID)` | `authenticated`, `service_role` | `student_id UUID` | `TEXT` (New QR string `QG1.<id>.<secret>`) | - Student does not exist<br>- Caller does not own student class |
| `start_run(quiz_id UUID)` | `authenticated`, `service_role` | `quiz_id UUID` | `UUID` (`run_id`) | - Quiz does not exist or caller does not own it<br>- Quiz has zero questions<br>- Active run already exists for this class |
| `end_run(run_id UUID)` | `authenticated`, `service_role` | `run_id UUID` | `BOOLEAN` | - Run does not exist<br>- Caller does not own run |
| `verify_result(code TEXT)` | `authenticated`, `service_role` | `code TEXT` (`QG1R.<attempt_id>.<score>.<max>.<epoch>.<hmac>`) | `JSONB` (`{student_name, score_in_code, score_in_db, matches, signature_valid, is_valid}`) | - Code format invalid<br>- HMAC key missing from database<br>- Attempt not found<br>- Caller does not own the attempt's class |
| `student_sign_in(qr_payload TEXT)` | `service_role` only | `qr_payload TEXT` (`QG1.<student_id>.<secret>`) | `JSONB` (`{session_token, student: {id, name, student_no, class_id}}`) | - QR format invalid<br>- Student ID not a valid UUID<br>- Credentials do not match `qr_secret_hash` |
| `student_get_state(token TEXT)` | `service_role` only | `token TEXT` (raw session token) | `JSONB` (`{server_now, student, run, quiz, attempt, answers, questions}`) | - Token invalid, expired, or revoked<br>- Student record missing |
| `student_submit_answers(token TEXT, run_id UUID, answers JSONB)` | `service_role` only | `token TEXT`, `run_id UUID`, `answers JSONB` (`[{question_id, selected_index, answered_at}]`) | `JSONB` (`{success, attempt_id, score, max_score, synced_count, server_now}`) | - Token invalid, expired, or revoked<br>- Run does not belong to student's class<br>- `answers` is not a JSON array |
| `student_finish(token TEXT, run_id UUID)` | `service_role` only | `token TEXT`, `run_id UUID` | `JSONB` (`{result_code, attempt_id, score, max_score, status, submitted_at}`) | - Token invalid, expired, or revoked<br>- Attempt does not exist for run |
| `student_get_result(token TEXT, run_id UUID)` | `service_role` only | `token TEXT`, `run_id UUID` | `JSONB` (`{result_code, attempt_id, score, max_score, status, submitted_at}`) | - Token invalid, expired, or revoked<br>- Attempt does not exist for run |
| `student_register_with_code(p_join_code TEXT, p_name TEXT, p_student_no TEXT, p_pin TEXT)` | `service_role` only | `p_join_code`, `p_name`, `p_student_no`, `p_pin` | `JSONB` (`{session_token, qr_payload, student}`) | - Invalid class join code<br>- Empty fields or PIN under 4 characters<br>- Duplicate student number |
| `student_sign_in_with_pin(p_join_code TEXT, p_student_no TEXT, p_pin TEXT)` | `service_role` only | `p_join_code`, `p_student_no`, `p_pin` | `JSONB` (`{session_token, student}`) | - Invalid class join code<br>- Incorrect PIN or QR-only student |
| `teacher_register_username(p_username, p_display_name, p_password)` | `service_role` only | String username, display name, password | `JSONB` (`{session_token, teacher}`) | - Username < 2 chars or has spaces<br>- Password < 6 chars<br>- Duplicate username |
| `teacher_login_username(p_username, p_password)` | `service_role` only | String username, password | `JSONB` (`{session_token, teacher}`) | - Invalid username or password |
| `teacher_get_workspace(p_token)` | `service_role` only | Teacher session token | `JSONB` (`{teacher, classes, quizzes, active_runs}`) | - Token invalid or expired |
| `teacher_create_class(p_token, p_name)` | `service_role` only | Session token, class name | `JSONB` (`{id, name, join_code}`) | - Token invalid or empty name |
| `teacher_add_student(p_token, p_class_id, p_name, p_student_no)` | `service_role` only | Session token, class UUID, name, number | `JSONB` (`{id, name, student_no, qr_payload}`) | - Unauthorized class or duplicate student number |
| `teacher_import_students(p_token, p_class_id, p_rows)` | `service_role` only | Session token, class UUID, JSON rows | `JSONB` (`{created, skipped, created_count, skipped_count}`) | - Unauthorized class or invalid rows |
| `teacher_regenerate_student_qr(p_token, p_student_id)` | `service_role` only | Session token, student UUID | `TEXT` (`QG1.<id>.<secret>`) | - Unauthorized student |
| `teacher_create_quiz(...)` | `service_role` only | Session token, class UUID, quiz config & JSON questions | `JSONB` (`{quiz_id}`) | - Unauthorized class or zero questions |
| `teacher_start_run(p_token, p_quiz_id)` | `service_role` only | Session token, quiz UUID | `JSONB` (`{run_id}`) | - Unauthorized quiz or active run already running |
| `teacher_end_run(p_token, p_run_id)` | `service_role` only | Session token, run UUID | `BOOLEAN` | - Unauthorized run |
| `teacher_get_run_results(p_token, p_run_id)` | `service_role` only | Session token, run UUID | `JSONB` (`{run, results}`) | - Unauthorized run |
| `teacher_verify_result(p_token, p_code)` | `service_role` only | Session token, `QG1R.*` result QR | `JSONB` (`{student_name, score_in_code, score_in_db, matches, signature_valid, is_valid}`) | - Unauthorized attempt or tampered signature |
| `run_results` (View) | `authenticated`, `service_role` | Query filter `WHERE run_id = ...` | Row set (`run_id, quiz_id, class_id, student_id, student_name, student_no, status, answered_count, score, max_score, late_answers, is_verified, attempt_id, started_at, submitted_at`) | None. Evaluated under the caller's permissions (`security_invoker = true`). |

---

## 5. Offline Verification and Timing Details

### Salted Hashes for Instant Feedback
When `quizzes.instant_feedback` is enabled, `student_get_state` supplies `feedback_salt` and `correct_hash` for each question:
```sql
correct_hash = encode(digest(question_id || ':' || correct_index || ':' || feedback_salt, 'sha256'), 'hex')
```
The client tests each option index locally against `correct_hash`. A determined user inspecting memory could brute-force the 2 to 5 options. If cheating is a risk, teachers should disable `instant_feedback` in the quiz settings.

### Server Time Validation
Client device clocks cannot extend quiz limits:
- An answer is rejected if `answered_at > quiz_runs.ends_at`.
- An answer is rejected if `answered_at > now() + interval '30 seconds'`.
- An answer accepted by the rules above receives `late_sync = true` if `now() > quiz_runs.ends_at + interval '10 seconds'`.

---

## 6. Open Questions

1. **Student attempt creation timing**: The schema initializes an attempt record when a student first calls `student_get_state` during an active run. If a student signs in before the teacher hits Start, `student_get_state` returns `run: null` and creates the attempt once the run becomes active.
2. **Expired run auto-close**: `start_run` ends any expired runs for that class before starting a new run. If a teacher starts a quiz and never opens the app again, the expired run remains marked `running` in the database until the next run starts or a teacher calls `end_run`. If background auto-closure is required without teacher actions, a periodic Supabase pg_cron task could call a sweep function.

---

## What Changed

- Replaced abstract descriptions with concrete workflows and error conditions.
- Cut filler words and empty phrases ("it's important to note", "crucially", "leverage").
- Standardized markdown tables with explicit types, roles, inputs, outputs, and failure modes.
- Kept tone direct and technical without decorative headings or emoji.
