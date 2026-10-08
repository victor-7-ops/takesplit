-- bands_select only allows a user to see bands they're already a member of (or created).
-- That makes the "join with invite code" flow impossible for a client to do with raw
-- table queries: you can't SELECT the band to discover its id until you're already a
-- member, and you can't become a member without knowing its id. This RPC does the
-- lookup with the function owner's privileges (bypassing RLS for this one read), then
-- inserts the membership row, atomically. This also closes the gap logged in
-- DECISIONS.md (2026-09-29): band_members_insert alone let any authenticated user
-- self-join any band by guessing its UUID directly; the client now has no reason to
-- call that raw insert path for joining, since it needs the invite code to resolve a
-- band id at all.
create or replace function join_band(p_invite_code text, p_display_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_band_id uuid;
begin
  select id into v_band_id from bands where invite_code = p_invite_code;

  if v_band_id is null then
    raise exception 'invite code not found';
  end if;

  insert into band_members (band_id, user_id, display_name, role)
  values (v_band_id, auth.uid(), p_display_name, 'member');

  return v_band_id;
end;
$$;

grant execute on function join_band(text, text) to authenticated;
