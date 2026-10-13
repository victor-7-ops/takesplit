import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Button,
  Dimensions,
  PanResponder,
  Pressable,
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

  // PanResponder is created once (useRef) but drags can happen after draftStart/draftEnd
  // have since changed via a prior commit. Reading through a ref kept current every render
  // (rather than closing over draftStart/draftEnd directly) avoids the responder's callbacks
  // operating on stale values from whichever render first created it.
  const liveDraft = useRef({ draftStart, draftEnd });
  useEffect(() => {
    liveDraft.current = { draftStart, draftEnd };
  });

  const startDragBaseX = useRef(0);
  const endDragBaseX = useRef(0);

  const startPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startDragBaseX.current = secToX(liveDraft.current.draftStart);
      },
      onPanResponderMove: (_evt, gesture) => {
        const newStartSec = xToSec(startDragBaseX.current + gesture.dx);
        if (newStartSec < liveDraft.current.draftEnd) {
          setDraftStart(newStartSec);
        }
      },
      onPanResponderRelease: () => {
        onBoundsChange(liveDraft.current.draftStart, liveDraft.current.draftEnd);
      },
    })
  ).current;

  const endPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        endDragBaseX.current = secToX(liveDraft.current.draftEnd);
      },
      onPanResponderMove: (_evt, gesture) => {
        const newEndSec = xToSec(endDragBaseX.current + gesture.dx);
        if (newEndSec > liveDraft.current.draftStart) {
          setDraftEnd(newEndSec);
        }
      },
      onPanResponderRelease: () => {
        onBoundsChange(liveDraft.current.draftStart, liveDraft.current.draftEnd);
      },
    })
  ).current;

  const left = secToX(draftStart);
  const width = secToX(draftEnd) - left;

  return (
    <Pressable
      style={[
        styles.overlay,
        {
          left,
          width,
          backgroundColor: clip.kind === "take" ? "rgba(34,197,94,0.3)" : "rgba(107,114,128,0.3)",
          borderColor: selected ? "#2563eb" : "transparent",
        },
      ]}
      onPress={onSelect}
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
    </Pressable>
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
