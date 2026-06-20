create table if not exists public.speaking_submissions (
  id uuid primary key,
  student_name text not null,
  grade text not null,
  class_name text default '',
  submitted_at timestamptz not null default now(),
  answers jsonb not null default '[]'::jsonb,
  ratings jsonb not null default '{}'::jsonb,
  teacher_notes jsonb not null default '{}'::jsonb,
  ai_feedback jsonb not null default '{}'::jsonb,
  total_score text default '',
  reviewed_at timestamptz
);

create index if not exists speaking_submissions_submitted_at_idx
  on public.speaking_submissions (submitted_at desc);

insert into storage.buckets (id, name, public)
values ('speaking-audio', 'speaking-audio', false)
on conflict (id) do nothing;
