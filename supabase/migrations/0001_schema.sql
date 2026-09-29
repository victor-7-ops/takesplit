create table bands (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text unique not null,
  created_by uuid references auth.users not null,
  created_at timestamptz default now()
);

create table band_members (
  band_id uuid references bands on delete cascade,
  user_id uuid references auth.users on delete cascade,
  display_name text not null,
  role text not null default 'member' check (role in ('owner','member')),
  primary key (band_id, user_id)
);

create table songs (
  id uuid primary key default gen_random_uuid(),
  band_id uuid references bands on delete cascade not null,
  title text not null,
  unique (band_id, title)
);

create table rehearsals (
  id uuid primary key default gen_random_uuid(),
  band_id uuid references bands on delete cascade not null,
  title text,
  recorded_on date not null default current_date,
  storage_path text not null,
  peaks_path text,
  duration_sec numeric,
  status text not null default 'uploading'
    check (status in ('uploading','uploaded','processing','ready','failed')),
  error_message text,
  detection_params jsonb,
  created_by uuid references auth.users,
  created_at timestamptz default now()
);

create table clips (
  id uuid primary key default gen_random_uuid(),
  rehearsal_id uuid references rehearsals on delete cascade not null,
  start_sec numeric not null,
  end_sec numeric not null check (end_sec > start_sec),
  kind text not null default 'take' check (kind in ('take','talk')),
  song_id uuid references songs on delete set null,
  take_number int,
  rating smallint check (rating between 1 and 3),
  tags text[] not null default '{}',
  notes text,
  auto_detected boolean not null default true,
  created_at timestamptz default now()
);

create table comments (
  id uuid primary key default gen_random_uuid(),
  clip_id uuid references clips on delete cascade not null,
  user_id uuid references auth.users not null,
  at_sec numeric,
  body text not null,
  created_at timestamptz default now()
);
