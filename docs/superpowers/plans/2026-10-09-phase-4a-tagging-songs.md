# Phase 4a Tagging and Songs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a band member tag a clip with a song (creating new songs inline), a 1-3 star rating, quick tags, and notes — with correct auto-incrementing take numbers — and browse all takes of one song across every rehearsal.

**Architecture:** `lib/clips.ts` owns the one piece of real logic (assigning a song and computing its take number) so it isn't duplicated between the tag sheet and any future screen that reassigns a clip's song. `lib/tags.ts` is just the fixed quick-tag vocabulary from `HANDOFF.md` §7. Two new screens (`app/clip/[id].tsx`, `app/song/[id].tsx`) plus a small addition to the existing rehearsal detail screen to link into the tag sheet.

**Tech Stack:** Same as the rest of the app — Expo Router, `@supabase/supabase-js`, no new dependencies.

---

## File Structure

```
apps/mobile/
├── lib/
│   ├── clips.ts        # assignSongToClip(clipId, rehearsalId, songId) -> take_number
│   └── tags.ts          # QUICK_TAGS constant
└── app/
    ├── clip/
    │   └── [id].tsx       # tag sheet: song picker + new-song, rating, quick tags, notes
    ├── song/
    │   └── [id].tsx        # all takes of one song, newest rehearsal first
    └── rehearsal/
        └── [id].tsx         # modified: Tag button per clip row, shows song+rating if tagged
```

**On testing "take numbering" (CLAUDE.md §14 names this exact example):** The arithmetic itself — `existingCount + 1` — is a one-line expression with no branches; it doesn't earn a dedicated test file any more than Phase 3a's `generateInviteCode` did. The part of `HANDOFF.md` §7's rule that could actually be wrong is the *query* feeding that arithmetic (did it filter by the right rehearsal, the right song, correctly exclude the clip being reassigned?) — and that's a Supabase round-trip, not pure logic. Per the same pattern every previous phase has used for I/O-touching correctness (Phase 0's detection math was unit-tested because it's pure; Phase 2's `jobs.py` was proven via real integration tests against the live stack because it isn't), `assignSongToClip`'s correctness is proven in this phase's own manual end-to-end verification (Task 5), not a mocked unit test. This is a deliberate call, not a silent skip of CLAUDE.md's example.

---

## Task 1: Clip tagging helper

**Files:**
- Create: `apps/mobile/lib/clips.ts`

- [ ] **Step 1: Write the helper**

```typescript
import { supabase } from "./supabase";

export async function assignSongToClip(
  clipId: string,
  rehearsalId: string,
  songId: string
): Promise<number> {
  const { data: siblings } = await supabase
    .from("clips")
    .select("id")
    .eq("rehearsal_id", rehearsalId)
    .eq("song_id", songId)
    .neq("id", clipId);

  const takeNumber = (siblings?.length ?? 0) + 1;

  await supabase.from("clips").update({ song_id: songId, take_number: takeNumber }).eq("id", clipId);

  return takeNumber;
}
```

This matches `HANDOFF.md` §7 exactly: "take_number = count of existing clips of that song in the same rehearsal + 1 ... Recompute on reassign" — every call recomputes from the current sibling count, so reassigning a clip to a different song (or back) always gets a fresh, correct number.

- [ ] **Step 2: Verify it compiles**

```bash
cd apps/mobile
npx tsc --noEmit
```

Expected: `TypeScript: No errors found`.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/lib/clips.ts
git commit -m "feat(mobile): add clip song-assignment and take-number helper"
```

---

## Task 2: Quick tags constant

**Files:**
- Create: `apps/mobile/lib/tags.ts`

- [ ] **Step 1: Write the constant**

```typescript
export const QUICK_TAGS = [
  "best take",
  "tempo rushed",
  "tempo dragged",
  "bridge fix",
  "new idea",
  "ending issue",
] as const;
```

Exact list from `HANDOFF.md` §7.

- [ ] **Step 2: Verify it compiles**

```bash
cd apps/mobile
npx tsc --noEmit
```

Expected: `TypeScript: No errors found`.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/lib/tags.ts
git commit -m "feat(mobile): add quick tags constant"
```

---

## Task 3: Tag sheet screen

**Files:**
- Create: `apps/mobile/app/clip/[id].tsx`

Per `HANDOFF.md` §10 screen 7: song picker (with "add new song"), rating, quick tags, notes.

- [ ] **Step 1: Write the screen**

```typescript
import { useEffect, useState } from "react";
import { ActivityIndicator, Button, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { supabase } from "../../lib/supabase";
import { assignSongToClip } from "../../lib/clips";
import { QUICK_TAGS } from "../../lib/tags";

type Song = { id: string; title: string };

export default function ClipTagSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [rehearsalId, setRehearsalId] = useState<string | null>(null);
  const [bandId, setBandId] = useState<string | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [songId, setSongId] = useState<string | null>(null);
  const [originalSongId, setOriginalSongId] = useState<string | null>(null);
  const [newSongTitle, setNewSongTitle] = useState("");
  const [rating, setRating] = useState<number | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      return;
    }

    (async () => {
      const { data: clip } = await supabase
        .from("clips")
        .select("rehearsal_id, song_id, rating, tags, notes")
        .eq("id", id)
        .single();

      if (!clip) {
        setLoading(false);
        return;
      }

      setRehearsalId(clip.rehearsal_id);
      setSongId(clip.song_id);
      setOriginalSongId(clip.song_id);
      setRating(clip.rating);
      setTags(clip.tags ?? []);
      setNotes(clip.notes ?? "");

      const { data: rehearsal } = await supabase
        .from("rehearsals")
        .select("band_id")
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
      }

      setLoading(false);
    })();
  }, [id]);

  function toggleTag(tag: string) {
    setTags((current) => (current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag]));
  }

  async function handleAddSong() {
    if (!bandId || !newSongTitle.trim()) {
      return;
    }
    const { data: song, error: songError } = await supabase
      .from("songs")
      .insert({ band_id: bandId, title: newSongTitle.trim() })
      .select()
      .single();
    if (songError || !song) {
      setError(songError?.message ?? "Could not add song.");
      return;
    }
    setSongs((current) => [...current, song].sort((a, b) => a.title.localeCompare(b.title)));
    setSongId(song.id);
    setNewSongTitle("");
  }

  async function handleSave() {
    if (!id || !rehearsalId) {
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const { error: updateError } = await supabase
        .from("clips")
        .update({ rating, tags, notes })
        .eq("id", id);
      if (updateError) {
        setError(updateError.message);
        return;
      }

      if (songId && songId !== originalSongId) {
        await assignSongToClip(id, rehearsalId, songId);
      }

      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Song</Text>
      <View style={styles.chipRow}>
        {songs.map((song) => (
          <Pressable
            key={song.id}
            style={[styles.chip, songId === song.id && styles.chipSelected]}
            onPress={() => setSongId(song.id)}
          >
            <Text>{song.title}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.row}>
        <TextInput
          style={styles.input}
          placeholder="Add new song"
          value={newSongTitle}
          onChangeText={setNewSongTitle}
        />
        <Button title="Add" onPress={handleAddSong} />
      </View>

      <Text style={styles.heading}>Rating</Text>
      <View style={styles.row}>
        {[1, 2, 3].map((value) => (
          <Pressable
            key={value}
            style={[styles.chip, rating === value && styles.chipSelected]}
            onPress={() => setRating(value)}
          >
            <Text>{"*".repeat(value)}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.heading}>Quick tags</Text>
      <View style={styles.chipRow}>
        {QUICK_TAGS.map((tag) => (
          <Pressable
            key={tag}
            style={[styles.chip, tags.includes(tag) && styles.chipSelected]}
            onPress={() => toggleTag(tag)}
          >
            <Text>{tag}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.heading}>Notes</Text>
      <TextInput style={styles.notes} multiline value={notes} onChangeText={setNotes} />

      {saving ? <ActivityIndicator /> : <Button title="Save" onPress={handleSave} />}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 8 },
  heading: { fontSize: 16, fontWeight: "600", marginTop: 12 },
  row: { flexDirection: "row", gap: 8, alignItems: "center" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: "#ccc" },
  chipSelected: { backgroundColor: "#dbeafe", borderColor: "#2563eb" },
  input: { flex: 1, borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 10 },
  notes: { borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 10, minHeight: 80 },
  error: { color: "red" },
});
```

- [ ] **Step 2: Verify it compiles**

```bash
cd apps/mobile
npx tsc --noEmit
```

Expected: `TypeScript: No errors found`.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/app/clip/
git commit -m "feat(mobile): add clip tag sheet screen"
```

---

## Task 4: Song view screen

**Files:**
- Create: `apps/mobile/app/song/[id].tsx`

Per `HANDOFF.md` §10 screen 8: "all takes of one song across rehearsals, newest first, with ratings."

- [ ] **Step 1: Write the screen**

```typescript
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { supabase } from "../../lib/supabase";
import { formatDuration } from "../../lib/format";

type TakeRow = {
  id: string;
  take_number: number | null;
  rating: number | null;
  start_sec: number;
  end_sec: number;
  rehearsal_id: string;
  recorded_on: string;
};

export default function SongView() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [title, setTitle] = useState("");
  const [takes, setTakes] = useState<TakeRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) {
      return;
    }

    (async () => {
      const { data: song } = await supabase.from("songs").select("title").eq("id", id).single();
      setTitle(song?.title ?? "");

      const { data: clipRows } = await supabase
        .from("clips")
        .select("id, take_number, rating, start_sec, end_sec, rehearsal_id, rehearsals(recorded_on)")
        .eq("song_id", id);

      const normalized: TakeRow[] = (clipRows ?? []).map((row) => {
        const rehearsal = Array.isArray(row.rehearsals) ? row.rehearsals[0] : row.rehearsals;
        return {
          id: row.id,
          take_number: row.take_number,
          rating: row.rating,
          start_sec: row.start_sec,
          end_sec: row.end_sec,
          rehearsal_id: row.rehearsal_id,
          recorded_on: rehearsal?.recorded_on ?? "",
        };
      });
      normalized.sort((a, b) => b.recorded_on.localeCompare(a.recorded_on));

      setTakes(normalized);
      setLoading(false);
    })();
  }, [id]);

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>{title}</Text>
      {takes.map((take) => (
        <View key={take.id} style={styles.row}>
          <Text>{take.recorded_on}</Text>
          <Text>Take {take.take_number ?? "-"}</Text>
          <Text>
            {formatDuration(take.start_sec)} - {formatDuration(take.end_sec)}
          </Text>
          <Text>{take.rating ? "*".repeat(take.rating) : "unrated"}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  heading: { fontSize: 20, fontWeight: "600" },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#eee" },
});
```

The nested `rehearsals(recorded_on)` select returns an array in some supabase-js/PostgREST configurations and a single object in others depending on the relationship's inferred cardinality — the `Array.isArray` check handles both without guessing which this project's setup returns.

- [ ] **Step 2: Verify it compiles**

```bash
cd apps/mobile
npx tsc --noEmit
```

Expected: `TypeScript: No errors found`.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/app/song/
git commit -m "feat(mobile): add song view screen across rehearsals"
```

---

## Task 5: Link clips to their tag sheet

**Files:**
- Modify: `apps/mobile/app/rehearsal/[id].tsx`

Adds a "Tag" button per clip row (navigates to `/clip/[id]`) and shows the clip's song title + rating inline when already tagged.

- [ ] **Step 1: Read the current file to confirm the exact `ClipRow` shape before editing**

The Phase 3b version has a `Clip` type (`id, start_sec, end_sec, kind`) and a `ClipRow` component rendering a time range and a Play button. This task extends both.

- [ ] **Step 2: Replace the full contents of `apps/mobile/app/rehearsal/[id].tsx`**

```typescript
import { useEffect, useState } from "react";
import { ActivityIndicator, Button, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { supabase } from "../../lib/supabase";
import { formatDuration } from "../../lib/format";

type Clip = {
  id: string;
  start_sec: number;
  end_sec: number;
  kind: string;
  rating: number | null;
  song_title: string | null;
};

export default function RehearsalDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [clips, setClips] = useState<Clip[]>([]);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) {
      return;
    }

    (async () => {
      const { data: rehearsal } = await supabase
        .from("rehearsals")
        .select("storage_path")
        .eq("id", id)
        .single();

      if (rehearsal) {
        const { data: signed } = await supabase.storage
          .from("rehearsals")
          .createSignedUrl(rehearsal.storage_path, 3600);
        setSignedUrl(signed?.signedUrl ?? null);
      }

      const { data: clipRows } = await supabase
        .from("clips")
        .select("id, start_sec, end_sec, kind, rating, songs(title)")
        .eq("rehearsal_id", id)
        .order("start_sec", { ascending: true });

      const normalized: Clip[] = (clipRows ?? []).map((row) => {
        const song = Array.isArray(row.songs) ? row.songs[0] : row.songs;
        return {
          id: row.id,
          start_sec: row.start_sec,
          end_sec: row.end_sec,
          kind: row.kind,
          rating: row.rating,
          song_title: song?.title ?? null,
        };
      });

      setClips(normalized);
      setLoading(false);
    })();
  }, [id]);

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Clips</Text>
      {clips.map((clip) => (
        <ClipRow key={clip.id} clip={clip} audioUrl={signedUrl} />
      ))}
    </View>
  );
}

function ClipRow({ clip, audioUrl }: { clip: Clip; audioUrl: string | null }) {
  const player = useAudioPlayer(audioUrl ?? undefined);
  const status = useAudioPlayerStatus(player);

  useEffect(() => {
    if (status.playing && status.currentTime >= clip.end_sec) {
      player.pause();
    }
  }, [status.currentTime, status.playing, clip.end_sec, player]);

  async function handlePlay() {
    if (!audioUrl) {
      return;
    }
    await player.seekTo(clip.start_sec);
    player.play();
  }

  return (
    <View style={styles.row}>
      <View style={styles.rowInfo}>
        <Text>
          {formatDuration(clip.start_sec)} - {formatDuration(clip.end_sec)} ({clip.kind})
        </Text>
        <Text style={styles.meta}>
          {clip.song_title ?? "No song"}
          {clip.rating ? ` - ${"*".repeat(clip.rating)}` : ""}
        </Text>
      </View>
      <View style={styles.rowActions}>
        <Button title="Play" onPress={handlePlay} disabled={!audioUrl} />
        <Button title="Tag" onPress={() => router.push(`/clip/${clip.id}`)} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  heading: { fontSize: 20, fontWeight: "600" },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8 },
  rowInfo: { gap: 2 },
  meta: { color: "#666", fontSize: 12 },
  rowActions: { flexDirection: "row", gap: 8 },
});
```

- [ ] **Step 3: Verify it compiles**

```bash
cd apps/mobile
npx tsc --noEmit
```

Expected: `TypeScript: No errors found`.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/app/rehearsal/
git commit -m "feat(mobile): link clips to tag sheet, show song and rating inline"
```

---

## Task 6: Manual end-to-end verification

Not automatable — same pattern as every previous phase's real-infrastructure check.

- [ ] **Step 1: Confirm the local Supabase stack is up**

```bash
docker ps --format '{{.Names}}'
```

Launch Docker Desktop and `supabase start` if the `supabase_*_takesplit` containers aren't listed.

- [ ] **Step 2: Write `.env` and start the web dev server**

```bash
cd apps/mobile
cat > .env <<'EOF'
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
EXPO_PUBLIC_SUPABASE_ANON_KEY=<paste ANON_KEY from `supabase status -o env`>
EXPO_PUBLIC_WORKER_URL=http://127.0.0.1:8000
EXPO_PUBLIC_WORKER_KEY=test-worker-key
EOF
npx expo start --web
```

(The worker doesn't need to be running for this phase — no new `/process` calls — but a `ready` rehearsal with existing clips does, from Phase 3b's testing, or run the worker again briefly to produce one.)

- [ ] **Step 3: Tag a clip**

Sign in, open a `ready` rehearsal with clips, tap "Tag" on one. Add a new song inline, confirm it appears selected. Set a 2-star rating, toggle on "best take" and "bridge fix", add a note, Save. Confirm it returns to the rehearsal detail screen and the clip row now shows the song title and `**`.

- [ ] **Step 4: Verify take numbering**

Tag a second clip in the same rehearsal with the same song. Confirm (via Supabase Studio or a query) its `take_number` is `2`, and the first clip's is `1`.

```bash
docker exec -i supabase_db_takesplit psql -U postgres -d postgres -c "select id, song_id, take_number from clips where song_id is not null order by take_number;"
```

- [ ] **Step 5: Reassign a clip to a different song and confirm recompute**

Open the first tagged clip's tag sheet again, switch it to a different (new) song, Save. Confirm its `take_number` resets to `1` for the new song (per `HANDOFF.md` §7 "Recompute on reassign"), and the original song's remaining clip renumbers correctly if you check it too (it won't automatically renumber — only the count at assignment time matters, confirm this matches the spec's literal wording, not an assumption of automatic renumbering of siblings).

- [ ] **Step 6: Open the song view**

Navigate to `/song/<song-id>` for a song with takes in more than one rehearsal (tag a clip in a second rehearsal with the same song if needed). Confirm takes are listed newest-rehearsal-first with correct take numbers and ratings.

- [ ] **Step 7: Record the result in `DECISIONS.md`**

Read the current file first, then append:

```markdown
- **<date>** — Phase 4a (tagging, songs) manually verified end-to-end: tagged a clip with a new inline-created song, rating, and quick tags; confirmed take_number computed correctly (1, then 2 for a second clip on the same song); confirmed reassigning a clip to a different song recomputes its take_number per HANDOFF.md §7's "recompute on reassign" rule; confirmed the song view screen lists takes across rehearsals, newest first. <Note any issues found and fixed, or confirm none.>
```

- [ ] **Step 8: Commit**

```bash
git add DECISIONS.md
git commit -m "docs: record Phase 4a end-to-end verification"
```

---

## Self-Review Notes

- **Spec coverage:** `HANDOFF.md` §7's take-number rule → Task 1, verified in Task 6. §7's quick tags list → Task 2. §10 screen 7 (tag sheet: song picker + add-new, rating, quick tags, notes) → Task 3. §10 screen 8 (song view across rehearsals, newest first, with ratings) → Task 4. Linking clips to tagging → Task 5.
- **Placeholder scan:** none — every task has complete code.
- **Type consistency:** `assignSongToClip(clipId: string, rehearsalId: string, songId: string): Promise<number>` (Task 1) matches its call site in Task 3's `handleSave`. `Clip` type in Task 5 (`id, start_sec, end_sec, kind, rating, song_title`) is a superset of Phase 3b's version, extended consistently — the `ClipRow` component's props type updated to match in the same task, not left stale. `QUICK_TAGS` (Task 2) used identically in Task 3's `.map()`.
