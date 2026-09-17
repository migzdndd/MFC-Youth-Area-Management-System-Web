-- MFC Youth Area Management System - Backend Phase 6.1
-- Run this in the Supabase SQL Editor for a NEW project.
-- The service-role-backed API is currently the only data access path.

create extension if not exists pgcrypto;

create table if not exists public.areas (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chapters (
  id uuid primary key default gen_random_uuid(),
  area_id uuid not null references public.areas(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(area_id, name)
);

create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  area_id uuid not null references public.areas(id) on delete restrict,
  chapter_id uuid references public.chapters(id) on delete set null,
  first_name text not null,
  middle_name text,
  last_name text not null,
  birth_date date,
  contact_number text,
  email text not null,
  address text,
  status text not null default 'Active' check (status in ('Active', 'Inactive')),
  first_attended_youth_camp date,
  access_level text not null default 'member' check (
    access_level in ('couple_coordinator', 'area_servant', 'lit_servant', 'campus_servant', 'area_kids_servant', 'chapter_servant', 'member')
  ),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists members_email_lower_unique
  on public.members (lower(email));

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  member_id uuid unique references public.members(id) on delete cascade,
  role text not null default 'member' check (
    role in ('couple_coordinator', 'area_servant', 'lit_servant', 'campus_servant', 'area_kids_servant', 'chapter_servant', 'member')
  ),
  area_id uuid references public.areas(id) on delete restrict,
  chapter_id uuid references public.chapters(id) on delete set null,
  must_change_password boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  area_id uuid not null references public.areas(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(area_id, name)
);

create table if not exists public.member_services (
  member_id uuid not null references public.members(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(member_id, service_id)
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  area_id uuid not null references public.areas(id) on delete cascade,
  name text not null,
  description text,
  venue text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  fee numeric(12,2) not null default 0 check (fee >= 0),
  manual_attendance integer not null default 0 check (manual_attendance >= 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.event_participants (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  mode_of_payment text,
  payment_status text not null default 'Pending',
  attended boolean not null default false,
  registered_by uuid references auth.users(id) on delete set null,
  registered_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(event_id, member_id)
);

create table if not exists public.activity_reports (
  id uuid primary key default gen_random_uuid(),
  area_id uuid not null references public.areas(id) on delete cascade,
  chapter_id uuid references public.chapters(id) on delete set null,
  prepared_by_member_id uuid references public.members(id) on delete set null,
  prepared_by_name text,
  chapter_name_snapshot text,
  report_type text not null,
  activity_date date not null,
  title text,
  activity text,
  participant_count integer not null default 0 check (participant_count >= 0),
  location text,
  event_id uuid references public.events(id) on delete set null,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.gig_contributions (
  id uuid primary key default gen_random_uuid(),
  area_id uuid not null references public.areas(id) on delete cascade,
  chapter_id uuid references public.chapters(id) on delete set null,
  member_id uuid not null references public.members(id) on delete cascade,
  amount numeric(12,2) not null default 0 check (amount >= 0),
  contribution_date date not null default current_date,
  notes text,
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Backend Phase 6.1 uses Vercel server functions + the Supabase service role.
-- RLS is enabled with NO public policies so browser clients cannot access tables directly.
alter table public.areas enable row level security;
alter table public.chapters enable row level security;
alter table public.members enable row level security;
alter table public.profiles enable row level security;
alter table public.services enable row level security;
alter table public.member_services enable row level security;
alter table public.events enable row level security;
alter table public.event_participants enable row level security;
alter table public.activity_reports enable row level security;
alter table public.gig_contributions enable row level security;

-- Update helper. Triggers can be added table-by-table later as CRUD endpoints are migrated.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['areas','chapters','members','profiles','services','events','event_participants','activity_reports']
  loop
    execute format('drop trigger if exists %I_set_updated_at on public.%I', t, t);
    execute format(
      'create trigger %I_set_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      t, t
    );
  end loop;
end $$;
