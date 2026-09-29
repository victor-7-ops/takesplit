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
