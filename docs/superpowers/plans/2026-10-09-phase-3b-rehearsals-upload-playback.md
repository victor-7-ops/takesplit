# Phase 3b Rehearsals, Upload, and Playback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder home screen with a real, Realtime-updating rehearsal list; let a user upload a recording and kick off worker processing; and let them browse a rehearsal's clips and actually play one back, seeking into the original file.

**Architecture:** `app/index.tsx` becomes the rehearsal list (still does the auth/band gating from Phase 3a, just renders a list instead of a placeholder once gated through). `app/upload.tsx` is upload-and-trigger-processing. `app/rehearsal/[id].tsx` is the detail/playback screen. Two small pure/thin helper modules (`lib/format.ts`, `lib/worker.ts`) keep screen components focused on rendering and event handling, not formatting or fetch plumbing.

**Tech Stack:** `expo-document-picker` and `expo-audio` (official Expo SDK packages, cover this exact need — no third-party picker/player libraries). Supabase Realtime via `postgres_changes` channel subscriptions.

---

## File Structure

```
apps/mobile/
├── .env.example                 # modified: add EXPO_PUBLIC_WORKER_URL, EXPO_PUBLIC_WORKER_KEY
├── lib/
│   ├── format.ts                 # pure: formatDuration(seconds) -> "m:ss"
│   └── worker.ts                  # thin: POST to worker /process endpoint
└── app/
    ├── index.tsx                  # modified: rehearsal list (was placeholder home)
    ├── upload.tsx                  # new: pick file, upload, insert row, trigger processing
    └── rehearsal/
        └── [id].tsx                 # new: clip list + playback

supabase/
└── migrations/
    └── 0006_realtime_rehearsals.sql   # new: add rehearsals to the realtime publication
```

**Testing note, consistent with Phase 3a's call:** `lib/format.ts`'s `formatDuration` is small enough (one branch, one pad operation) that adding a test framework (jest/jest-expo) to `apps/mobile` just to cover it would be the exact kind of unneeded-dependency-for-one-function this session's ponytail mode and CLAUDE.md's lazy framing warn against. No dedicated test file — deliberate, not silently skipped.

**Acceptance scope for 3b alone:** `HANDOFF.md`'s full Phase 3 bar needs an actual iPhone. This phase's own bar: verified via `npx expo start --web` against the local Supabase stack AND the Phase 2 worker running locally (`uvicorn app.main:app`), using a real small audio file — rehearsal appears in the list right after upload, status flips `uploaded`→`processing`→`ready` live via the Realtime subscription (no page reload), clips appear with correct time ranges, and clicking a clip plays audio starting at the right offset in the browser. True on-device speaker verification is deferred to Victor, same pattern as every previous phase's physical-world check.

---

## Task 1: Realtime publication migration

**Files:**
- Create: `supabase/migrations/0006_realtime_rehearsals.sql`

Supabase Realtime only streams changes for tables explicitly added to the `supabase_realtime` publication. None of Phase 1's migrations did this — the rehearsal list's live status updates need it.

- [ ] **Step 1: Write the migration**

```sql
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'rehearsals'
  ) then
    alter publication supabase_realtime add table rehearsals;
  end if;
end $$;
```

The existence check makes this safe to re-run (a plain `alter publication ... add table` errors if the table is already a member).

- [ ] **Step 2: Apply it to the running local stack and verify**

```bash
cat supabase/migrations/0006_realtime_rehearsals.sql | docker exec -i supabase_db_takesplit psql -U postgres -d postgres
docker exec -i supabase_db_takesplit psql -U postgres -d postgres -c "select tablename from pg_publication_tables where pubname = 'supabase_realtime';"
```

Expected: the second command's output includes a row for `rehearsals`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0006_realtime_rehearsals.sql
git commit -m "feat(db): add rehearsals to the realtime publication"
```

---

## Task 2: Worker trigger and formatting helpers

**Files:**
- Create: `apps/mobile/lib/worker.ts`
- Create: `apps/mobile/lib/format.ts`
- Modify: `apps/mobile/.env.example`

- [ ] **Step 1: Write `lib/worker.ts`**

```typescript
export async function triggerProcess(rehearsalId: string): Promise<void> {
  const workerUrl = process.env.EXPO_PUBLIC_WORKER_URL;
  const workerKey = process.env.EXPO_PUBLIC_WORKER_KEY;
  if (!workerUrl || !workerKey) {
    throw new Error("Missing EXPO_PUBLIC_WORKER_URL or EXPO_PUBLIC_WORKER_KEY");
  }

  const response = await fetch(`${workerUrl}/process`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Worker-Key": workerKey },
    body: JSON.stringify({ rehearsal_id: rehearsalId }),
  });

  if (!response.ok) {
    throw new Error(`Worker /process failed with status ${response.status}`);
  }
}
```

- [ ] **Step 2: Write `lib/format.ts`**

```typescript
export function formatDuration(totalSeconds: number | null): string {
  if (totalSeconds === null) {
    return "--:--";
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
```

- [ ] **Step 3: Add the new env vars to `.env.example`**

Append to `apps/mobile/.env.example`:

```
EXPO_PUBLIC_WORKER_URL=http://127.0.0.1:8000
EXPO_PUBLIC_WORKER_KEY=change-me
```

- [ ] **Step 4: Verify it compiles**

```bash
cd apps/mobile
npx tsc --noEmit
```

Expected: `TypeScript: No errors found`.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/lib/worker.ts apps/mobile/lib/format.ts apps/mobile/.env.example
git commit -m "feat(mobile): add worker trigger and duration formatting helpers"
```

---

## Task 3: Install expo-document-picker and expo-audio

**Files:**
- Modify: `apps/mobile/package.json` (via `expo install`, not hand-edited)

- [ ] **Step 1: Install**

```bash
cd apps/mobile
npx expo install expo-document-picker expo-audio
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: `TypeScript: No errors found`.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/package.json apps/mobile/package-lock.json
git commit -m "chore(mobile): add expo-document-picker and expo-audio"
```

---

## Task 4: Rehearsal list (replace placeholder home)

**Files:**
- Modify: `apps/mobile/app/index.tsx`

Currently (from Phase 3a) this file gates on auth/band membership and shows a static placeholder once gated through. This task keeps the gating exactly as-is and replaces only the placeholder branch with a real, Realtime-subscribed list.

- [ ] **Step 1: Replace the full contents of `apps/mobile/app/index.tsx`**

```typescript
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Link, Redirect, router } from "expo-router";
import { useSession } from "../lib/session-context";
import { supabase } from "../lib/supabase";
import { formatDuration } from "../lib/format";

type Rehearsal = {
  id: string;
  title: string | null;
  recorded_on: string;
  duration_sec: number | null;
  status: string;
};

export default function Index() {
  const { session, bandId, loading } = useSession();
  const [rehearsals, setRehearsals] = useState<Rehearsal[]>([]);
  const [listLoading, setListLoading] = useState(true);

  const fetchRehearsals = useCallback(async () => {
    if (!bandId) {
      return;
    }
    const { data } = await supabase
      .from("rehearsals")
      .select("id, title, recorded_on, duration_sec, status")
      .eq("band_id", bandId)
      .order("created_at", { ascending: false });
    setRehearsals(data ?? []);
    setListLoading(false);
  }, [bandId]);

  useEffect(() => {
    if (!bandId) {
      return;
    }

    fetchRehearsals();

    const channel = supabase
      .channel(`rehearsals-${bandId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rehearsals", filter: `band_id=eq.${bandId}` },
        () => fetchRehearsals()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [bandId, fetchRehearsals]);

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!session) {
    return <Redirect href="/sign-in" />;
  }

  if (!bandId) {
    return <Redirect href="/band-setup" />;
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.heading}>Rehearsals</Text>
        <Link href="/upload" style={styles.link}>
          Upload
        </Link>
      </View>
      {listLoading ? (
        <ActivityIndicator />
      ) : (
        <FlatList
          data={rehearsals}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => router.push(`/rehearsal/${item.id}`)}>
              <Text>{item.title ?? "Untitled"}</Text>
              <Text>{item.recorded_on}</Text>
              <Text>{formatDuration(item.duration_sec)}</Text>
              <Text>{item.status}</Text>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  heading: { fontSize: 20, fontWeight: "600" },
  link: { color: "#2563eb" },
  row: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#eee", gap: 2 },
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
git add apps/mobile/app/index.tsx
git commit -m "feat(mobile): replace placeholder home with realtime rehearsal list"
```

---

## Task 5: Upload screen

**Files:**
- Create: `apps/mobile/app/upload.tsx`

Follows `HANDOFF.md` §7's storage path convention (`bands/{band_id}/rehearsals/{rehearsal_id}/original.{ext}`) and §9's worker trigger (`POST /process`). The rehearsal id is generated client-side (`crypto.randomUUID()`, already proven working in this app since `lib/invite-code.ts`) so the storage path can be built before the DB row exists.

- [ ] **Step 1: Write the screen**

```typescript
import { useState } from "react";
import { ActivityIndicator, Button, StyleSheet, Text, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { router } from "expo-router";
import { supabase } from "../lib/supabase";
import { useSession } from "../lib/session-context";
import { triggerProcess } from "../lib/worker";

export default function Upload() {
  const { session, bandId } = useSession();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePick() {
    setError(null);
    const result = await DocumentPicker.getDocumentAsync({ type: "audio/*" });
    if (result.canceled || !bandId || !session) {
      return;
    }

    const picked = result.assets[0];
    setUploading(true);
    try {
      const rehearsalId = crypto.randomUUID();
      const extension = picked.name.includes(".") ? picked.name.split(".").pop() : "wav";
      const storagePath = `bands/${bandId}/rehearsals/${rehearsalId}/original.${extension}`;

      const webFile = (picked as unknown as { file?: Blob }).file;
      const blob = webFile ?? (await fetch(picked.uri).then((r) => r.blob()));

      const { error: uploadError } = await supabase.storage
        .from("rehearsals")
        .upload(storagePath, blob, { contentType: picked.mimeType ?? "application/octet-stream" });
      if (uploadError) {
        setError(uploadError.message);
        return;
      }

      const { error: insertError } = await supabase.from("rehearsals").insert({
        id: rehearsalId,
        band_id: bandId,
        storage_path: storagePath,
        status: "uploaded",
        created_by: session.user.id,
      });
      if (insertError) {
        setError(insertError.message);
        return;
      }

      await triggerProcess(rehearsalId);
      router.replace("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text>Upload a rehearsal recording</Text>
      {uploading ? <ActivityIndicator /> : <Button title="Choose file" onPress={handlePick} />}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  error: { color: "red" },
});
```

`(picked as unknown as { file?: Blob }).file` reads the web-only `File` object `expo-document-picker` attaches to the picked asset on web (per its docs) without fighting the cross-platform type, which doesn't declare that field for native. Falling back to `fetch(picked.uri).then(r => r.blob())` covers native, where `uri` is a real local file URI.

- [ ] **Step 2: Verify it compiles**

```bash
cd apps/mobile
npx tsc --noEmit
```

Expected: `TypeScript: No errors found`.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/app/upload.tsx
git commit -m "feat(mobile): add rehearsal upload screen"
```

---

## Task 6: Rehearsal detail and clip playback

**Files:**
- Create: `apps/mobile/app/rehearsal/[id].tsx`

Per `HANDOFF.md` §6's virtual-clips design: clips are never physically cut, playback seeks into the original uploaded file. A signed URL (private bucket, per Phase 1) is fetched once per rehearsal and shared by every clip's player.

- [ ] **Step 1: Write the screen**

```typescript
import { useEffect, useState } from "react";
import { ActivityIndicator, Button, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { supabase } from "../../lib/supabase";
import { formatDuration } from "../../lib/format";

type Clip = {
  id: string;
  start_sec: number;
  end_sec: number;
  kind: string;
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
        .select("id, start_sec, end_sec, kind")
        .eq("rehearsal_id", id)
        .order("start_sec", { ascending: true });
      setClips(clipRows ?? []);
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
      <Text>
        {formatDuration(clip.start_sec)} - {formatDuration(clip.end_sec)} ({clip.kind})
      </Text>
      <Button title="Play" onPress={handlePlay} disabled={!audioUrl} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  heading: { fontSize: 20, fontWeight: "600" },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8 },
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
git add apps/mobile/app/rehearsal/
git commit -m "feat(mobile): add rehearsal detail screen with clip playback"
```

---

## Task 7: Manual end-to-end verification

Not automatable — mirrors every previous phase's final real-infrastructure check. Needs: Docker Desktop running, local Supabase stack up, the Phase 2 worker running locally, and a browser.

- [ ] **Step 1: Confirm the local Supabase stack is up**

```bash
docker ps --format '{{.Names}}'
```

If `supabase_*_takesplit` containers aren't listed, launch Docker Desktop and run `supabase start`.

- [ ] **Step 2: Start the Phase 2 worker**

```bash
cd services/worker
export WORKER_KEY=test-worker-key
export SUPABASE_URL=$(supabase status -o env | grep API_URL | cut -d'"' -f2)
export SUPABASE_SERVICE_ROLE_KEY=$(supabase status -o env | grep SERVICE_ROLE_KEY | cut -d'"' -f2)
uvicorn app.main:app --port 8000 &
curl -s http://127.0.0.1:8000/health
```

Expected: `{"status":"ok"}`.

- [ ] **Step 3: Write `.env` for the mobile app**

```bash
cd apps/mobile
cat > .env <<'EOF'
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
EXPO_PUBLIC_SUPABASE_ANON_KEY=<paste ANON_KEY from `supabase status -o env`>
EXPO_PUBLIC_WORKER_URL=http://127.0.0.1:8000
EXPO_PUBLIC_WORKER_KEY=test-worker-key
EOF
```

- [ ] **Step 4: Start the web dev server and sign in**

```bash
npx expo start --web
```

Sign in via a real email, same Mailpit-based flow proven in Phase 3a's verification. Land on the rehearsal list (empty, for a fresh band) or reuse a band/user from Phase 3a's testing.

- [ ] **Step 5: Upload a real small audio file**

Tap "Upload," pick any short `.wav`/`.m4a`/`.mp3` file. Confirm the rehearsal appears in the list immediately with status `uploaded`, without a manual refresh.

- [ ] **Step 6: Watch the status flip live**

Within a few seconds (the worker processes in the background), confirm the list row's status updates to `processing` then `ready` on its own — via the Realtime subscription, not a page reload. If it doesn't update, check the worker's terminal output for errors and confirm `EXPO_PUBLIC_WORKER_URL`/`EXPO_PUBLIC_WORKER_KEY` match what the worker process is using.

- [ ] **Step 7: Open the rehearsal and play a clip**

Tap the now-`ready` rehearsal. Confirm clips appear with sensible time ranges (matching what Phase 0's `detect.py` would produce for that file's length). Tap "Play" on one and confirm audio actually plays in the browser, starting near the clip's `start_sec` (exact timing will have some seek latency — confirm it's in the right neighborhood, not starting from 0:00 or not playing at all).

- [ ] **Step 8: Record the result in `DECISIONS.md`**

Read the current file first, then append:

```markdown
- **<date>** — Phase 3b (rehearsals list, upload, playback) manually verified end-to-end: real file uploaded via the web app, worker processed it locally, rehearsal list status updated live via Realtime (uploaded→processing→ready, no reload), clips appeared with correct time ranges, clip playback confirmed working in-browser via expo-audio's web interop. <Note any issues found and fixed, or confirm none.> True on-device (iOS/Android) playback and the upload-progress-bar requirement from HANDOFF.md §10 screen 4 remain untested/unbuilt — this phase proved the data flow works, not the native UX polish.
```

- [ ] **Step 9: Commit**

```bash
git add DECISIONS.md
git commit -m "docs: record Phase 3b end-to-end verification"
```

---

## Self-Review Notes

- **Spec coverage:** `HANDOFF.md` §10 screen 3 (rehearsals list with status) → Task 4. Screen 4 (upload) → Task 5, though the "progress bar" and "resumable upload" details from HANDOFF's full spec are explicitly out of scope here (noted in Task 7's DECISIONS.md entry) — this phase proves the upload→process→ready pipeline works, not upload UX polish. Screen 6 (waveform + clip list) → Task 6, minus the waveform rendering itself (peaks.json exists from Phase 2 but nothing here draws it — that's reasonably Phase 4's "editing and tagging" territory per HANDOFF §13, since waveform drawing is tightly coupled to the boundary-drag editing this phase doesn't build). §6's Realtime status flow → Task 1 + Task 4. §9's `/process` trigger → Task 2 + Task 5. §7's storage path convention → Task 5.
- **Placeholder scan:** none — every task has complete code. The explicitly out-of-scope items (progress bar, waveform rendering, native deep-link/device testing) are named as such, not silently dropped.
- **Type consistency:** `Rehearsal` type in Task 4 (`id, title, recorded_on, duration_sec, status`) matches the actual `rehearsals` table columns from `supabase/migrations/0001_schema.sql`. `Clip` type in Task 6 (`id, start_sec, end_sec, kind`) matches `clips` table columns and the fields `detect.py`'s segments carry through `jobs.py`'s insert (Phase 2, already proven). `triggerProcess(rehearsalId: string)` signature in Task 2 matches its one call site in Task 5.
