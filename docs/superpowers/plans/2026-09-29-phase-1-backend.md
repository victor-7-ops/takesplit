# Phase 1 Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Supabase schema, row-level security, and storage policies from `HANDOFF.md` §7, proving with a pgTAP test suite that a user who isn't a band member cannot read or write another band's data.

**Architecture:** Three sequential SQL migrations (schema → RLS → storage), following Supabase CLI's standard `supabase/migrations/NNNN_name.sql` naming convention, plus a pgTAP test file under `supabase/tests/database/`. Every table's access rule reduces to one question — "is this user a member of the band that owns this row?" — answered by a single reusable `is_band_member(band_id)` SQL function, exactly as `HANDOFF.md` §7 specifies.

**Tech Stack:** PostgreSQL (Supabase's flavor — `auth.users`, `auth.uid()`, `storage.objects`), pgTAP for RLS tests, Supabase CLI conventions for file layout.

**Known constraint:** Docker Desktop is installed on this machine but its daemon isn't running yet (needs a manual first-launch), and the Supabase CLI isn't installed. This plan writes correct, reviewable `.sql` files in the exact layout `supabase test db` expects, but the pgTAP suite is NOT executed as part of this plan — Task 6 is a manual step for Victor once Docker Desktop and the Supabase CLI are set up, mirroring how Phase 0's real-recording accuracy check was a manual, unautomatable step.

---

## File Structure

```
supabase/
├── migrations/
│   ├── 0001_schema.sql       # 6 tables from HANDOFF.md §7, no RLS yet
│   ├── 0002_rls.sql          # is_band_member() + is_band_owner() helpers, RLS policies on all 6 tables
│   └── 0003_storage.sql      # 'rehearsals' bucket + path-scoped storage.objects policies
└── tests/
    └── database/
        └── rls.test.sql      # pgTAP suite: two bands, two users, proves cross-band isolation
```

Each migration is one concern: schema shape, then access control, then file storage access control. This matches how Supabase migrations are meant to be read and re-run in order, and keeps the RLS logic (the part that actually protects user data) isolated in its own file for review.

---

## Task 1: Schema migration

**Files:**
- Create: `supabase/migrations/0001_schema.sql`

This is the exact schema from `HANDOFF.md` §7, verbatim — no changes, no RLS yet (that's Task 2).

- [ ] **Step 1: Write the migration**

```sql
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
```

- [ ] **Step 2: Verify the file is syntactically self-contained**

Read the file back and confirm: 6 `create table` statements, every foreign key references a table defined earlier in the same file (order matters — `bands` before `band_members`, `rehearsals` before `clips`, `clips` before `comments`), every `check` constraint matches `HANDOFF.md` §7 exactly.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0001_schema.sql
git commit -m "feat(db): add Phase 1 schema migration"
```

---

## Task 2: RLS helper functions and policies

**Files:**
- Create: `supabase/migrations/0002_rls.sql`

`HANDOFF.md` §7's rule: "a user can read/write a row only if they are in `band_members` for that row's band." This task implements that as one reusable function plus one policy set per table. `clips` and `comments` are one or two joins away from `band_id`, so their policies subquery up to it rather than duplicating the membership check inline.

- [ ] **Step 1: Write the helper functions**

```sql
create or replace function is_band_member(p_band_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from band_members
    where band_id = p_band_id and user_id = auth.uid()
  );
$$;

create or replace function is_band_owner(p_band_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from band_members
    where band_id = p_band_id and user_id = auth.uid() and role = 'owner'
  );
$$;
```

- [ ] **Step 2: Enable RLS and write policies for `bands` and `band_members`**

```sql
alter table bands enable row level security;
alter table band_members enable row level security;

create policy bands_select on bands
  for select using (is_band_member(id));

create policy bands_insert on bands
  for insert with check (created_by = auth.uid());

create policy bands_update on bands
  for update using (is_band_owner(id));

create policy bands_delete on bands
  for delete using (is_band_owner(id));

create policy band_members_select on band_members
  for select using (is_band_member(band_id));

create policy band_members_insert on band_members
  for insert with check (user_id = auth.uid());

create policy band_members_update on band_members
  for update using (is_band_owner(band_id));

create policy band_members_delete on band_members
  for delete using (user_id = auth.uid() or is_band_owner(band_id));
```

`band_members_insert` allows a user to add only themselves — this is the "join with invite code" flow (the app looks up a band by invite code, then the joining user inserts their own `band_members` row). `band_members_delete` allows leaving your own membership OR an owner removing someone else.

- [ ] **Step 3: Write policies for `songs` and `rehearsals`**

```sql
alter table songs enable row level security;
alter table rehearsals enable row level security;

create policy songs_select on songs
  for select using (is_band_member(band_id));

create policy songs_insert on songs
  for insert with check (is_band_member(band_id));

create policy songs_update on songs
  for update using (is_band_member(band_id));

create policy songs_delete on songs
  for delete using (is_band_member(band_id));

create policy rehearsals_select on rehearsals
  for select using (is_band_member(band_id));

create policy rehearsals_insert on rehearsals
  for insert with check (is_band_member(band_id));

create policy rehearsals_update on rehearsals
  for update using (is_band_member(band_id));

create policy rehearsals_delete on rehearsals
  for delete using (is_band_member(band_id));
```

- [ ] **Step 4: Write policies for `clips` and `comments`**

These tables don't have a `band_id` column directly — `clips` reaches it through `rehearsals`, `comments` through `clips` then `rehearsals`.

```sql
alter table clips enable row level security;
alter table comments enable row level security;

create policy clips_select on clips
  for select using (
    is_band_member((select band_id from rehearsals where id = clips.rehearsal_id))
  );

create policy clips_insert on clips
  for insert with check (
    is_band_member((select band_id from rehearsals where id = clips.rehearsal_id))
  );

create policy clips_update on clips
  for update using (
    is_band_member((select band_id from rehearsals where id = clips.rehearsal_id))
  );

create policy clips_delete on clips
  for delete using (
    is_band_member((select band_id from rehearsals where id = clips.rehearsal_id))
  );

create policy comments_select on comments
  for select using (
    is_band_member((
      select r.band_id from rehearsals r
      join clips c on c.rehearsal_id = r.id
      where c.id = comments.clip_id
    ))
  );

create policy comments_insert on comments
  for insert with check (
    user_id = auth.uid()
    and is_band_member((
      select r.band_id from rehearsals r
      join clips c on c.rehearsal_id = r.id
      where c.id = comments.clip_id
    ))
  );

create policy comments_update on comments
  for update using (user_id = auth.uid());

create policy comments_delete on comments
  for delete using (user_id = auth.uid());
```

Comments can only be edited/deleted by whoever wrote them (not by any band member) — this is a stricter rule than the blanket "band member" access, intentional since comments are personal remarks, not shared editable state like clips.

- [ ] **Step 5: Verify the file**

Read it back. Confirm: every one of the 6 tables has `enable row level security` and at least a `select` policy (a table with RLS enabled and zero policies denies ALL access, including to band members — this is the most common RLS mistake, double check none of the 6 tables were skipped).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0002_rls.sql
git commit -m "feat(db): add RLS policies for band-scoped data access"
```

---

## Task 3: Storage bucket and policies

**Files:**
- Create: `supabase/migrations/0003_storage.sql`

`HANDOFF.md` §7: "Storage paths follow `bands/{band_id}/rehearsals/{rehearsal_id}/original.{ext}` with matching storage policies." This creates the private bucket and mirrors the same `is_band_member` check against the path's `band_id` segment.

- [ ] **Step 1: Write the migration**

```sql
insert into storage.buckets (id, name, public)
values ('rehearsals', 'rehearsals', false)
on conflict (id) do nothing;

create policy rehearsals_storage_select on storage.objects
  for select using (
    bucket_id = 'rehearsals'
    and is_band_member(((storage.foldername(name))[1])::uuid)
  );

create policy rehearsals_storage_insert on storage.objects
  for insert with check (
    bucket_id = 'rehearsals'
    and is_band_member(((storage.foldername(name))[1])::uuid)
  );

create policy rehearsals_storage_update on storage.objects
  for update using (
    bucket_id = 'rehearsals'
    and is_band_member(((storage.foldername(name))[1])::uuid)
  );

create policy rehearsals_storage_delete on storage.objects
  for delete using (
    bucket_id = 'rehearsals'
    and is_band_member(((storage.foldername(name))[1])::uuid)
  );
```

`storage.foldername(name)` splits the object path on `/` and returns the folder components as an array. For a path `bands/{band_id}/rehearsals/{rehearsal_id}/original.m4a`, that's `{"bands", "{band_id}", "rehearsals", "{rehearsal_id}"}` — index `[1]` is `"bands"`, so the actual band ID is at index `[2]`. **This is a deliberate deviation from a naive first guess** — verify against the real path format before treating this as final in Task 5's self-review.

- [ ] **Step 2: Fix the index (self-catch)**

Re-read the path format: `bands/{band_id}/rehearsals/{rehearsal_id}/original.{ext}`. `storage.foldername()` returns folder segments only (not the filename), 1-indexed. Segment `[1]` = `"bands"`, segment `[2]` = `{band_id}`. Correct all four policies above to use `[2]`, not `[1]`:

```sql
insert into storage.buckets (id, name, public)
values ('rehearsals', 'rehearsals', false)
on conflict (id) do nothing;

create policy rehearsals_storage_select on storage.objects
  for select using (
    bucket_id = 'rehearsals'
    and is_band_member(((storage.foldername(name))[2])::uuid)
  );

create policy rehearsals_storage_insert on storage.objects
  for insert with check (
    bucket_id = 'rehearsals'
    and is_band_member(((storage.foldername(name))[2])::uuid)
  );

create policy rehearsals_storage_update on storage.objects
  for update using (
    bucket_id = 'rehearsals'
    and is_band_member(((storage.foldername(name))[2])::uuid)
  );

create policy rehearsals_storage_delete on storage.objects
  for delete using (
    bucket_id = 'rehearsals'
    and is_band_member(((storage.foldername(name))[2])::uuid)
  );
```

This is the actual final version — write this to the file, not the Step 1 draft.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0003_storage.sql
git commit -m "feat(db): add private storage bucket and path-scoped policies"
```

---

## Task 4: pgTAP RLS test suite

**Files:**
- Create: `supabase/tests/database/rls.test.sql`

This is Phase 1's acceptance test from `HANDOFF.md` §13: "RLS tests prove a non-member cannot read another band's rehearsals, clips, or files." Two bands, two users, one user tries to read the other band's data and must get zero rows back.

- [ ] **Step 1: Write the test suite**

```sql
begin;
select plan(10);

-- Two users, simulating auth.users rows (Supabase's local Postgres seeds a real auth.users table;
-- inserting directly here is the standard pattern for pgTAP tests against Supabase auth-scoped RLS)
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@ktd.test'),
  ('22222222-2222-2222-2222-222222222222', 'bob@otherband.test');

-- Alice's band, with Alice as owner
insert into bands (id, name, invite_code, created_by) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'KTD', 'KTD-INVITE', '11111111-1111-1111-1111-111111111111');
insert into band_members (band_id, user_id, display_name, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Alice', 'owner');

-- Bob's separate band, with Bob as owner
insert into bands (id, name, invite_code, created_by) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'Other Band', 'OTHER-INVITE', '22222222-2222-2222-2222-222222222222');
insert into band_members (band_id, user_id, display_name, role) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Bob', 'owner');

-- A rehearsal, clip, and comment that belong to Alice's band only
insert into rehearsals (id, band_id, storage_path, status, created_by) values
  ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'bands/aaaaaaaa-0000-0000-0000-000000000001/rehearsals/cccccccc-0000-0000-0000-000000000001/original.wav',
   'ready', '11111111-1111-1111-1111-111111111111');
insert into clips (id, rehearsal_id, start_sec, end_sec) values
  ('dddddddd-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 0, 30);
insert into comments (id, clip_id, user_id, body) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'good take');

-- Switch to Bob's identity for the rest of the test (RLS applies from here on)
set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);

select is(
  (select count(*)::int from bands where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  0,
  'Bob cannot see Alice''s band'
);

select is(
  (select count(*)::int from band_members where band_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  0,
  'Bob cannot see Alice''s band membership list'
);

select is(
  (select count(*)::int from rehearsals where id = 'cccccccc-0000-0000-0000-000000000001'),
  0,
  'Bob cannot see Alice''s rehearsal'
);

select is(
  (select count(*)::int from clips where id = 'dddddddd-0000-0000-0000-000000000001'),
  0,
  'Bob cannot see Alice''s clip'
);

select is(
  (select count(*)::int from comments where id = 'eeeeeeee-0000-0000-0000-000000000001'),
  0,
  'Bob cannot see Alice''s comment'
);

select throws_ok(
  $$ insert into rehearsals (band_id, storage_path, created_by)
     values ('aaaaaaaa-0000-0000-0000-000000000001', 'x', '22222222-2222-2222-2222-222222222222') $$,
  'new row violates row-level security policy for table "rehearsals"',
  'Bob cannot insert a rehearsal into Alice''s band'
);

-- Switch to Alice's identity to prove she CAN see her own band's data (positive control —
-- a suite that only tests denial could pass even if RLS blocked everyone, including owners)
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);

select is(
  (select count(*)::int from bands where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  1,
  'Alice can see her own band'
);

select is(
  (select count(*)::int from rehearsals where id = 'cccccccc-0000-0000-0000-000000000001'),
  1,
  'Alice can see her own rehearsal'
);

select is(
  (select count(*)::int from clips where id = 'dddddddd-0000-0000-0000-000000000001'),
  1,
  'Alice can see her own clip'
);

select is(
  (select count(*)::int from comments where id = 'eeeeeeee-0000-0000-0000-000000000001'),
  1,
  'Alice can see her own comment'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Verify the file structure**

Read it back. Confirm: `plan(10)` matches the actual count of assertions (5 negative "Bob can't see X" + 1 negative insert + 4 positive "Alice can see her own X" = 10), every UUID used in an assertion matches a UUID inserted in the setup section, the `rollback` at the end means this test never leaves data behind in a real database.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/database/rls.test.sql
git commit -m "test(db): add pgTAP suite proving band data isolation"
```

---

## Task 5: Self-review pass on all three migrations together

**Files:** none created — this is a read-through, not new code.

- [ ] **Step 1: Cross-check every table against `HANDOFF.md` §7**

Read `supabase/migrations/0001_schema.sql`, `0002_rls.sql`, `0003_storage.sql` back to back. Confirm:
- All 6 tables from §7 exist with every column, type, default, and check constraint matching exactly.
- Every table has RLS enabled AND at least one policy per operation the app needs (select at minimum; insert/update/delete where the app needs to write).
- The storage bucket is `public: false` (private, per §11.5's privacy requirement — "All storage private; signed URLs only").
- The `storage.foldername` index used is `[2]` (band_id), not `[1]` (the literal string `"bands"`) — this was the deliberate self-catch in Task 3.

- [ ] **Step 2: Document the deferred verification in `DECISIONS.md`**

Append to `DECISIONS.md`:

```markdown
- **2026-09-29** — Phase 1 schema/RLS/storage migrations written as plain `.sql` files without live testing (Docker Desktop installed but daemon not running, Supabase CLI not yet installed on this machine). The pgTAP suite at `supabase/tests/database/rls.test.sql` is believed correct by manual read-through but UNVERIFIED until run. Task 6 (manual, Victor) is to get Docker Desktop's daemon running, install the Supabase CLI, run `supabase test db`, and confirm all 10 assertions pass before treating Phase 1's RLS acceptance criterion as met.
```

- [ ] **Step 3: Commit**

```bash
git add DECISIONS.md
git commit -m "docs: note Phase 1 migrations are unverified pending local Supabase setup"
```

---

## Task 6: Manual verification (Victor)

Not automatable — mirrors Phase 0's Task 9 (real-recording accuracy check). This is the actual Phase 1 acceptance gate from `HANDOFF.md` §13.

- [ ] **Step 1: Finish Docker Desktop's first-run setup**

Launch Docker Desktop from the Start menu. Accept the license, let it complete WSL2 setup if prompted (may require a restart). Confirm `docker info` no longer shows a "failed to connect" error.

- [ ] **Step 2: Install the Supabase CLI**

```powershell
npm install -g supabase
```

Verify: `supabase --version`

- [ ] **Step 3: Initialize and link the local project**

```bash
cd C:\Users\VictorAlexis Gadiana\Documents\Github\takesplit
supabase init
```

When prompted, confirm the existing `supabase/migrations/` and `supabase/tests/` directories are picked up (don't let `supabase init` overwrite them — if it asks to create a new `supabase/` directory and one already exists with our migrations, tell it to use the existing one).

- [ ] **Step 4: Run the pgTAP suite**

```bash
supabase start
supabase test db
```

Expected: `10 passed` (or however pgTAP's `finish()` reports it — all 10 assertions from Task 4 green, zero failures).

- [ ] **Step 5: Verify Supabase storage limits (§11.1)**

Once you have a real cloud Supabase project (not just local dev), check the current file-size limit on your plan against a 2-3 hour rehearsal's expected size (115-175 MB at 128kbps). Record the finding in `DECISIONS.md` — if blocked, `HANDOFF.md` §11.1 lists the fallback options (TUS resumable uploads, lower-bitrate compression, or Cloudflare R2).

- [ ] **Step 6: Update `DECISIONS.md` with the real result**

```markdown
- **<date>** — Phase 1 RLS suite run via `supabase test db`: <N>/10 passed. <Note any failures and fixes, or confirm all green>. Storage limit on <plan tier>: <limit>, <sufficient/needs mitigation>.
```

- [ ] **Step 7: Commit**

```bash
git add DECISIONS.md
git commit -m "docs: record Phase 1 RLS verification and storage limit check"
```

---

## Self-Review Notes

- **Spec coverage:** `HANDOFF.md` §7's full schema (Task 1), the `is_band_member(band_id)` helper explicitly named in §7 (Task 2), storage paths matching `bands/{band_id}/rehearsals/{rehearsal_id}/original.{ext}` with matching policies (Task 3), and §13's Phase 1 acceptance criterion — RLS tests proving a non-member can't read another band's rehearsals/clips/files — covered by Task 4's pgTAP suite and gated on Task 6's actual run. §11.1's storage limit verification also folded into Task 6 since it needs a real cloud project, which this plan doesn't provision (out of scope — Victor doesn't have one yet per the conversation this plan came from).
- **Placeholder scan:** none — every migration file has complete SQL, every test has real UUIDs and assertions.
- **Type consistency:** `is_band_member(p_band_id uuid)` and `is_band_owner(p_band_id uuid)` signatures match across every call site in Tasks 2 and 3. The `storage.foldername` index bug was caught and fixed within the plan itself (Task 3, Step 1 → Step 2) rather than left for a reviewer to catch — Task 3's Step 2 is the authoritative version.
