-- Closes two gaps logged in DECISIONS.md:
-- (2026-09-29) band_members_insert's only gate was user_id = auth.uid(), letting any
--   authenticated user self-join any band by guessing its UUID.
-- (2026-10-08) band-setup.tsx's "create band" flow did two sequential inserts with no
--   transaction; a failure between them left an orphan bands row with no members.
-- create_band mirrors the existing join_band RPC (Phase 4a): a SECURITY DEFINER function
-- runs with the function owner's privileges regardless of the caller's own table grants,
-- and a Postgres function body is transactional, so both inserts either both succeed or
-- both roll back. Revoking the raw INSERT grant below means create_band and join_band
-- become the ONLY ways to populate these tables -- not just the recommended way.
create or replace function create_band(p_name text, p_display_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_band_id uuid;
  v_invite_code text;
begin
  v_invite_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  insert into bands (name, invite_code, created_by)
  values (p_name, v_invite_code, auth.uid())
  returning id into v_band_id;

  insert into band_members (band_id, user_id, display_name, role)
  values (v_band_id, auth.uid(), p_display_name, 'owner');

  return v_band_id;
end;
$$;

grant execute on function create_band(text, text) to authenticated;

revoke insert on bands from authenticated, anon;
revoke insert on band_members from authenticated, anon;
