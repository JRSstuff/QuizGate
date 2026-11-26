-- ==============================================================================
-- QuizGate: Complete Database Schema for Supabase PostgreSQL
-- Safe to re-run in the Supabase SQL Editor.
-- ==============================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ==============================================================================
-- 3. TABLES (PUBLIC SCHEMA)
-- ==============================================================================

-- 3.1 Teachers (linked to auth.users, auto-created via trigger)
CREATE TABLE IF NOT EXISTS public.teachers (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3.2 Classes
CREATE TABLE IF NOT EXISTS public.classes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL REFERENCES public.teachers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3.3 Students
CREATE TABLE IF NOT EXISTS public.students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  student_no TEXT NOT NULL,
  qr_secret_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_class_student_no UNIQUE (class_id, student_no)
);

-- 3.4 Quizzes
CREATE TABLE IF NOT EXISTS public.quizzes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL REFERENCES public.teachers(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 15 CHECK (duration_minutes > 0),
  instant_feedback BOOLEAN NOT NULL DEFAULT true,
  allow_retry BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3.5 Questions
CREATE TABLE IF NOT EXISTS public.questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id UUID NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
  question_text TEXT NOT NULL,
  options JSONB NOT NULL,
  correct_index INTEGER NOT NULL,
  points INTEGER NOT NULL DEFAULT 1 CHECK (points >= 0),
  feedback_salt TEXT NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_options_count CHECK (
    jsonb_typeof(options) = 'array' AND
    jsonb_array_length(options) >= 2 AND
    jsonb_array_length(options) <= 5
  ),
  CONSTRAINT chk_correct_index_bounds CHECK (
    correct_index >= 0 AND
    correct_index < jsonb_array_length(options)
  )
);

-- 3.6 Quiz Runs (Teacher controls starts/stops with server deadline)
CREATE TABLE IF NOT EXISTS public.quiz_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id UUID NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('running', 'ended')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enforce at most one running quiz run per class
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_running_run_per_class
  ON public.quiz_runs (class_id)
  WHERE status = 'running';

-- 3.7 Attempts (One attempt per student per run)
CREATE TABLE IF NOT EXISTS public.attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.quiz_runs(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'submitted')),
  score INTEGER NOT NULL DEFAULT 0,
  max_score INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_run_student_attempt UNIQUE (run_id, student_id)
);

-- 3.8 Answers (One answer per attempt and question)
CREATE TABLE IF NOT EXISTS public.answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID NOT NULL REFERENCES public.attempts(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  selected_index INTEGER NOT NULL,
  is_correct BOOLEAN NOT NULL DEFAULT false,
  answered_at TIMESTAMPTZ NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  late_sync BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT uq_attempt_question UNIQUE (attempt_id, question_id)
);

-- 3.9 Student Sessions (Single active session per student, 12h expiry)
CREATE TABLE IF NOT EXISTS public.student_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '12 hours'),
  revoked BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_student_sessions_student_id ON public.student_sessions(student_id);
CREATE INDEX IF NOT EXISTS idx_student_sessions_token_hash ON public.student_sessions(token_hash);

-- 3.10 Verifications (Teacher scans signed student result QR)
CREATE TABLE IF NOT EXISTS public.verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES public.quiz_runs(id) ON DELETE CASCADE,
  attempt_id UUID NOT NULL REFERENCES public.attempts(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES public.teachers(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  score_in_code INTEGER NOT NULL,
  score_in_db INTEGER NOT NULL,
  is_valid BOOLEAN NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_verifications_attempt_id ON public.verifications(attempt_id);
CREATE INDEX IF NOT EXISTS idx_verifications_teacher_id ON public.verifications(teacher_id);

-- 3.11 App Secrets (HMAC key for signing result QRs; no anon/authenticated access)
CREATE TABLE IF NOT EXISTS public.app_secrets (
  key_name TEXT PRIMARY KEY,
  secret_value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed HMAC key for result QRs if not present
INSERT INTO public.app_secrets (key_name, secret_value)
VALUES ('result_hmac_key', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (key_name) DO NOTHING;

-- Self-registration, string-based teacher accounts & class join code columns (safe re-run)
ALTER TABLE public.classes ADD COLUMN IF NOT EXISTS join_code TEXT UNIQUE DEFAULT upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 6));
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS pin_hash TEXT;

-- Allow standalone username/password teachers in public.teachers without requiring auth.users emails
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public' AND table_name = 'teachers' AND constraint_name = 'teachers_id_fkey'
  ) THEN
    ALTER TABLE public.teachers DROP CONSTRAINT teachers_id_fkey;
  END IF;
END $$;

ALTER TABLE public.teachers ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.teachers ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE public.teachers ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE public.teachers ADD COLUMN IF NOT EXISTS password_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_teachers_username_lower
  ON public.teachers (lower(username))
  WHERE username IS NOT NULL;

-- 3.12 Teacher Sessions (Token-authenticated string-username teacher sessions, 24h expiry)
CREATE TABLE IF NOT EXISTS public.teacher_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL REFERENCES public.teachers(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),
  revoked BOOLEAN NOT NULL DEFAULT false
);

-- 3.13 Optional Link-Based Classroom Run Sync Tables (used when SUPABASE_SERVICE_ROLE_KEY is set)
CREATE TABLE IF NOT EXISTS public.link_runs (
  run_id TEXT PRIMARY KEY,
  version_hash TEXT NOT NULL,
  class_id TEXT NOT NULL,
  class_name TEXT NOT NULL,
  quiz_id TEXT NOT NULL,
  title TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 15,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'running', 'ended')),
  created_at_sec BIGINT NOT NULL,
  started_at_server BIGINT,
  ends_at_server BIGINT,
  ended_at_server BIGINT,
  start_code TEXT,
  start_qr TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.link_joins (
  attempt_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES public.link_runs(run_id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  student_name TEXT NOT NULL,
  section TEXT NOT NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.link_submissions (
  attempt_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES public.link_runs(run_id) ON DELETE CASCADE,
  packet JSONB NOT NULL,
  plain JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.link_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.link_joins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.link_submissions ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_teacher_sessions_teacher_id ON public.teacher_sessions(teacher_id);
CREATE INDEX IF NOT EXISTS idx_teacher_sessions_token_hash ON public.teacher_sessions(token_hash);

-- Schema migration adaptation if previous prototype columns exist
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'students' AND column_name = 'student_number')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'students' AND column_name = 'student_no') THEN
    ALTER TABLE public.students RENAME COLUMN student_number TO student_no;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'quizzes' AND column_name = 'time_limit_mins')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'quizzes' AND column_name = 'duration_minutes') THEN
    ALTER TABLE public.quizzes RENAME COLUMN time_limit_mins TO duration_minutes;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'questions' AND column_name = 'correct_index') THEN
    ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS correct_index INTEGER NOT NULL DEFAULT 0;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'questions' AND column_name = 'salt')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'questions' AND column_name = 'feedback_salt') THEN
    ALTER TABLE public.questions RENAME COLUMN salt TO feedback_salt;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'questions' AND column_name = 'points') THEN
    ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS points INTEGER NOT NULL DEFAULT 1;
  END IF;
END $$;

-- ==============================================================================
-- 4. USER SIGNUP TRIGGER
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  INSERT INTO public.teachers (id, email, created_at)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, NEW.raw_user_meta_data->>'email', 'teacher_' || substr(NEW.id::text, 1, 8)),
    now()
  )
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ==============================================================================
-- 5. OWNERSHIP HELPER FUNCTIONS
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.owns_class(p_class_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.classes
    WHERE id = p_class_id AND teacher_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.owns_quiz(p_quiz_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.quizzes
    WHERE id = p_quiz_id AND teacher_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.owns_run(p_run_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.quiz_runs r
    JOIN public.classes c ON r.class_id = c.id
    WHERE r.id = p_run_id AND c.teacher_id = auth.uid()
  );
$$;

-- ==============================================================================
-- 6. ROW LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================

ALTER TABLE public.teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quizzes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quiz_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_secrets ENABLE ROW LEVEL SECURITY;

-- 6.1 Teachers Table
DROP POLICY IF EXISTS teachers_self_select ON public.teachers;
CREATE POLICY teachers_self_select ON public.teachers
  FOR SELECT TO authenticated USING (id = auth.uid());

DROP POLICY IF EXISTS teachers_self_update ON public.teachers;
CREATE POLICY teachers_self_update ON public.teachers
  FOR UPDATE TO authenticated USING (id = auth.uid());

-- 6.2 Classes Table
DROP POLICY IF EXISTS classes_teacher_select ON public.classes;
CREATE POLICY classes_teacher_select ON public.classes
  FOR SELECT TO authenticated USING (teacher_id = auth.uid());

DROP POLICY IF EXISTS classes_teacher_insert ON public.classes;
CREATE POLICY classes_teacher_insert ON public.classes
  FOR INSERT TO authenticated WITH CHECK (teacher_id = auth.uid());

DROP POLICY IF EXISTS classes_teacher_update ON public.classes;
CREATE POLICY classes_teacher_update ON public.classes
  FOR UPDATE TO authenticated USING (teacher_id = auth.uid());

DROP POLICY IF EXISTS classes_teacher_delete ON public.classes;
CREATE POLICY classes_teacher_delete ON public.classes
  FOR DELETE TO authenticated USING (teacher_id = auth.uid());

-- 6.3 Students Table (Teachers can only SELECT via owns_class; no direct INSERT/UPDATE/DELETE)
DROP POLICY IF EXISTS students_teacher_select ON public.students;
CREATE POLICY students_teacher_select ON public.students
  FOR SELECT TO authenticated USING (public.owns_class(class_id));

-- 6.4 Quizzes Table
DROP POLICY IF EXISTS quizzes_teacher_select ON public.quizzes;
CREATE POLICY quizzes_teacher_select ON public.quizzes
  FOR SELECT TO authenticated USING (teacher_id = auth.uid());

DROP POLICY IF EXISTS quizzes_teacher_insert ON public.quizzes;
CREATE POLICY quizzes_teacher_insert ON public.quizzes
  FOR INSERT TO authenticated WITH CHECK (teacher_id = auth.uid());

DROP POLICY IF EXISTS quizzes_teacher_update ON public.quizzes;
CREATE POLICY quizzes_teacher_update ON public.quizzes
  FOR UPDATE TO authenticated USING (teacher_id = auth.uid());

DROP POLICY IF EXISTS quizzes_teacher_delete ON public.quizzes;
CREATE POLICY quizzes_teacher_delete ON public.quizzes
  FOR DELETE TO authenticated USING (teacher_id = auth.uid());

-- 6.5 Questions Table
DROP POLICY IF EXISTS questions_teacher_select ON public.questions;
CREATE POLICY questions_teacher_select ON public.questions
  FOR SELECT TO authenticated USING (public.owns_quiz(quiz_id));

DROP POLICY IF EXISTS questions_teacher_insert ON public.questions;
CREATE POLICY questions_teacher_insert ON public.questions
  FOR INSERT TO authenticated WITH CHECK (public.owns_quiz(quiz_id));

DROP POLICY IF EXISTS questions_teacher_update ON public.questions;
CREATE POLICY questions_teacher_update ON public.questions
  FOR UPDATE TO authenticated USING (public.owns_quiz(quiz_id));

DROP POLICY IF EXISTS questions_teacher_delete ON public.questions;
CREATE POLICY questions_teacher_delete ON public.questions
  FOR DELETE TO authenticated USING (public.owns_quiz(quiz_id));

-- 6.6 Quiz Runs Table
DROP POLICY IF EXISTS quiz_runs_teacher_select ON public.quiz_runs;
CREATE POLICY quiz_runs_teacher_select ON public.quiz_runs
  FOR SELECT TO authenticated USING (public.owns_class(class_id));

DROP POLICY IF EXISTS quiz_runs_teacher_insert ON public.quiz_runs;
CREATE POLICY quiz_runs_teacher_insert ON public.quiz_runs
  FOR INSERT TO authenticated WITH CHECK (public.owns_class(class_id));

DROP POLICY IF EXISTS quiz_runs_teacher_update ON public.quiz_runs;
CREATE POLICY quiz_runs_teacher_update ON public.quiz_runs
  FOR UPDATE TO authenticated USING (public.owns_class(class_id));

-- 6.7 Attempts Table
DROP POLICY IF EXISTS attempts_teacher_select ON public.attempts;
CREATE POLICY attempts_teacher_select ON public.attempts
  FOR SELECT TO authenticated USING (public.owns_run(run_id));

DROP POLICY IF EXISTS attempts_teacher_update ON public.attempts;
CREATE POLICY attempts_teacher_update ON public.attempts
  FOR UPDATE TO authenticated USING (public.owns_run(run_id));

-- 6.8 Answers Table
DROP POLICY IF EXISTS answers_teacher_select ON public.answers;
CREATE POLICY answers_teacher_select ON public.answers
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.attempts a
      WHERE a.id = answers.attempt_id AND public.owns_run(a.run_id)
    )
  );

-- 6.9 Verifications Table
DROP POLICY IF EXISTS verifications_teacher_select ON public.verifications;
CREATE POLICY verifications_teacher_select ON public.verifications
  FOR SELECT TO authenticated USING (teacher_id = auth.uid());

DROP POLICY IF EXISTS verifications_teacher_insert ON public.verifications;
CREATE POLICY verifications_teacher_insert ON public.verifications
  FOR INSERT TO authenticated WITH CHECK (teacher_id = auth.uid());

-- Note: student_sessions and app_secrets have RLS enabled with NO policies for authenticated or anon.

-- ==============================================================================
-- 7. RUN RESULTS VIEW (SECURITY INVOKER)
-- ==============================================================================

CREATE OR REPLACE VIEW public.run_results
WITH (security_invoker = true)
AS
SELECT
  r.id AS run_id,
  r.quiz_id,
  r.class_id,
  s.id AS student_id,
  s.name AS student_name,
  s.student_no,
  COALESCE(a.status, 'not_started') AS status,
  COALESCE(ans_stats.answered_count, 0)::integer AS answered_count,
  COALESCE(a.score, 0)::integer AS score,
  COALESCE(a.max_score, q_stats.max_points, 0)::integer AS max_score,
  COALESCE(ans_stats.late_count, 0)::integer AS late_answers,
  (EXISTS (
    SELECT 1 FROM public.verifications v
    WHERE v.attempt_id = a.id AND v.is_valid = true
  )) AS is_verified,
  a.id AS attempt_id,
  a.started_at,
  a.submitted_at
FROM public.quiz_runs r
JOIN public.classes c ON r.class_id = c.id
JOIN public.students s ON s.class_id = c.id
LEFT JOIN public.attempts a ON a.run_id = r.id AND a.student_id = s.id
LEFT JOIN (
  SELECT
    quiz_id,
    SUM(points) AS max_points
  FROM public.questions
  GROUP BY quiz_id
) q_stats ON q_stats.quiz_id = r.quiz_id
LEFT JOIN (
  SELECT
    attempt_id,
    COUNT(*) AS answered_count,
    COUNT(*) FILTER (WHERE late_sync = true) AS late_count
  FROM public.answers
  GROUP BY attempt_id
) ans_stats ON ans_stats.attempt_id = a.id;

-- ==============================================================================
-- 8. TEACHER FUNCTIONS & INTERNAL SHARED HELPERS
-- ==============================================================================

CREATE OR REPLACE FUNCTION public._create_student_for_class(
  p_class_id UUID,
  p_name TEXT,
  p_student_no TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_secret TEXT;
  v_secret_hash TEXT;
  v_student_id UUID;
  v_clean_name TEXT;
  v_clean_student_no TEXT;
BEGIN
  v_clean_name := trim(p_name);
  v_clean_student_no := trim(p_student_no);

  IF v_clean_name = '' OR v_clean_student_no = '' THEN
    RAISE EXCEPTION 'Student name and student number must not be empty';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.students s
    WHERE s.class_id = p_class_id AND lower(s.student_no) = lower(v_clean_student_no)
  ) THEN
    RAISE EXCEPTION 'Student number % already exists in this class', v_clean_student_no;
  END IF;

  v_secret := encode(gen_random_bytes(24), 'hex');
  v_secret_hash := encode(digest(v_secret, 'sha256'), 'hex');
  v_student_id := gen_random_uuid();

  INSERT INTO public.students (id, class_id, name, student_no, qr_secret_hash)
  VALUES (v_student_id, p_class_id, v_clean_name, v_clean_student_no, v_secret_hash);

  RETURN 'QG1.' || v_student_id::text || '.' || v_secret;
END;
$$;

CREATE OR REPLACE FUNCTION public._import_students_for_class(
  p_class_id UUID,
  p_rows JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_item JSONB;
  v_name TEXT;
  v_student_no TEXT;
  v_secret TEXT;
  v_secret_hash TEXT;
  v_student_id UUID;
  v_payload TEXT;
  v_created JSONB := '[]'::jsonb;
  v_skipped JSONB := '[]'::jsonb;
BEGIN
  IF jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'Input rows must be a JSON array';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_name := trim(COALESCE(v_item->>'name', ''));
    v_student_no := trim(COALESCE(v_item->>'student_no', v_item->>'student_number', ''));

    IF v_name = '' OR v_student_no = '' THEN
      v_skipped := v_skipped || jsonb_build_object(
        'student_no', v_student_no,
        'name', v_name,
        'reason', 'Missing name or student number'
      );
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.class_id = p_class_id AND lower(s.student_no) = lower(v_student_no)
    ) THEN
      v_skipped := v_skipped || jsonb_build_object(
        'student_no', v_student_no,
        'name', v_name,
        'reason', 'Duplicate student number in class'
      );
      CONTINUE;
    END IF;

    v_student_id := gen_random_uuid();
    v_secret := encode(gen_random_bytes(24), 'hex');
    v_secret_hash := encode(digest(v_secret, 'sha256'), 'hex');

    INSERT INTO public.students (id, class_id, name, student_no, qr_secret_hash)
    VALUES (v_student_id, p_class_id, v_name, v_student_no, v_secret_hash);

    v_payload := 'QG1.' || v_student_id::text || '.' || v_secret;

    v_created := v_created || jsonb_build_object(
      'id', v_student_id,
      'name', v_name,
      'student_no', v_student_no,
      'qr_payload', v_payload
    );
  END LOOP;

  RETURN jsonb_build_object(
    'created', v_created,
    'skipped', v_skipped,
    'created_count', jsonb_array_length(v_created),
    'skipped_count', jsonb_array_length(v_skipped)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public._regenerate_student_qr_internal(
  p_student_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_secret TEXT;
  v_secret_hash TEXT;
BEGIN
  v_secret := encode(gen_random_bytes(24), 'hex');
  v_secret_hash := encode(digest(v_secret, 'sha256'), 'hex');

  UPDATE public.students
  SET qr_secret_hash = v_secret_hash
  WHERE id = p_student_id;

  UPDATE public.student_sessions
  SET revoked = true
  WHERE student_id = p_student_id AND revoked = false;

  RETURN 'QG1.' || p_student_id::text || '.' || v_secret;
END;
$$;

CREATE OR REPLACE FUNCTION public._start_run_internal(
  p_quiz_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_quiz RECORD;
  v_run_id UUID;
  v_q_count INTEGER;
  v_duration_interval INTERVAL;
BEGIN
  SELECT * INTO v_quiz FROM public.quizzes WHERE id = p_quiz_id;
  IF v_quiz IS NULL THEN
    RAISE EXCEPTION 'Quiz not found: %', p_quiz_id;
  END IF;

  SELECT COUNT(*) INTO v_q_count FROM public.questions WHERE quiz_id = p_quiz_id;
  IF v_q_count = 0 THEN
    RAISE EXCEPTION 'Cannot start run: Quiz has no questions';
  END IF;

  UPDATE public.attempts
  SET status = 'submitted', submitted_at = COALESCE(submitted_at, now())
  WHERE run_id IN (
    SELECT id FROM public.quiz_runs
    WHERE class_id = v_quiz.class_id AND status = 'running' AND ends_at <= now()
  ) AND status = 'in_progress';

  UPDATE public.quiz_runs
  SET status = 'ended'
  WHERE class_id = v_quiz.class_id AND status = 'running' AND ends_at <= now();

  IF EXISTS (
    SELECT 1 FROM public.quiz_runs
    WHERE class_id = v_quiz.class_id AND status = 'running'
  ) THEN
    RAISE EXCEPTION 'A quiz run is already active for this class. End it before starting a new run.';
  END IF;

  v_duration_interval := (v_quiz.duration_minutes || ' minutes')::interval;

  INSERT INTO public.quiz_runs (quiz_id, class_id, status, started_at, ends_at)
  VALUES (p_quiz_id, v_quiz.class_id, 'running', now(), now() + v_duration_interval)
  RETURNING id INTO v_run_id;

  RETURN v_run_id;
END;
$$;

CREATE OR REPLACE FUNCTION public._end_run_internal(
  p_run_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  UPDATE public.quiz_runs SET status = 'ended' WHERE id = p_run_id;
  UPDATE public.attempts
  SET status = 'submitted', submitted_at = COALESCE(submitted_at, now())
  WHERE run_id = p_run_id AND status = 'in_progress';
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public._verify_result_for_teacher(
  p_teacher_id UUID,
  p_code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_parts TEXT[];
  v_attempt_id UUID;
  v_code_score INTEGER;
  v_code_max INTEGER;
  v_code_epoch BIGINT;
  v_code_hmac TEXT;
  v_signed_payload TEXT;
  v_hmac_key TEXT;
  v_expected_hmac TEXT;
  v_sig_valid BOOLEAN;
  v_scores_match BOOLEAN;
  v_is_valid BOOLEAN;
  v_record RECORD;
BEGIN
  v_parts := string_to_array(trim(p_code), '.');
  IF array_length(v_parts, 1) <> 6 OR v_parts[1] <> 'QG1R' THEN
    RAISE EXCEPTION 'Invalid result QR format. Expected QG1R.<attempt_id>.<score>.<max>.<epoch>.<hmac>';
  END IF;

  BEGIN
    v_attempt_id := v_parts[2]::uuid;
    v_code_score := v_parts[3]::integer;
    v_code_max := v_parts[4]::integer;
    v_code_epoch := v_parts[5]::bigint;
    v_code_hmac := v_parts[6];
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'Invalid numeric or UUID values in result code payload';
  END;

  SELECT secret_value INTO v_hmac_key
  FROM public.app_secrets
  WHERE key_name = 'result_hmac_key';

  IF v_hmac_key IS NULL THEN
    RAISE EXCEPTION 'Server configuration error: Result HMAC key not found';
  END IF;

  v_signed_payload := 'QG1R.' || v_parts[2] || '.' || v_parts[3] || '.' || v_parts[4] || '.' || v_parts[5];
  v_expected_hmac := encode(hmac(v_signed_payload::bytea, v_hmac_key::bytea, 'sha256'), 'hex');
  v_sig_valid := (lower(v_code_hmac) = lower(v_expected_hmac));

  SELECT
    a.id AS attempt_id,
    a.run_id,
    a.score,
    a.max_score,
    s.name AS student_name,
    s.student_no AS student_no,
    c.teacher_id
  INTO v_record
  FROM public.attempts a
  JOIN public.quiz_runs r ON a.run_id = r.id
  JOIN public.classes c ON r.class_id = c.id
  JOIN public.students s ON a.student_id = s.id
  WHERE a.id = v_attempt_id;

  IF v_record IS NULL THEN
    RAISE EXCEPTION 'Attempt not found: %', v_attempt_id;
  END IF;

  IF v_record.teacher_id <> p_teacher_id THEN
    RAISE EXCEPTION 'Unauthorized: Quiz attempt does not belong to your classes';
  END IF;

  v_scores_match := (v_record.score = v_code_score);
  v_is_valid := (v_sig_valid AND v_scores_match);

  INSERT INTO public.verifications (
    run_id,
    attempt_id,
    teacher_id,
    code,
    score_in_code,
    score_in_db,
    is_valid,
    verified_at
  ) VALUES (
    v_record.run_id,
    v_record.attempt_id,
    p_teacher_id,
    p_code,
    v_code_score,
    v_record.score,
    v_is_valid,
    now()
  );

  RETURN jsonb_build_object(
    'student_name', v_record.student_name,
    'student_no', v_record.student_no,
    'score_in_code', v_code_score,
    'max_score', v_code_max,
    'score_in_db', v_record.score,
    'matches', v_scores_match,
    'signature_valid', v_sig_valid,
    'is_valid', v_is_valid
  );
END;
$$;

-- 8.1 create_student: authenticated teacher wrapper
CREATE OR REPLACE FUNCTION public.create_student(
  class_id UUID,
  name TEXT,
  student_no TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF NOT public.owns_class(class_id) THEN
    RAISE EXCEPTION 'Unauthorized: Class does not belong to caller';
  END IF;
  RETURN public._create_student_for_class(class_id, name, student_no);
END;
$$;

-- 8.2 import_students: authenticated teacher wrapper
CREATE OR REPLACE FUNCTION public.import_students(
  class_id UUID,
  rows JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF NOT public.owns_class(class_id) THEN
    RAISE EXCEPTION 'Unauthorized: Class does not belong to caller';
  END IF;
  RETURN public._import_students_for_class(class_id, rows);
END;
$$;

-- 8.3 regenerate_student_qr: authenticated teacher wrapper
CREATE OR REPLACE FUNCTION public.regenerate_student_qr(
  student_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_class_id UUID;
BEGIN
  SELECT class_id INTO v_class_id FROM public.students WHERE id = student_id;
  IF v_class_id IS NULL THEN
    RAISE EXCEPTION 'Student not found: %', student_id;
  END IF;
  IF NOT public.owns_class(v_class_id) THEN
    RAISE EXCEPTION 'Unauthorized: Caller does not own student class';
  END IF;
  RETURN public._regenerate_student_qr_internal(student_id);
END;
$$;

-- 8.4 start_run: authenticated teacher wrapper
CREATE OR REPLACE FUNCTION public.start_run(
  quiz_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF NOT public.owns_quiz(quiz_id) THEN
    RAISE EXCEPTION 'Unauthorized: Caller does not own quiz %', quiz_id;
  END IF;
  RETURN public._start_run_internal(quiz_id);
END;
$$;

-- 8.5 end_run: authenticated teacher wrapper
CREATE OR REPLACE FUNCTION public.end_run(
  run_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF NOT public.owns_run(run_id) THEN
    RAISE EXCEPTION 'Unauthorized: Caller does not own run %', run_id;
  END IF;
  RETURN public._end_run_internal(run_id);
END;
$$;

-- 8.6 verify_result: authenticated teacher wrapper
CREATE OR REPLACE FUNCTION public.verify_result(
  code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  RETURN public._verify_result_for_teacher(auth.uid(), code);
END;
$$;

-- ==============================================================================
-- 8B. STRING-ONLY TEACHER FUNCTIONS (SERVICE_ROLE ONLY, NO EMAIL REQUIRED)
-- ==============================================================================

CREATE OR REPLACE FUNCTION public._resolve_teacher_id(p_token TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_token_hash TEXT;
  v_teacher_id UUID;
BEGIN
  IF COALESCE(trim(p_token), '') = '' THEN
    RAISE EXCEPTION 'Unauthorized: Missing teacher session token';
  END IF;

  v_token_hash := encode(digest(trim(p_token), 'sha256'), 'hex');
  SELECT teacher_id INTO v_teacher_id
  FROM public.teacher_sessions
  WHERE token_hash = v_token_hash
    AND revoked = false
    AND expires_at > now();

  IF v_teacher_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Invalid or expired teacher session';
  END IF;

  RETURN v_teacher_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_register_username(
  p_username TEXT,
  p_display_name TEXT,
  p_password TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_clean_user TEXT := lower(trim(COALESCE(p_username, '')));
  v_clean_name TEXT := trim(COALESCE(p_display_name, ''));
  v_clean_pass TEXT := trim(COALESCE(p_password, ''));
  v_teacher_id UUID;
  v_raw_token TEXT;
  v_token_hash TEXT;
BEGIN
  IF length(v_clean_user) < 2 OR v_clean_user ~ '\s' THEN
    RAISE EXCEPTION 'Username must be at least 2 characters with no spaces';
  END IF;
  IF length(v_clean_pass) < 6 THEN
    RAISE EXCEPTION 'Password must be at least 6 characters';
  END IF;
  IF EXISTS (SELECT 1 FROM public.teachers WHERE lower(username) = v_clean_user) THEN
    RAISE EXCEPTION 'Username "%" is already taken. Sign in instead.', v_clean_user;
  END IF;

  v_teacher_id := gen_random_uuid();
  IF v_clean_name = '' THEN
    v_clean_name := v_clean_user;
  END IF;

  INSERT INTO public.teachers (id, username, display_name, password_hash, email)
  VALUES (
    v_teacher_id,
    v_clean_user,
    v_clean_name,
    crypt(v_clean_pass, gen_salt('bf')),
    NULL
  );

  v_raw_token := encode(gen_random_bytes(32), 'hex');
  v_token_hash := encode(digest(v_raw_token, 'sha256'), 'hex');
  INSERT INTO public.teacher_sessions (teacher_id, token_hash, expires_at, revoked)
  VALUES (v_teacher_id, v_token_hash, now() + interval '24 hours', false);

  RETURN jsonb_build_object(
    'session_token', v_raw_token,
    'teacher', jsonb_build_object(
      'id', v_teacher_id,
      'username', v_clean_user,
      'display_name', v_clean_name
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_login_username(
  p_username TEXT,
  p_password TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_clean_user TEXT := lower(trim(COALESCE(p_username, '')));
  v_clean_pass TEXT := trim(COALESCE(p_password, ''));
  v_teacher RECORD;
  v_raw_token TEXT;
  v_token_hash TEXT;
BEGIN
  SELECT id, username, display_name, password_hash INTO v_teacher
  FROM public.teachers
  WHERE lower(username) = v_clean_user;

  IF v_teacher IS NULL OR v_teacher.password_hash IS NULL THEN
    RAISE EXCEPTION 'Invalid username or password';
  END IF;

  IF crypt(v_clean_pass, v_teacher.password_hash) <> v_teacher.password_hash THEN
    RAISE EXCEPTION 'Invalid username or password';
  END IF;

  v_raw_token := encode(gen_random_bytes(32), 'hex');
  v_token_hash := encode(digest(v_raw_token, 'sha256'), 'hex');
  INSERT INTO public.teacher_sessions (teacher_id, token_hash, expires_at, revoked)
  VALUES (v_teacher.id, v_token_hash, now() + interval '24 hours', false);

  RETURN jsonb_build_object(
    'session_token', v_raw_token,
    'teacher', jsonb_build_object(
      'id', v_teacher.id,
      'username', v_teacher.username,
      'display_name', COALESCE(v_teacher.display_name, v_teacher.username)
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_get_workspace(
  p_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_teacher_id UUID := public._resolve_teacher_id(p_token);
  v_teacher RECORD;
  v_classes JSONB := '[]'::jsonb;
  v_quizzes JSONB := '[]'::jsonb;
  v_active_runs JSONB := '[]'::jsonb;
BEGIN
  SELECT id, username, display_name INTO v_teacher
  FROM public.teachers WHERE id = v_teacher_id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'join_code', c.join_code,
        'created_at', c.created_at,
        'students', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', s.id,
              'name', s.name,
              'student_no', s.student_no,
              'created_at', s.created_at
            ) ORDER BY s.name ASC
          )
          FROM public.students s WHERE s.class_id = c.id
        ), '[]'::jsonb)
      ) ORDER BY c.created_at DESC
    ),
    '[]'::jsonb
  ) INTO v_classes
  FROM public.classes c
  WHERE c.teacher_id = v_teacher_id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', qz.id,
        'title', qz.title,
        'class_id', qz.class_id,
        'duration_minutes', qz.duration_minutes,
        'instant_feedback', qz.instant_feedback,
        'allow_retry', qz.allow_retry,
        'created_at', qz.created_at,
        'questions', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', qq.id,
              'question_text', qq.question_text,
              'options', qq.options,
              'correct_index', qq.correct_index,
              'points', qq.points
            ) ORDER BY qq.sort_order ASC, qq.created_at ASC
          )
          FROM public.questions qq WHERE qq.quiz_id = qz.id
        ), '[]'::jsonb)
      ) ORDER BY qz.created_at DESC
    ),
    '[]'::jsonb
  ) INTO v_quizzes
  FROM public.quizzes qz
  WHERE qz.teacher_id = v_teacher_id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', r.id,
        'quiz_id', r.quiz_id,
        'class_id', r.class_id,
        'status', r.status,
        'started_at', r.started_at,
        'ends_at', r.ends_at
      ) ORDER BY r.started_at DESC
    ),
    '[]'::jsonb
  ) INTO v_active_runs
  FROM public.quiz_runs r
  JOIN public.classes c ON r.class_id = c.id
  WHERE c.teacher_id = v_teacher_id AND r.status = 'running';

  RETURN jsonb_build_object(
    'teacher', jsonb_build_object(
      'id', v_teacher.id,
      'username', v_teacher.username,
      'display_name', COALESCE(v_teacher.display_name, v_teacher.username)
    ),
    'classes', v_classes,
    'quizzes', v_quizzes,
    'active_runs', v_active_runs
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_create_class(
  p_token TEXT,
  p_name TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_teacher_id UUID := public._resolve_teacher_id(p_token);
  v_clean TEXT := trim(COALESCE(p_name, ''));
  v_code TEXT := upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 6));
  v_row RECORD;
BEGIN
  IF v_clean = '' THEN
    RAISE EXCEPTION 'Class name is required';
  END IF;

  INSERT INTO public.classes (teacher_id, name, join_code)
  VALUES (v_teacher_id, v_clean, v_code)
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'name', v_row.name,
    'join_code', v_row.join_code,
    'created_at', v_row.created_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_add_student(
  p_token TEXT,
  p_class_id UUID,
  p_name TEXT,
  p_student_no TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_teacher_id UUID := public._resolve_teacher_id(p_token);
  v_payload TEXT;
  v_stu_id TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.classes WHERE id = p_class_id AND teacher_id = v_teacher_id) THEN
    RAISE EXCEPTION 'Unauthorized: Class not found for your account';
  END IF;
  v_payload := public._create_student_for_class(p_class_id, p_name, p_student_no);
  v_stu_id := split_part(v_payload, '.', 2);
  RETURN jsonb_build_object(
    'id', v_stu_id,
    'name', trim(p_name),
    'student_no', trim(p_student_no),
    'qr_payload', v_payload
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_import_students(
  p_token TEXT,
  p_class_id UUID,
  p_rows JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_teacher_id UUID := public._resolve_teacher_id(p_token);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.classes WHERE id = p_class_id AND teacher_id = v_teacher_id) THEN
    RAISE EXCEPTION 'Unauthorized: Class not found for your account';
  END IF;
  RETURN public._import_students_for_class(p_class_id, p_rows);
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_regenerate_student_qr(
  p_token TEXT,
  p_student_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_teacher_id UUID := public._resolve_teacher_id(p_token);
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.students s
    JOIN public.classes c ON s.class_id = c.id
    WHERE s.id = p_student_id AND c.teacher_id = v_teacher_id
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Student not found for your classes';
  END IF;
  RETURN public._regenerate_student_qr_internal(p_student_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_create_quiz(
  p_token TEXT,
  p_class_id UUID,
  p_title TEXT,
  p_description TEXT,
  p_duration_minutes INTEGER,
  p_instant_feedback BOOLEAN,
  p_allow_retry BOOLEAN,
  p_questions JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_teacher_id UUID := public._resolve_teacher_id(p_token);
  v_quiz_id UUID;
  v_q JSONB;
  v_idx INTEGER := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.classes WHERE id = p_class_id AND teacher_id = v_teacher_id) THEN
    RAISE EXCEPTION 'Unauthorized: Class not found for your account';
  END IF;
  IF trim(COALESCE(p_title, '')) = '' OR jsonb_typeof(p_questions) <> 'array' OR jsonb_array_length(p_questions) = 0 THEN
    RAISE EXCEPTION 'Quiz title and at least one question are required';
  END IF;

  INSERT INTO public.quizzes (
    teacher_id, class_id, title, description, duration_minutes, instant_feedback, allow_retry
  ) VALUES (
    v_teacher_id,
    p_class_id,
    trim(p_title),
    COALESCE(p_description, ''),
    GREATEST(1, COALESCE(p_duration_minutes, 15)),
    COALESCE(p_instant_feedback, true),
    COALESCE(p_allow_retry, false)
  )
  RETURNING id INTO v_quiz_id;

  FOR v_q IN SELECT * FROM jsonb_array_elements(p_questions)
  LOOP
    INSERT INTO public.questions (
      quiz_id, question_text, options, correct_index, points, sort_order
    ) VALUES (
      v_quiz_id,
      COALESCE(v_q->>'prompt', v_q->>'question_text', ''),
      COALESCE(v_q->'options', '[]'::jsonb),
      COALESCE((v_q->>'correctIndex')::integer, (v_q->>'correct_index')::integer, 0),
      GREATEST(1, COALESCE((v_q->>'points')::integer, 1)),
      v_idx
    );
    v_idx := v_idx + 1;
  END LOOP;

  RETURN jsonb_build_object('quiz_id', v_quiz_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_start_run(
  p_token TEXT,
  p_quiz_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_teacher_id UUID := public._resolve_teacher_id(p_token);
  v_run_id UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.quizzes WHERE id = p_quiz_id AND teacher_id = v_teacher_id) THEN
    RAISE EXCEPTION 'Unauthorized: Quiz not found for your account';
  END IF;
  v_run_id := public._start_run_internal(p_quiz_id);
  RETURN jsonb_build_object('run_id', v_run_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_end_run(
  p_token TEXT,
  p_run_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_teacher_id UUID := public._resolve_teacher_id(p_token);
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.quiz_runs r
    JOIN public.classes c ON r.class_id = c.id
    WHERE r.id = p_run_id AND c.teacher_id = v_teacher_id
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Run not found for your classes';
  END IF;
  RETURN public._end_run_internal(p_run_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_get_run_results(
  p_token TEXT,
  p_run_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_teacher_id UUID := public._resolve_teacher_id(p_token);
  v_rows JSONB := '[]'::jsonb;
  v_run RECORD;
BEGIN
  SELECT r.* INTO v_run
  FROM public.quiz_runs r
  JOIN public.classes c ON r.class_id = c.id
  WHERE r.id = p_run_id AND c.teacher_id = v_teacher_id;

  IF v_run IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Run not found for your classes';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'run_id', rr.run_id,
        'student_id', rr.student_id,
        'student_name', rr.student_name,
        'student_no', rr.student_no,
        'status', rr.status,
        'answered_count', rr.answered_count,
        'score', rr.score,
        'max_score', rr.max_score,
        'late_answers', rr.late_answers,
        'is_verified', rr.is_verified
      ) ORDER BY rr.student_name ASC
    ),
    '[]'::jsonb
  ) INTO v_rows
  FROM public.run_results rr
  WHERE rr.run_id = p_run_id;

  RETURN jsonb_build_object(
    'run', jsonb_build_object(
      'id', v_run.id,
      'quiz_id', v_run.quiz_id,
      'status', v_run.status,
      'started_at', v_run.started_at,
      'ends_at', v_run.ends_at
    ),
    'results', v_rows
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_verify_result(
  p_token TEXT,
  p_code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_teacher_id UUID := public._resolve_teacher_id(p_token);
BEGIN
  RETURN public._verify_result_for_teacher(v_teacher_id, p_code);
END;
$$;

-- ==============================================================================
-- 9. STUDENT FUNCTIONS (SERVICE_ROLE ONLY)
-- Authenticated by session token argument in server routes.
-- ==============================================================================

-- 9.1 student_sign_in: validates QR, revokes older sessions, returns session token
CREATE OR REPLACE FUNCTION public.student_sign_in(
  qr_payload TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_parts TEXT[];
  v_student_id UUID;
  v_secret TEXT;
  v_secret_hash TEXT;
  v_student RECORD;
  v_raw_token TEXT;
  v_token_hash TEXT;
BEGIN
  v_parts := string_to_array(trim(qr_payload), '.');
  IF array_length(v_parts, 1) <> 3 OR v_parts[1] <> 'QG1' THEN
    RAISE EXCEPTION 'Invalid QR format. Expected QG1.<student_id>.<secret>';
  END IF;

  BEGIN
    v_student_id := v_parts[2]::uuid;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'Invalid student ID in QR payload';
  END;

  v_secret := v_parts[3];
  v_secret_hash := encode(digest(v_secret, 'sha256'), 'hex');

  SELECT id, class_id, name, student_no INTO v_student
  FROM public.students
  WHERE id = v_student_id AND qr_secret_hash = v_secret_hash;

  IF v_student IS NULL THEN
    RAISE EXCEPTION 'Invalid QR code or credentials';
  END IF;

  -- Revoke prior sessions (newest device wins)
  UPDATE public.student_sessions
  SET revoked = true
  WHERE student_id = v_student_id AND revoked = false;

  v_raw_token := encode(gen_random_bytes(32), 'hex');
  v_token_hash := encode(digest(v_raw_token, 'sha256'), 'hex');

  INSERT INTO public.student_sessions (student_id, token_hash, expires_at, revoked)
  VALUES (v_student_id, v_token_hash, now() + interval '12 hours', false);

  RETURN jsonb_build_object(
    'session_token', v_raw_token,
    'student', jsonb_build_object(
      'id', v_student.id,
      'name', v_student.name,
      'student_no', v_student.student_no,
      'class_id', v_student.class_id
    )
  );
END;
$$;

-- 9.2 student_get_state: returns state, run, attempt, answers, questions (no correct answers)
CREATE OR REPLACE FUNCTION public.student_get_state(
  token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_token_hash TEXT;
  v_session RECORD;
  v_student RECORD;
  v_run RECORD;
  v_quiz RECORD;
  v_attempt RECORD;
  v_max_score INTEGER := 0;
  v_answers JSONB := '[]'::jsonb;
  v_questions JSONB := '[]'::jsonb;
BEGIN
  v_token_hash := encode(digest(trim(token), 'sha256'), 'hex');

  SELECT * INTO v_session
  FROM public.student_sessions
  WHERE token_hash = v_token_hash
    AND revoked = false
    AND expires_at > now();

  IF v_session IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Invalid, expired, or revoked student session';
  END IF;

  SELECT id, class_id, name, student_no INTO v_student
  FROM public.students
  WHERE id = v_session.student_id;

  IF v_student IS NULL THEN
    RAISE EXCEPTION 'Student record not found';
  END IF;

  -- Get latest run for student's class
  SELECT * INTO v_run
  FROM public.quiz_runs
  WHERE class_id = v_student.class_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_run IS NOT NULL THEN
    SELECT * INTO v_quiz
    FROM public.quizzes
    WHERE id = v_run.quiz_id;

    -- Compute max score from questions
    SELECT COALESCE(SUM(points), 0) INTO v_max_score
    FROM public.questions
    WHERE quiz_id = v_run.quiz_id;

    -- Find or auto-initialize attempt if running
    SELECT * INTO v_attempt
    FROM public.attempts
    WHERE run_id = v_run.id AND student_id = v_student.id;

    IF v_attempt IS NULL AND v_run.status = 'running' AND now() < v_run.ends_at THEN
      INSERT INTO public.attempts (run_id, student_id, status, score, max_score, started_at)
      VALUES (v_run.id, v_student.id, 'in_progress', 0, v_max_score, now())
      RETURNING * INTO v_attempt;
    END IF;

    -- Load existing answers if attempt exists
    IF v_attempt IS NOT NULL THEN
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'question_id', a.question_id,
            'selected_index', a.selected_index,
            'is_correct', CASE WHEN v_quiz.instant_feedback OR v_run.status = 'ended' THEN a.is_correct ELSE NULL END,
            'answered_at', a.answered_at,
            'late_sync', a.late_sync
          ) ORDER BY a.answered_at ASC
        ),
        '[]'::jsonb
      ) INTO v_answers
      FROM public.answers a
      WHERE a.attempt_id = v_attempt.id;
    END IF;

    -- Load questions: NEVER expose correct_index. Include feedback_salt and correct_hash if instant_feedback = true
    IF v_run.status = 'running' OR (v_attempt IS NOT NULL AND v_attempt.status = 'in_progress') THEN
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', q.id,
            'question_text', q.question_text,
            'options', q.options,
            'points', q.points,
            'sort_order', q.sort_order,
            'feedback_salt', CASE WHEN v_quiz.instant_feedback THEN q.feedback_salt ELSE NULL END,
            'correct_hash', CASE
              WHEN v_quiz.instant_feedback THEN encode(digest(q.id::text || ':' || q.correct_index::text || ':' || q.feedback_salt, 'sha256'), 'hex')
              ELSE NULL
            END
          ) ORDER BY q.sort_order ASC, q.created_at ASC
        ),
        '[]'::jsonb
      ) INTO v_questions
      FROM public.questions q
      WHERE q.quiz_id = v_run.quiz_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'server_now', now(),
    'student', jsonb_build_object(
      'id', v_student.id,
      'name', v_student.name,
      'student_no', v_student.student_no,
      'class_id', v_student.class_id
    ),
    'run', CASE WHEN v_run IS NOT NULL THEN jsonb_build_object(
      'id', v_run.id,
      'quiz_id', v_run.quiz_id,
      'status', v_run.status,
      'started_at', v_run.started_at,
      'ends_at', v_run.ends_at
    ) ELSE NULL END,
    'quiz', CASE WHEN v_quiz IS NOT NULL THEN jsonb_build_object(
      'id', v_quiz.id,
      'title', v_quiz.title,
      'description', v_quiz.description,
      'duration_minutes', v_quiz.duration_minutes,
      'instant_feedback', v_quiz.instant_feedback,
      'allow_retry', v_quiz.allow_retry
    ) ELSE NULL END,
    'attempt', CASE WHEN v_attempt IS NOT NULL THEN jsonb_build_object(
      'id', v_attempt.id,
      'status', v_attempt.status,
      'score', v_attempt.score,
      'max_score', v_attempt.max_score,
      'started_at', v_attempt.started_at,
      'submitted_at', v_attempt.submitted_at
    ) ELSE NULL END,
    'answers', v_answers,
    'questions', v_questions
  );
END;
$$;

-- 9.3 student_submit_answers: idempotent, server-graded, enforces timing and retry policy
CREATE OR REPLACE FUNCTION public.student_submit_answers(
  token TEXT,
  run_id UUID,
  answers JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_token_hash TEXT;
  v_session RECORD;
  v_student RECORD;
  v_run RECORD;
  v_quiz RECORD;
  v_attempt RECORD;
  v_item JSONB;
  v_q_id UUID;
  v_selected_idx INTEGER;
  v_answered_at TIMESTAMPTZ;
  v_is_late_sync BOOLEAN;
  v_question RECORD;
  v_is_correct BOOLEAN;
  v_existing_ans RECORD;
  v_total_score INTEGER := 0;
  v_max_score INTEGER := 0;
  v_synced_count INTEGER := 0;
BEGIN
  v_token_hash := encode(digest(trim(token), 'sha256'), 'hex');

  SELECT * INTO v_session
  FROM public.student_sessions
  WHERE token_hash = v_token_hash
    AND revoked = false
    AND expires_at > now();

  IF v_session IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Invalid, expired, or revoked student session';
  END IF;

  SELECT id, class_id INTO v_student
  FROM public.students
  WHERE id = v_session.student_id;

  SELECT * INTO v_run
  FROM public.quiz_runs
  WHERE id = run_id;

  IF v_run IS NULL THEN
    RAISE EXCEPTION 'Quiz run not found: %', run_id;
  END IF;

  IF v_run.class_id <> v_student.class_id THEN
    RAISE EXCEPTION 'Unauthorized: Quiz run does not belong to student class';
  END IF;

  SELECT * INTO v_quiz
  FROM public.quizzes
  WHERE id = v_run.quiz_id;

  -- Find or create attempt
  SELECT * INTO v_attempt
  FROM public.attempts
  WHERE attempts.run_id = student_submit_answers.run_id
    AND attempts.student_id = v_student.id;

  IF v_attempt IS NULL THEN
    SELECT COALESCE(SUM(points), 0) INTO v_max_score
    FROM public.questions
    WHERE quiz_id = v_run.quiz_id;

    INSERT INTO public.attempts (run_id, student_id, status, score, max_score, started_at)
    VALUES (run_id, v_student.id, 'in_progress', 0, v_max_score, now())
    RETURNING * INTO v_attempt;
  END IF;

  -- Late sync condition: sync arrives > 10s after ends_at
  v_is_late_sync := (now() > (v_run.ends_at + interval '10 seconds'));

  IF jsonb_typeof(answers) <> 'array' THEN
    RAISE EXCEPTION 'Answers parameter must be a JSON array';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(answers)
  LOOP
    BEGIN
      v_q_id := (v_item->>'question_id')::uuid;
      v_selected_idx := (v_item->>'selected_index')::integer;
      v_answered_at := (v_item->>'answered_at')::timestamptz;
    EXCEPTION WHEN others THEN
      CONTINUE; -- Skip invalid element formatting
    END;

    -- Reject answer if client answered after server deadline
    IF v_answered_at > v_run.ends_at THEN
      CONTINUE;
    END IF;

    -- Reject answer if client timestamp is > 30s in the future
    IF v_answered_at > (now() + interval '30 seconds') THEN
      CONTINUE;
    END IF;

    -- Validate question exists for this quiz
    SELECT * INTO v_question
    FROM public.questions
    WHERE id = v_q_id AND quiz_id = v_run.quiz_id;

    IF v_question IS NULL THEN
      CONTINUE;
    END IF;

    -- Validate selected option bounds
    IF v_selected_idx < 0 OR v_selected_idx >= jsonb_array_length(v_question.options) THEN
      CONTINUE;
    END IF;

    -- Server-side grading
    v_is_correct := (v_question.correct_index = v_selected_idx);

    SELECT * INTO v_existing_ans
    FROM public.answers
    WHERE attempt_id = v_attempt.id AND question_id = v_q_id;

    IF v_existing_ans IS NOT NULL THEN
      -- If retry is not allowed, first answer is locked
      IF NOT v_quiz.allow_retry THEN
        CONTINUE;
      ELSE
        UPDATE public.answers
        SET selected_index = v_selected_idx,
            is_correct = v_is_correct,
            answered_at = v_answered_at,
            synced_at = now(),
            late_sync = v_is_late_sync
        WHERE id = v_existing_ans.id;
        v_synced_count := v_synced_count + 1;
      END IF;
    ELSE
      INSERT INTO public.answers (
        attempt_id,
        question_id,
        selected_index,
        is_correct,
        answered_at,
        synced_at,
        late_sync
      ) VALUES (
        v_attempt.id,
        v_q_id,
        v_selected_idx,
        v_is_correct,
        v_answered_at,
        now(),
        v_is_late_sync
      );
      v_synced_count := v_synced_count + 1;
    END IF;
  END LOOP;

  -- Recalculate attempt score and max_score
  SELECT COALESCE(SUM(q.points), 0) INTO v_total_score
  FROM public.answers ans
  JOIN public.questions q ON ans.question_id = q.id
  WHERE ans.attempt_id = v_attempt.id AND ans.is_correct = true;

  SELECT COALESCE(SUM(points), 0) INTO v_max_score
  FROM public.questions
  WHERE quiz_id = v_run.quiz_id;

  UPDATE public.attempts
  SET score = v_total_score, max_score = v_max_score
  WHERE id = v_attempt.id;

  RETURN jsonb_build_object(
    'success', true,
    'attempt_id', v_attempt.id,
    'score', v_total_score,
    'max_score', v_max_score,
    'synced_count', v_synced_count,
    'server_now', now()
  );
END;
$$;

-- 9.4 student_finish: submits attempt and returns signed result QR payload
CREATE OR REPLACE FUNCTION public.student_finish(
  token TEXT,
  run_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_token_hash TEXT;
  v_session RECORD;
  v_student RECORD;
  v_attempt RECORD;
  v_epoch BIGINT;
  v_hmac_key TEXT;
  v_signed_payload TEXT;
  v_hmac TEXT;
  v_result_code TEXT;
BEGIN
  v_token_hash := encode(digest(trim(token), 'sha256'), 'hex');

  SELECT * INTO v_session
  FROM public.student_sessions
  WHERE token_hash = v_token_hash
    AND revoked = false
    AND expires_at > now();

  IF v_session IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Invalid, expired, or revoked student session';
  END IF;

  SELECT id INTO v_student
  FROM public.students
  WHERE id = v_session.student_id;

  SELECT * INTO v_attempt
  FROM public.attempts
  WHERE attempts.run_id = student_finish.run_id
    AND attempts.student_id = v_student.id;

  IF v_attempt IS NULL THEN
    RAISE EXCEPTION 'Attempt not found for run %', run_id;
  END IF;

  -- Mark attempt submitted
  IF v_attempt.status <> 'submitted' THEN
    UPDATE public.attempts
    SET status = 'submitted', submitted_at = now()
    WHERE id = v_attempt.id
    RETURNING * INTO v_attempt;
  END IF;

  SELECT secret_value INTO v_hmac_key
  FROM public.app_secrets
  WHERE key_name = 'result_hmac_key';

  IF v_hmac_key IS NULL THEN
    RAISE EXCEPTION 'Server configuration error: Result HMAC key not found';
  END IF;

  v_epoch := extract(epoch from COALESCE(v_attempt.submitted_at, now()))::bigint;
  v_signed_payload := 'QG1R.' || v_attempt.id::text || '.' || v_attempt.score::text || '.' || v_attempt.max_score::text || '.' || v_epoch::text;
  v_hmac := encode(hmac(v_signed_payload::bytea, v_hmac_key::bytea, 'sha256'), 'hex');
  v_result_code := v_signed_payload || '.' || v_hmac;

  RETURN jsonb_build_object(
    'result_code', v_result_code,
    'attempt_id', v_attempt.id,
    'score', v_attempt.score,
    'max_score', v_attempt.max_score,
    'status', 'submitted',
    'submitted_at', v_attempt.submitted_at
  );
END;
$$;

-- 9.5 student_get_result: returns signed result QR payload for completed attempt
CREATE OR REPLACE FUNCTION public.student_get_result(
  token TEXT,
  run_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_token_hash TEXT;
  v_session RECORD;
  v_student RECORD;
  v_attempt RECORD;
  v_run RECORD;
  v_epoch BIGINT;
  v_hmac_key TEXT;
  v_signed_payload TEXT;
  v_hmac TEXT;
  v_result_code TEXT;
BEGIN
  v_token_hash := encode(digest(trim(token), 'sha256'), 'hex');

  SELECT * INTO v_session
  FROM public.student_sessions
  WHERE token_hash = v_token_hash
    AND revoked = false
    AND expires_at > now();

  IF v_session IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: Invalid, expired, or revoked student session';
  END IF;

  SELECT id INTO v_student
  FROM public.students
  WHERE id = v_session.student_id;

  SELECT * INTO v_attempt
  FROM public.attempts
  WHERE attempts.run_id = student_get_result.run_id
    AND attempts.student_id = v_student.id;

  IF v_attempt IS NULL THEN
    RAISE EXCEPTION 'Attempt not found for run %', run_id;
  END IF;

  -- If run ended or submitted, auto-finalize submitted timestamp if missing
  IF v_attempt.status <> 'submitted' THEN
    SELECT * INTO v_run FROM public.quiz_runs WHERE id = student_get_result.run_id;
    IF v_run.status = 'ended' OR now() >= v_run.ends_at THEN
      UPDATE public.attempts
      SET status = 'submitted', submitted_at = now()
      WHERE id = v_attempt.id
      RETURNING * INTO v_attempt;
    END IF;
  END IF;

  SELECT secret_value INTO v_hmac_key
  FROM public.app_secrets
  WHERE key_name = 'result_hmac_key';

  IF v_hmac_key IS NULL THEN
    RAISE EXCEPTION 'Server configuration error: Result HMAC key not found';
  END IF;

  v_epoch := extract(epoch from COALESCE(v_attempt.submitted_at, v_attempt.started_at, now()))::bigint;
  v_signed_payload := 'QG1R.' || v_attempt.id::text || '.' || v_attempt.score::text || '.' || v_attempt.max_score::text || '.' || v_epoch::text;
  v_hmac := encode(hmac(v_signed_payload::bytea, v_hmac_key::bytea, 'sha256'), 'hex');
  v_result_code := v_signed_payload || '.' || v_hmac;

  RETURN jsonb_build_object(
    'result_code', v_result_code,
    'attempt_id', v_attempt.id,
    'score', v_attempt.score,
    'max_score', v_attempt.max_score,
    'status', v_attempt.status,
    'submitted_at', v_attempt.submitted_at
  );
END;
$$;

-- 9.6 student_register_with_code: self-registration via teacher join code + PIN
CREATE OR REPLACE FUNCTION public.student_register_with_code(
  p_join_code TEXT,
  p_name TEXT,
  p_student_no TEXT,
  p_pin TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_class RECORD;
  v_student_id UUID;
  v_qr_secret TEXT;
  v_qr_hash TEXT;
  v_pin_hash TEXT;
  v_raw_token TEXT;
  v_token_hash TEXT;
BEGIN
  SELECT * INTO v_class
  FROM public.classes
  WHERE upper(join_code) = upper(trim(p_join_code));

  IF v_class IS NULL THEN
    RAISE EXCEPTION 'Invalid class join code';
  END IF;

  IF trim(p_name) = '' OR trim(p_student_no) = '' OR length(trim(p_pin)) < 4 THEN
    RAISE EXCEPTION 'Name, student number, and a 4+ character PIN/password are required';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.students
    WHERE class_id = v_class.id AND lower(student_no) = lower(trim(p_student_no))
  ) THEN
    RAISE EXCEPTION 'Student number already registered in this class. Please sign in instead.';
  END IF;

  v_student_id := gen_random_uuid();
  v_qr_secret := encode(gen_random_bytes(24), 'hex');
  v_qr_hash := encode(digest(v_qr_secret, 'sha256'), 'hex');
  v_pin_hash := encode(digest(v_student_id::text || ':' || trim(p_pin), 'sha256'), 'hex');

  INSERT INTO public.students (id, class_id, name, student_no, qr_secret_hash, pin_hash)
  VALUES (v_student_id, v_class.id, trim(p_name), trim(p_student_no), v_qr_hash, v_pin_hash);

  v_raw_token := encode(gen_random_bytes(32), 'hex');
  v_token_hash := encode(digest(v_raw_token, 'sha256'), 'hex');

  INSERT INTO public.student_sessions (student_id, token_hash, expires_at, revoked)
  VALUES (v_student_id, v_token_hash, now() + interval '12 hours', false);

  RETURN jsonb_build_object(
    'session_token', v_raw_token,
    'qr_payload', 'QG1.' || v_student_id::text || '.' || v_qr_secret,
    'student', jsonb_build_object(
      'id', v_student_id,
      'name', trim(p_name),
      'student_no', trim(p_student_no),
      'class_id', v_class.id,
      'class_name', v_class.name
    )
  );
END;
$$;

-- 9.7 student_sign_in_with_pin: sign in with join code, student_no, and PIN
CREATE OR REPLACE FUNCTION public.student_sign_in_with_pin(
  p_join_code TEXT,
  p_student_no TEXT,
  p_pin TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_class RECORD;
  v_student RECORD;
  v_expected_pin_hash TEXT;
  v_raw_token TEXT;
  v_token_hash TEXT;
BEGIN
  SELECT * INTO v_class
  FROM public.classes
  WHERE upper(join_code) = upper(trim(p_join_code));

  IF v_class IS NULL THEN
    RAISE EXCEPTION 'Invalid class join code';
  END IF;

  SELECT * INTO v_student
  FROM public.students
  WHERE class_id = v_class.id AND lower(student_no) = lower(trim(p_student_no));

  IF v_student IS NULL OR v_student.pin_hash IS NULL THEN
    RAISE EXCEPTION 'Invalid student credentials or account created via QR card only';
  END IF;

  v_expected_pin_hash := encode(digest(v_student.id::text || ':' || trim(p_pin), 'sha256'), 'hex');
  IF v_expected_pin_hash <> v_student.pin_hash THEN
    RAISE EXCEPTION 'Incorrect password or PIN';
  END IF;

  UPDATE public.student_sessions
  SET revoked = true
  WHERE student_id = v_student.id AND revoked = false;

  v_raw_token := encode(gen_random_bytes(32), 'hex');
  v_token_hash := encode(digest(v_raw_token, 'sha256'), 'hex');

  INSERT INTO public.student_sessions (student_id, token_hash, expires_at, revoked)
  VALUES (v_student.id, v_token_hash, now() + interval '12 hours', false);

  RETURN jsonb_build_object(
    'session_token', v_raw_token,
    'student', jsonb_build_object(
      'id', v_student.id,
      'name', v_student.name,
      'student_no', v_student.student_no,
      'class_id', v_class.id,
      'class_name', v_class.name
    )
  );
END;
$$;

-- ==============================================================================
-- 10. REALTIME PUBLICATIONS
-- ==============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'attempts'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.attempts;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'answers'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.answers;
    END IF;
  END IF;
END $$;

-- ==============================================================================
-- 11. PERMISSIONS & GRANTS
-- ==============================================================================

-- Revoke default execute from PUBLIC, anon, authenticated
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;

-- Revoke table access from anon and default authenticated
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;

-- Grant column-level SELECT on students to authenticated (hiding qr_secret_hash)
GRANT SELECT (id, class_id, name, student_no, created_at) ON public.students TO authenticated;

-- Grant table privileges to authenticated (governed by RLS)
GRANT SELECT, UPDATE ON public.teachers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.classes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quizzes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.questions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.quiz_runs TO authenticated;
GRANT SELECT, UPDATE ON public.attempts TO authenticated;
GRANT SELECT ON public.answers TO authenticated;
GRANT SELECT, INSERT ON public.verifications TO authenticated;
GRANT SELECT ON public.run_results TO authenticated;

-- Grant EXECUTE on teacher & helper functions to authenticated
GRANT EXECUTE ON FUNCTION public.owns_class(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.owns_quiz(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.owns_run(UUID) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.create_student(UUID, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.import_students(UUID, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.regenerate_student_qr(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.start_run(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.end_run(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.verify_result(TEXT) TO authenticated, service_role;

-- String-only teacher & student RPCs: EXECUTE granted to service_role ONLY
GRANT EXECUTE ON FUNCTION public.teacher_register_username(TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.teacher_login_username(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.teacher_get_workspace(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.teacher_create_class(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.teacher_add_student(TEXT, UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.teacher_import_students(TEXT, UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.teacher_regenerate_student_qr(TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.teacher_create_quiz(TEXT, UUID, TEXT, TEXT, INTEGER, BOOLEAN, BOOLEAN, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.teacher_start_run(TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.teacher_end_run(TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.teacher_get_run_results(TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.teacher_verify_result(TEXT, TEXT) TO service_role;

GRANT EXECUTE ON FUNCTION public.student_sign_in(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.student_get_state(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.student_submit_answers(TEXT, UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.student_finish(TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.student_get_result(TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.student_register_with_code(TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.student_sign_in_with_pin(TEXT, TEXT, TEXT) TO service_role;

-- Full access for service_role
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO service_role;
