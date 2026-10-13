# Phase 4b Waveform Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a band member see the waveform of a rehearsal with clip boundaries drawn on top, drag a boundary to adjust it, split a clip at the playhead, merge a clip into the next one, or delete it.

**Architecture:** `lib/peaks.ts` is a pure downsampling function (the only piece of this phase worth a unit test — real aggregation logic, not a one-liner). `lib/clips.ts` gains four more editing operations alongside Phase 4a's `assignSongToClip`. The waveform itself is plain `View`s sized by flexbox, not a charting library — per `HANDOFF.md` §6, clips are virtual (timestamps on the original file), so editing is just writing new `start_sec`/`end_sec` values, never touching audio data. Dragging uses React Native's built-in `PanResponder`, not a gesture library.

**Tech Stack:** No new dependencies. `expo-audio` (already installed) for playhead tracking during Split.

---

## File Structure

```
apps/mobile/
├── lib/
│   ├── peaks.ts         # pure: downsamplePeaks(peaks, barCount)
│   ├── peaks.test.ts      # node:test unit tests for the above
│   └── clips.ts            # modified: +splitClipAtTime, mergeClipWithNext, deleteClip, updateClipBounds
└── app/
    └── rehearsal/
        ├── [id].tsx          # modified: link to the waveform editor
        └── [id]/
            └── waveform.tsx    # new: waveform + clip editing screen
```

**On testing (per CLAUDE.md's "test pure helpers" rule):** `downsamplePeaks` has real branching (empty input, `barCount` larger than the source array, uneven bucket sizes) — this is exactly the kind of pure logic worth a dedicated test, unlike Phase 3a/3b/4a's one-line helpers. Node 24 (installed on this machine) runs `.ts` test files directly via built-in TypeScript stripping — `node --test lib/peaks.test.ts` needs no new npm dependency. Task 1 verifies this actually works before relying on it; if it doesn't, the task falls back to writing the test as plain `.js` rather than installing a test framework.

**Acceptance scope for 4b alone:** Dragging a touch handle can't be fully proven without a real device or precise synthetic pointer events. This phase's manual verification task (Task 5) proves: typecheck passes; the waveform renders real peak data with clip overlays positioned correctly (checked against computed DOM styles, not eyeballed from a screenshot); Split/Merge/Delete each produce the correct clip rows (checked via direct SQL); and drag-to-resize is exercised via simulated mouse-down/move/up events at known coordinates, with the resulting `start_sec`/`end_sec` checked against what those coordinates should produce — not just "it looked right."

---

## Task 1: Peaks downsampling helper

**Files:**
- Create: `apps/mobile/lib/peaks.ts`
- Create: `apps/mobile/lib/peaks.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { downsamplePeaks } from "./peaks";

test("empty input returns empty output", () => {
  assert.deepEqual(downsamplePeaks([], 10), []);
});

test("barCount of zero returns empty output", () => {
  assert.deepEqual(downsamplePeaks([[-1, 1], [-1, 1]], 0), []);
});

test("one bucket per source point when barCount equals length", () => {
  const input: [number, number][] = [[-1, 1], [-2, 2], [-3, 3]];
  assert.deepEqual(downsamplePeaks(input, 3), input);
});

test("aggregates min and max within each bucket", () => {
  const input: [number, number][] = [
    [-1, 1],
    [-5, 0.5],
    [-0.5, 5],
    [-2, 2],
  ];
  const result = downsamplePeaks(input, 2);
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], [-5, 1]);
  assert.deepEqual(result[1], [-2, 5]);
});

test("barCount larger than input length still returns barCount entries", () => {
  const input: [number, number][] = [[-1, 1]];
  const result = downsamplePeaks(input, 5);
  assert.equal(result.length, 5);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd apps/mobile
node --test lib/peaks.test.ts
```

Expected: fails because `lib/peaks.ts` doesn't exist yet (module not found). This also confirms whether Node's `.ts` stripping actually works in this environment — if the command itself errors in a way unrelated to the missing module (e.g. a syntax/transform error), STOP and report; don't proceed to writing a test framework dependency without discussing it first, per the plan's own reasoning above.

- [ ] **Step 3: Implement**

```typescript
export function downsamplePeaks(
  peaks: [number, number][],
  barCount: number
): [number, number][] {
  if (peaks.length === 0 || barCount <= 0) {
    return [];
  }

  const bucketSize = peaks.length / barCount;
  const result: [number, number][] = [];

  for (let i = 0; i < barCount; i++) {
    const start = Math.floor(i * bucketSize);
    const end = Math.max(start + 1, Math.floor((i + 1) * bucketSize));
    let min = Infinity;
    let max = -Infinity;
    for (let j = start; j < end && j < peaks.length; j++) {
      min = Math.min(min, peaks[j][0]);
      max = Math.max(max, peaks[j][1]);
    }
    if (min === Infinity) {
      const fallback = peaks[Math.min(start, peaks.length - 1)];
      result.push([fallback[0], fallback[1]]);
    } else {
      result.push([min, max]);
    }
  }

  return result;
}
```

The `min === Infinity` fallback handles the `barCount > peaks.length` case, where some buckets have no source samples (`start >= peaks.length`) — it reuses the nearest real sample instead of emitting `[0, 0]`, which would draw a false flat-line gap in the waveform.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
node --test lib/peaks.test.ts
```

Expected: 5 passed.

- [ ] **Step 5: Verify it typechecks as part of the app**

```bash
npx tsc --noEmit
```

Expected: `TypeScript: No errors found`.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/lib/peaks.ts apps/mobile/lib/peaks.test.ts
git commit -m "feat(mobile): add peaks downsampling helper with real tests"
```

---

## Task 2: Clip editing operations

**Files:**
- Modify: `apps/mobile/lib/clips.ts`

Adds four functions alongside Phase 4a's `assignSongToClip`, all setting `auto_detected: false` per `HANDOFF.md` §10 screen 6: "Editing sets `auto_detected=false`."

- [ ] **Step 1: Read the current file** to confirm `assignSongToClip` and the `supabase` import are exactly as Phase 4a left them.

- [ ] **Step 2: Append the four functions**

```typescript
export async function splitClipAtTime(
  clipId: string,
  rehearsalId: string,
  splitAtSec: number
): Promise<void> {
  const { data: clip } = await supabase.from("clips").select("*").eq("id", clipId).single();
  if (!clip || splitAtSec <= clip.start_sec || splitAtSec >= clip.end_sec) {
    return;
  }

  const originalEnd = clip.end_sec;

  await supabase
    .from("clips")
    .update({ end_sec: splitAtSec, auto_detected: false })
    .eq("id", clipId);

  await supabase.from("clips").insert({
    rehearsal_id: rehearsalId,
    start_sec: splitAtSec,
    end_sec: originalEnd,
    kind: clip.kind,
    song_id: clip.song_id,
    auto_detected: false,
  });
}

export async function mergeClipWithNext(
  clipId: string,
  nextClipId: string,
  nextEndSec: number
): Promise<void> {
  await supabase
    .from("clips")
    .update({ end_sec: nextEndSec, auto_detected: false })
    .eq("id", clipId);
  await supabase.from("clips").delete().eq("id", nextClipId);
}

export async function deleteClip(clipId: string): Promise<void> {
  await supabase.from("clips").delete().eq("id", clipId);
}

export async function updateClipBounds(
  clipId: string,
  startSec: number,
  endSec: number
): Promise<void> {
  await supabase
    .from("clips")
    .update({ start_sec: startSec, end_sec: endSec, auto_detected: false })
    .eq("id", clipId);
}
```

`splitClipAtTime`'s guard (`splitAtSec <= clip.start_sec || splitAtSec >= clip.end_sec`) prevents creating a zero-or-negative-length clip if the playhead happens to be outside the clip's current bounds when Split is pressed.

- [ ] **Step 3: Verify it compiles**

```bash
cd apps/mobile
npx tsc --noEmit
```

Expected: `TypeScript: No errors found`.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/lib/clips.ts
git commit -m "feat(mobile): add split, merge, delete, and bounds-update clip operations"
```

---

## Task 3: Waveform editor screen

**Files:**
- Create: `apps/mobile/app/rehearsal/[id]/waveform.tsx`

Per `HANDOFF.md` §10 screens 5-6: waveform with colored clip regions, drag handles, split/merge/delete, playback.

- [ ] **Step 1: Write the screen**

```typescript
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Button,
  Dimensions,
  PanResponder,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { supabase } from "../../../lib/supabase";
import { downsamplePeaks } from "../../../lib/peaks";
import {
  splitClipAtTime,
  mergeClipWithNext,
  deleteClip,
  updateClipBounds,
} from "../../../lib/clips";

type Clip = {
  id: string;
  start_sec: number;
  end_sec: number;
  kind: string;
};

const WAVEFORM_WIDTH = Math.min(Dimensions.get("window").width - 32, 800);
const WAVEFORM_HEIGHT = 120;
const BAR_COUNT = 150;
const HANDLE_WIDTH = 12;

export default function WaveformEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [bars, setBars] = useState<[number, number][]>([]);
  const [durationSec, setDurationSec] = useState(1);
  const [clips, setClips] = useState<Clip[]>([]);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);

  const player = useAudioPlayer(audioUrl ?? undefined);
  const status = useAudioPlayerStatus(player);

  async function loadClips() {
    const { data } = await supabase
      .from("clips")
      .select("id, start_sec, end_sec, kind")
      .eq("rehearsal_id", id)
      .order("start_sec", { ascending: true });
    setClips(data ?? []);
  }

  useEffect(() => {
    if (!id) {
      return;
    }

    (async () => {
      const { data: rehearsal } = await supabase
        .from("rehearsals")
        .select("storage_path, peaks_path, duration_sec")
        .eq("id", id)
        .single();

      if (!rehearsal || !rehearsal.peaks_path) {
        setLoading(false);
        return;
      }

      setDurationSec(rehearsal.duration_sec ?? 1);

      const { data: signedAudio } = await supabase.storage
        .from("rehearsals")
        .createSignedUrl(rehearsal.storage_path, 3600);
      setAudioUrl(signedAudio?.signedUrl ?? null);

      const { data: signedPeaks } = await supabase.storage
        .from("rehearsals")
        .createSignedUrl(rehearsal.peaks_path, 3600);

      if (signedPeaks?.signedUrl) {
        const peaksResponse = await fetch(signedPeaks.signedUrl);
        const rawPeaks: [number, number][] = await peaksResponse.json();
        setBars(downsamplePeaks(rawPeaks, BAR_COUNT));
      }

      await loadClips();
      setLoading(false);
    })();
  }, [id]);

  function secToX(sec: number): number {
    return (sec / durationSec) * WAVEFORM_WIDTH;
  }

  function xToSec(x: number): number {
    return Math.max(0, Math.min(durationSec, (x / WAVEFORM_WIDTH) * durationSec));
  }

  async function handleSplit() {
    const clip = clips.find((c) => c.id === selectedClipId);
    if (!clip || !id) {
      return;
    }
    await splitClipAtTime(clip.id, id, status.currentTime);
    await loadClips();
  }

  async function handleMerge() {
    const index = clips.findIndex((c) => c.id === selectedClipId);
    if (index === -1 || index === clips.length - 1) {
      return;
    }
    const clip = clips[index];
    const next = clips[index + 1];
    await mergeClipWithNext(clip.id, next.id, next.end_sec);
    setSelectedClipId(null);
    await loadClips();
  }

  async function handleDelete() {
    if (!selectedClipId) {
      return;
    }
    await deleteClip(selectedClipId);
    setSelectedClipId(null);
    await loadClips();
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator />
      </View>
    );
  }

  const selectedClip = clips.find((c) => c.id === selectedClipId) ?? null;

  return (
    <View style={styles.container}>
      <View style={[styles.waveform, { width: WAVEFORM_WIDTH, height: WAVEFORM_HEIGHT }]}>
        {bars.map(([min, max], index) => {
          const barHeight = Math.max(2, ((max - min) / 2) * WAVEFORM_HEIGHT);
          return (
            <View
              key={index}
              style={[
                styles.bar,
                {
                  height: barHeight,
                  width: WAVEFORM_WIDTH / BAR_COUNT,
                },
              ]}
            />
          );
        })}
        {clips.map((clip) => (
          <ClipOverlay
            key={clip.id}
            clip={clip}
            selected={clip.id === selectedClipId}
            onSelect={() => setSelectedClipId(clip.id)}
            secToX={secToX}
            xToSec={xToSec}
            onBoundsChange={async (startSec, endSec) => {
              await updateClipBounds(clip.id, startSec, endSec);
              await loadClips();
            }}
          />
        ))}
      </View>

      <Text>Playhead: {status.currentTime.toFixed(2)}s</Text>
      <Button title={status.playing ? "Pause" : "Play"} onPress={() => (status.playing ? player.pause() : player.play())} />

      {selectedClip ? (
        <View style={styles.actions}>
          <Text>
            Selected: {selectedClip.start_sec.toFixed(2)}s - {selectedClip.end_sec.toFixed(2)}s
          </Text>
          <View style={styles.actionRow}>
            <Button title="Split at playhead" onPress={handleSplit} />
            <Button title="Merge with next" onPress={handleMerge} />
            <Button title="Delete" onPress={handleDelete} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function ClipOverlay({
  clip,
  selected,
  onSelect,
  secToX,
  xToSec,
  onBoundsChange,
}: {
  clip: Clip;
  selected: boolean;
  onSelect: () => void;
  secToX: (sec: number) => number;
  xToSec: (x: number) => number;
  onBoundsChange: (startSec: number, endSec: number) => void;
}) {
  const [draftStart, setDraftStart] = useState(clip.start_sec);
  const [draftEnd, setDraftEnd] = useState(clip.end_sec);

  useEffect(() => {
    setDraftStart(clip.start_sec);
    setDraftEnd(clip.end_sec);
  }, [clip.start_sec, clip.end_sec]);

  const startPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderMove: (_evt, gesture) => {
        const newStartSec = xToSec(secToX(clip.start_sec) + gesture.dx);
        if (newStartSec < draftEnd) {
          setDraftStart(newStartSec);
        }
      },
      onPanResponderRelease: () => {
        onBoundsChange(draftStart, draftEnd);
      },
    })
  ).current;

  const endPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderMove: (_evt, gesture) => {
        const newEndSec = xToSec(secToX(clip.end_sec) + gesture.dx);
        if (newEndSec > draftStart) {
          setDraftEnd(newEndSec);
        }
      },
      onPanResponderRelease: () => {
        onBoundsChange(draftStart, draftEnd);
      },
    })
  ).current;

  const left = secToX(draftStart);
  const width = secToX(draftEnd) - left;

  return (
    <View
      style={[
        styles.overlay,
        {
          left,
          width,
          backgroundColor: clip.kind === "take" ? "rgba(34,197,94,0.3)" : "rgba(107,114,128,0.3)",
          borderColor: selected ? "#2563eb" : "transparent",
        },
      ]}
      onTouchEnd={onSelect}
    >
      {selected ? (
        <>
          <View
            {...startPanResponder.panHandlers}
            style={[styles.handle, { left: -HANDLE_WIDTH / 2 }]}
          />
          <View
            {...endPanResponder.panHandlers}
            style={[styles.handle, { right: -HANDLE_WIDTH / 2 }]}
          />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  waveform: {
    flexDirection: "row",
    alignItems: "flex-end",
    backgroundColor: "#f3f4f6",
    position: "relative",
  },
  bar: { backgroundColor: "#60a5fa", marginHorizontal: 0.5 },
  overlay: {
    position: "absolute",
    top: 0,
    bottom: 0,
    borderWidth: 2,
  },
  handle: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: HANDLE_WIDTH,
    backgroundColor: "#2563eb",
  },
  actions: { gap: 8 },
  actionRow: { flexDirection: "row", gap: 8 },
});
```

`ClipOverlay` keeps its own `draftStart`/`draftEnd` state during a drag so the handle follows the finger smoothly without a network round-trip per pixel, then commits via `onBoundsChange` (which calls `updateClipBounds` and reloads) only on release.

- [ ] **Step 2: Verify it compiles**

```bash
cd apps/mobile
npx tsc --noEmit
```

Expected: `TypeScript: No errors found`.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/app/rehearsal/\[id\]/waveform.tsx
git commit -m "feat(mobile): add waveform editor with drag, split, merge, delete"
```

---

## Task 4: Link to the waveform editor

**Files:**
- Modify: `apps/mobile/app/rehearsal/[id].tsx`

- [ ] **Step 1: Read the current file** to confirm its exact structure (Phase 4a left a `heading` Text and a `.map()` over `ClipRow` inside a `ScrollView`).

- [ ] **Step 2: Add a button above the clip list that navigates to the waveform editor**

Add the import:

```typescript
import { router, useLocalSearchParams } from "expo-router";
```

(This import likely already exists — if `router` isn't already imported, add it; don't duplicate the import line if it's there.)

Add a button immediately after the `<Text style={styles.heading}>Clips</Text>` line:

```typescript
<Button title="Edit waveform" onPress={() => router.push(`/rehearsal/${id}/waveform`)} />
```

- [ ] **Step 3: Verify it compiles**

```bash
cd apps/mobile
npx tsc --noEmit
```

Expected: `TypeScript: No errors found`.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/app/rehearsal/\[id\].tsx
git commit -m "feat(mobile): link rehearsal detail to waveform editor"
```

---

## Task 5: Manual end-to-end verification

Not automatable in full (real touch-drag needs a device) — but every piece of logic this phase added gets a real check, same pattern as every previous phase.

- [ ] **Step 1: Confirm the local Supabase stack is up, write `.env`, start the web dev server**

```bash
docker ps --format '{{.Names}}'
```

Launch Docker Desktop and `supabase start` if needed, then:

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

- [ ] **Step 2: Open a rehearsal with a real peaks.json and clips**

Sign in, navigate to a `ready` rehearsal (from earlier phases' testing), tap "Edit waveform."

- [ ] **Step 3: Verify waveform and overlay positions, not just visually**

In the browser, inspect the overlay `View`s' computed `left`/`width` (via devtools or a quick in-page script) and confirm they match `(start_sec / duration_sec) * waveform_width` for the actual clip data — catches off-by-one or unit-conversion bugs that look fine in a screenshot but are subtly wrong.

- [ ] **Step 4: Verify Split produces correct rows**

Play the clip briefly, pause partway through, select the clip, tap "Split at playhead." Then:

```bash
docker exec -i supabase_db_takesplit psql -U postgres -d postgres -c "select id, start_sec, end_sec, auto_detected from clips where rehearsal_id='<rehearsal-id>' order by start_sec;"
```

Confirm two rows now exist where one did, meeting at the playhead time, both `auto_detected=false`.

- [ ] **Step 5: Verify Merge produces correct rows**

Select the earlier of the two split clips, tap "Merge with next." Confirm via the same query that it's back to one row spanning the original full range, `auto_detected=false`.

- [ ] **Step 6: Verify Delete**

Select the clip, tap "Delete." Confirm via the same query that the row is gone.

- [ ] **Step 7: Verify drag-to-resize via simulated pointer events**

Using the browser automation's ability to dispatch mouse events at specific coordinates (not just `left_click`): press down on a clip's start handle, move 20px right, release. Compute what `start_sec` that 20px delta should produce given the waveform's pixel-per-second ratio, then query the database and confirm `clips.start_sec` matches within rounding tolerance.

- [ ] **Step 8: Record the result in `DECISIONS.md`**

Read the current file first, then append:

```markdown
- **<date>** — Phase 4b (waveform editing) manually verified: overlay positions checked against computed styles (not just screenshots) and matched expected pixel math; Split produced two correctly-bounded auto_detected=false clips; Merge correctly recombined them; Delete correctly removed a row; drag-to-resize verified via simulated pointer events, resulting start_sec matched the expected delta. <Note any issues found and fixed, or confirm none.> Real touch-drag on a physical device remains untested, consistent with every previous phase's device-testing deferral.
```

- [ ] **Step 9: Commit**

```bash
git add DECISIONS.md
git commit -m "docs: record Phase 4b end-to-end verification"
```

---

## Self-Review Notes

- **Spec coverage:** `HANDOFF.md` §8's waveform peaks (generated in Phase 2, rendered here) → Task 3. §10 screen 5 (clip editor: play/pause, drag handles, split, merge, delete, sets `auto_detected=false`) → Tasks 2-3. §10 screen 6 (waveform with colored clip regions) → Task 3. §6's "clips are virtual" principle (editing only ever writes `start_sec`/`end_sec`, never touches the audio file) → every function in Task 2 only issues Postgres writes, no storage calls. §14's "do not modify the original uploaded audio, ever" → confirmed no function in this phase writes to `storage.from("rehearsals")`, only reads (signed URLs).
- **Placeholder scan:** none — every task has complete, runnable code.
- **Type consistency:** `Clip` type in Task 3 (`id, start_sec, end_sec, kind`) is a subset of the one already used in `app/rehearsal/[id].tsx` — intentionally narrower since the waveform editor doesn't need `rating`/`song_title`. `splitClipAtTime(clipId: string, rehearsalId: string, splitAtSec: number)`, `mergeClipWithNext(clipId: string, nextClipId: string, nextEndSec: number)`, `deleteClip(clipId: string)`, `updateClipBounds(clipId: string, startSec: number, endSec: number)` (Task 2) match their call sites in Task 3's `handleSplit`/`handleMerge`/`handleDelete`/`ClipOverlay`'s `onBoundsChange` exactly.
