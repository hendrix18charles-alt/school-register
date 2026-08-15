-- Run this whole file once in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.

create extension if not exists "pgcrypto";

create table if not exists teachers (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  password text not null,
  role text not null check (role in ('admin', 'teacher')),
  level text,
  stream text,
  created_at timestamptz default now()
);

create table if not exists students (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  level text not null,
  stream text default '',
  guardian_contact text default '',
  notes text default '',
  created_at timestamptz default now()
);

create table if not exists attendance (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  date date not null,
  status text not null check (status in ('present', 'late', 'absent', 'excused')),
  recorded_by text,
  created_at timestamptz default now(),
  unique (student_id, date)
);

create table if not exists grades (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  subject text not null,
  score numeric not null,
  max_score numeric not null,
  date date not null,
  recorded_by text,
  created_at timestamptz default now()
);

create table if not exists settings (
  key text primary key,
  value text
);

-- NOTE ON SECURITY -----------------------------------------------------
-- Row Level Security is left OFF here so the app works immediately with
-- just the anon key, matching the original prototype's "lightweight
-- access gate, not bank-grade security" design. Any holder of your
-- anon key can read/write every table. This is fine for testing with a
-- small trusted staff, but before using this with real student data
-- long-term, you should:
--   1. Enable Supabase Auth (email/password) for teacher accounts
--      instead of the custom `teachers` table with plaintext passwords.
--   2. Enable RLS on every table and write policies keyed to
--      auth.uid() so teachers only see their assigned class server-side
--      (right now that scoping is enforced only in the app's UI).
-- -------------------------------------------------------------------
