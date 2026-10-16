# Phase 5 Band Collaboration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close two previously-logged gaps (band creation's partial-failure risk, the invite-code enforcement bypass) in one atomic move, make the invite code actually visible to share, and add timestamped comments on clips.

**Architecture:** A single new migration adds `create_band`, a `SECURITY DEFINER` RPC mirroring Phase 4a's `join_band` — both legitimate ways to populate `bands`/`band_members` now run with the function owner's privileges, so revoking the raw `INSERT` grant from `authenticated`/`anon` closes the self-join-by-guessing-UUID gap without breaking either flow. The invite code becomes visible on the rehearsals list. Comments extend the existing tag sheet screen with a small inline player (same `useAudioPlayer` pattern used three times already in this app).

**Tech Stack:** No new dependencies.

---

## File Structure

```
supabase/
└── migrations/
    └── 0007_create_band_rpc_and_lockdown.sql   # create_band RPC + revoke raw insert grants

apps/mobile/
└── app/
    ├── band-setup.tsx     # modified: handleCreate calls create_band RPC
    ├── index.tsx           # modified: shows the band's invite code
    └── clip/
        └── [id].tsx          # modified: adds comments list + post + inline player
```

**On the security fix's scope:** The gap logged 2026-09-29 was specifically about `band_members_insert` (joining), but Task 1's self-review must also check `bands_insert` — band *creation* had the identical raw-insert exposure (any authenticated user could `INSERT` into `bands` directly with any `created_by`... no, actually `bands_insert`'s `WITH CHECK (created_by = auth.uid())` already prevented impersonation there, but nothing stopped a user from creating unlimited junk bands by calling the raw insert outside the app's UI — not a security hole exactly, but inconsistent with "all band creation goes through one atomic path" once `create_band` exists). Revoking `INSERT` on `bands` closes that too, for free, in the same statement.

**Acceptance scope for Phase 5 alone:** Full `HANDOFF.md` Phase 5 needs all 4 real KTD members on physical phones — same device-testing deferral as every previous phase. This plan's own bar (Task 4): typecheck passes; a raw `INSERT` into `bands`/`band_members` as the `authenticated` role is directly tested and confirmed rejected (not just "the RPCs still work," which wouldn't prove the gap is closed); comments post, list in order, and the at_sec capture/seek roundtrip are proven against the real local stack.

---

## Task 1: `create_band` RPC and RLS lockdown

**Files:**
- Create: `supabase/migrations/0007_create_band_rpc_and_lockdown.sql`

- [ ] **Step 1: Write the migration**

```sql
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
```

- [ ] **Step 2: Apply it to the running local stack**

```bash
cat supabase/migrations/0007_create_band_rpc_and_lockdown.sql | docker exec -i supabase_db_takesplit psql -U postgres -d postgres
```

Expected: `CREATE FUNCTION`, `GRANT`, `REVOKE`, `REVOKE` — no errors.

- [ ] **Step 3: Immediately verify the lockdown, before anything else**

```bash
docker exec -i supabase_db_takesplit psql -U postgres -d postgres <<'EOF'
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd54c31e9-fdc2-4fcf-a1e4-84091d62acf6', true);
insert into bands (name, invite_code, created_by) values ('raw-insert-test', 'RAWTEST1', 'd54c31e9-fdc2-4fcf-a1e4-84091d62acf6');
rollback;
EOF
```

Expected: `ERROR: permission denied for table bands` (not the old RLS-violation message — this is now a GRANT-level denial, confirming the raw path is closed, not just RLS-gated). If this succeeds instead of erroring, STOP — the revoke didn't take effect, don't proceed to Task 2 until this is confirmed failing correctly.

- [ ] **Step 4: Verify the legitimate RPC path still works**

```bash
docker exec -i supabase_db_takesplit psql -U postgres -d postgres <<'EOF'
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd54c31e9-fdc2-4fcf-a1e4-84091d62acf6', true);
select create_band('RPC Test Band', 'Tester');
rollback;
EOF
```

Expected: returns a UUID, no error.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0007_create_band_rpc_and_lockdown.sql
git commit -m "feat(db): add create_band RPC, close raw-insert bypass on bands/band_members"
```

---

## Task 2: Use `create_band` from the app

**Files:**
- Modify: `apps/mobile/app/band-setup.tsx`

- [ ] **Step 1: Read the current file** to confirm `handleCreate`'s exact current shape (two sequential `.insert()` calls, using `generateInviteCode` from `lib/invite-code.ts`).

- [ ] **Step 2: Replace `handleCreate`**

```typescript
async function handleCreate() {
  setError(null);
  const { data: newBandId, error: createError } = await supabase.rpc("create_band", {
    p_name: bandName,
    p_display_name: displayName,
  });
  if (createError || !newBandId) {
    setError(createError?.message ?? "Could not create band.");
    return;
  }

  router.replace("/");
}
```

- [ ] **Step 3: Remove the now-unused `generateInviteCode` import**

The `import { generateInviteCode } from "../lib/invite-code";` line (and any other reference to `generateInviteCode` in this file) should be deleted — `create_band` generates the invite code server-side now. Leave `lib/invite-code.ts` itself untouched; it's dead code now but deleting the file isn't this task's job (it's a one-line pure function, no harm leaving it — if you want to flag it for cleanup, note it in your report rather than deleting it unprompted).

- [ ] **Step 4: Verify it compiles**

```bash
cd apps/mobile
npx tsc --noEmit
```

Expected: `TypeScript: No errors found`.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app/band-setup.tsx
git commit -m "feat(mobile): use create_band RPC for atomic band creation"
```

---

## Task 3: Show the invite code

**Files:**
- Modify: `apps/mobile/app/index.tsx`

- [ ] **Step 1: Read the current file** to confirm its exact header structure (the `Rehearsals` heading + `Upload` link row, from Phase 3b).

- [ ] **Step 2: Add invite code state and fetch**

Add this state declaration alongside the existing ones:

```typescript
const [inviteCode, setInviteCode] = useState<string | null>(null);
```

Add this effect alongside the existing `fetchRehearsals`/Realtime effect:

```typescript
useEffect(() => {
  if (!bandId) {
    return;
  }
  supabase
    .from("bands")
    .select("invite_code")
    .eq("id", bandId)
    .single()
    .then(({ data }) => {
      setInviteCode(data?.invite_code ?? null);
    });
}, [bandId]);
```

- [ ] **Step 3: Render it in the header**

In the `styles.header` `View`, add a line showing the code. The exact placement depends on the current JSX — add it as a new `Text` below the existing `heading`/`Link` row, inside the outer `container`:

```typescript
{inviteCode ? <Text style={styles.inviteCode}>Invite code: {inviteCode}</Text> : null}
```

Add the matching style:

```typescript
inviteCode: { color: "#666", fontSize: 12 },
```

- [ ] **Step 4: Verify it compiles**

```bash
cd apps/mobile
npx tsc --noEmit
```

Expected: `TypeScript: No errors found`.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app/index.tsx
git commit -m "feat(mobile): show band invite code on rehearsals list"
```

---

## Task 4: Comments on clips

**Files:**
- Modify: `apps/mobile/app/clip/[id].tsx`

Per `HANDOFF.md` §10 screen 9: comments on a clip, optional "at current playhead" timestamp, tap to seek.

- [ ] **Step 1: Read the current file** to confirm its exact structure (Phase 4a's tag sheet: song picker, rating, quick tags, notes, Save — wrapped in a `ScrollView` per the Phase 4a bugfix).

- [ ] **Step 2: Add the new imports**

Add to the existing `react-native` import line: `Pressable` is likely already imported (used for song/rating/tag chips) — don't duplicate it if so.

Add a new import line:

```typescript
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
```

- [ ] **Step 3: Add comment-related types and state**

```typescript
type Comment = {
  id: string;
  body: string;
  at_sec: number | null;
  created_at: string;
};
```

Add alongside the existing state declarations in the component:

```typescript
const [audioUrl, setAudioUrl] = useState<string | null>(null);
const [comments, setComments] = useState<Comment[]>([]);
const [newCommentBody, setNewCommentBody] = useState("");
const [captureAtPlayhead, setCaptureAtPlayhead] = useState(false);
const [commentError, setCommentError] = useState<string | null>(null);

const player = useAudioPlayer(audioUrl ?? undefined);
const status = useAudioPlayerStatus(player);
```

- [ ] **Step 4: Fetch audio URL and comments in the existing data-loading effect**

Find the existing `useEffect` that loads the clip and its rehearsal's `band_id` (to load songs). Extend the rehearsal query to also select `storage_path`, and add the signed-URL + comments fetch:

```typescript
const { data: rehearsal } = await supabase
  .from("rehearsals")
  .select("band_id, storage_path")
  .eq("id", clip.rehearsal_id)
  .single();

if (rehearsal) {
  setBandId(rehearsal.band_id);
  const { data: songRows } = await supabase
    .from("songs")
    .select("id, title")
    .eq("band_id", rehearsal.band_id)
    .order("title", { ascending: true });
  setSongs(songRows ?? []);

  const { data: signed } = await supabase.storage
    .from("rehearsals")
    .createSignedUrl(rehearsal.storage_path, 3600);
  setAudioUrl(signed?.signedUrl ?? null);
}

const { data: commentRows } = await supabase
  .from("comments")
  .select("id, body, at_sec, created_at")
  .eq("clip_id", id)
  .order("created_at", { ascending: true });
setComments(commentRows ?? []);
```

This replaces the existing `rehearsal` query (which only selected `band_id`) and adds two new fetches after it, inside the same `useEffect`'s async function, before the existing `setLoading(false)` call.

- [ ] **Step 5: Add comment posting and seek handlers**

```typescript
async function loadComments() {
  const { data } = await supabase
    .from("comments")
    .select("id, body, at_sec, created_at")
    .eq("clip_id", id)
    .order("created_at", { ascending: true });
  setComments(data ?? []);
}

async function handlePostComment() {
  if (!newCommentBody.trim() || !id) {
    return;
  }
  setCommentError(null);
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) {
    setCommentError("Not signed in.");
    return;
  }

  const { error: insertError } = await supabase.from("comments").insert({
    clip_id: id,
    user_id: userId,
    body: newCommentBody.trim(),
    at_sec: captureAtPlayhead ? status.currentTime : null,
  });
  if (insertError) {
    setCommentError(insertError.message);
    return;
  }

  setNewCommentBody("");
  setCaptureAtPlayhead(false);
  await loadComments();
}

async function handleSeekToComment(atSec: number) {
  if (!audioUrl) {
    return;
  }
  await player.seekTo(atSec);
  player.play();
}
```

- [ ] **Step 6: Render the comments section**

Add this JSX block right before the existing `{saving ? <ActivityIndicator /> : <Button title="Save" onPress={handleSave} />}` line (so Save stays the last action, comments sit above it):

```typescript
<Text style={styles.heading}>Comments</Text>
<Button
  title={status.playing ? "Pause" : "Play"}
  onPress={() => (status.playing ? player.pause() : player.play())}
  disabled={!audioUrl}
/>
<Text style={styles.meta}>Playhead: {status.currentTime.toFixed(2)}s</Text>

{comments.map((comment) => (
  <Pressable
    key={comment.id}
    style={styles.commentRow}
    onPress={() => (comment.at_sec !== null ? handleSeekToComment(comment.at_sec) : undefined)}
  >
    <Text>{comment.body}</Text>
    {comment.at_sec !== null ? (
      <Text style={styles.meta}>at {comment.at_sec.toFixed(2)}s</Text>
    ) : null}
  </Pressable>
))}

<TextInput
  style={styles.notes}
  placeholder="Add a comment"
  value={newCommentBody}
  onChangeText={setNewCommentBody}
/>
<Pressable style={styles.row} onPress={() => setCaptureAtPlayhead((current) => !current)}>
  <View style={[styles.chip, captureAtPlayhead && styles.chipSelected]}>
    <Text>{captureAtPlayhead ? "Will tag current time" : "Tag current time"}</Text>
  </View>
</Pressable>
<Button title="Post comment" onPress={handlePostComment} />
{commentError ? <Text style={styles.error}>{commentError}</Text> : null}
```

- [ ] **Step 7: Add the `commentRow` style**

Add to the existing `styles` object:

```typescript
commentRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#eee", gap: 2 },
```

- [ ] **Step 8: Verify it compiles**

```bash
cd apps/mobile
npx tsc --noEmit
```

Expected: `TypeScript: No errors found`.

- [ ] **Step 9: Commit**

```bash
git add apps/mobile/app/clip/\[id\].tsx
git commit -m "feat(mobile): add comments on clips with playhead tagging and tap-to-seek"
```

---

## Task 5: Manual end-to-end verification

**Files:** none — verification only.

- [ ] **Step 1: Confirm Docker/Supabase is up, write `.env`, start the web dev server**

```bash
docker ps --format '{{.Names}}'
```

Launch Docker Desktop and `supabase start` if needed. Then, from `apps/mobile`:

```bash
cat > .env <<'EOF'
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
EXPO_PUBLIC_SUPABASE_ANON_KEY=<paste ANON_KEY from `supabase status -o env`>
EXPO_PUBLIC_WORKER_URL=http://127.0.0.1:8000
EXPO_PUBLIC_WORKER_KEY=test-worker-key
EOF
npx expo start --web
```

- [ ] **Step 2: Create a band through the real UI, confirm the invite code shows**

Sign in, create a band via `band-setup.tsx`. Confirm you land on the rehearsals list and the invite code is visible in the header. Cross-check it against the database:

```bash
docker exec -i supabase_db_takesplit psql -U postgres -d postgres -c "select invite_code from bands order by created_at desc limit 1;"
```

- [ ] **Step 3: Confirm the lockdown holds for a second account too**

Sign in as a different user (new email via Mailpit, same pattern as every previous phase). Attempt the same raw-insert probe from Task 1 Step 3, but this time via the REST API with that user's real session token (not a manually-set GUC), to prove the lockdown holds through the actual PostgREST request path, not just a simulated psql session:

```bash
# Replace <access_token> with the real token from that user's session (readable from
# localStorage in the browser devtools, same technique used in every previous phase's testing)
curl -s -X POST "http://127.0.0.1:54321/rest/v1/bands" \
  -H "apikey: <anon key>" \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"probe","invite_code":"PROBE001","created_by":"<that-users-id>"}'
```

Expected: a 403 or 401 response body mentioning permission, not a 201.

- [ ] **Step 4: Post a comment, with and without playhead tagging**

Open a clip's tag sheet. Tap Play briefly, note the playhead. Toggle "Tag current time," type a comment, post it. Confirm it appears in the list with the right `at_sec`. Post a second comment without toggling the tag — confirm it appears with no timestamp shown.

- [ ] **Step 5: Verify via direct query**

```bash
docker exec -i supabase_db_takesplit psql -U postgres -d postgres -c "select id, body, at_sec, created_at from comments where clip_id='<clip-id>' order by created_at;"
```

Confirm both rows, correct `at_sec` values (one populated, one null), correct `user_id` (your signed-in user).

- [ ] **Step 6: Verify tap-to-seek**

Tap the comment that has a timestamp. Confirm playback starts from near that `at_sec` (some seek latency is expected and fine — confirm it's in the right neighborhood, not starting from 0:00).

- [ ] **Step 7: Record the result in `DECISIONS.md`**

Read the current file first, then append:

```markdown
- **<date>** — Phase 5 (band collaboration) manually verified: `create_band` RPC confirmed atomic and the raw-insert bypass on `bands`/`band_members` confirmed closed, both via a direct psql probe (Task 1) and a real REST API probe with a genuine user session (Task 5) -- both correctly rejected. Invite code now visible on the rehearsals list, cross-checked against the database. Comments post correctly with and without playhead tagging, list in order, and tap-to-seek correctly starts playback near the tagged timestamp. <Note any issues found and fixed, or confirm none.> Full HANDOFF.md Phase 5 acceptance (all 4 real KTD members on physical phones) remains untested, consistent with every previous phase's device-testing deferral.
```

- [ ] **Step 8: Commit**

```bash
git add DECISIONS.md
git commit -m "docs: record Phase 5 end-to-end verification"
```

---

## Self-Review Notes

- **Spec coverage:** `HANDOFF.md` §10 screen 9 (comments: body, optional playhead timestamp, tap to seek) → Task 4, verified in Task 5. The 2026-09-29 `band_members_insert` gap and the 2026-10-08 orphan-band gap (both from `DECISIONS.md`) → Task 1, with the lockdown independently verified at both the raw-SQL level (Task 1 Step 3) and the real REST-API level (Task 5 Step 3) rather than trusting one check. Invite code visibility (no HANDOFF section number names this directly, but it's a precondition for the join flow in §10 screen 2 to be usable at all — a band with no visible invite code can never be joined) → Task 3.
- **Placeholder scan:** none — every task has complete code.
- **Type consistency:** `create_band(p_name text, p_display_name text) returns uuid` (Task 1) matches its call site `supabase.rpc("create_band", { p_name: bandName, p_display_name: displayName })` (Task 2) — parameter names match exactly, which matters for Postgres's named-parameter RPC calling convention. `Comment` type (Task 4: `id, body, at_sec, created_at`) matches the `comments` table columns selected in both the load effect and `loadComments()`. `handleSeekToComment(atSec: number)` matches its one call site's guard (`comment.at_sec !== null ? handleSeekToComment(comment.at_sec) : undefined`).
