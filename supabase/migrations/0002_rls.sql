-- RLS helper functions and policies.
-- Rule (HANDOFF.md §7): a user can read/write a row only if they are in
-- band_members for that row's band. clips and comments are one/two joins
-- away from band_id, so their policies subquery up to it.

-- Step 1: helper functions --------------------------------------------------

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

-- Step 2: bands, band_members ------------------------------------------------

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

-- Step 3: songs, rehearsals --------------------------------------------------

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

-- Step 4: clips, comments (reached via joins, no direct band_id) ------------

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
