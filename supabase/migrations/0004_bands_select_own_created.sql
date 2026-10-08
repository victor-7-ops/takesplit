-- The "create band" flow does INSERT ... RETURNING (via supabase-js .select() after
-- .insert()), which Postgres re-checks against the SELECT policy on the new row before
-- returning it. A band's creator isn't a band_members row yet at that instant (that
-- insert happens in the next app step), so is_band_member(id) alone was always false
-- for a creator reading back their own just-created band, making band creation
-- impossible via any client path that reads the row back. Allow a creator to always
-- see their own band, independent of membership.
drop policy if exists bands_select on bands;

create policy bands_select on bands
  for select using (is_band_member(id) or created_by = auth.uid());
