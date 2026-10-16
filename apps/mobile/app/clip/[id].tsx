import { useEffect, useState } from "react";
import { ActivityIndicator, Button, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { supabase } from "../../lib/supabase";
import { assignSongToClip } from "../../lib/clips";
import { QUICK_TAGS } from "../../lib/tags";

type Song = { id: string; title: string };
type Comment = {
  id: string;
  body: string;
  at_sec: number | null;
  created_at: string;
};

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
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [newCommentBody, setNewCommentBody] = useState("");
  const [captureAtPlayhead, setCaptureAtPlayhead] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);

  const player = useAudioPlayer(audioUrl ?? undefined);
  const status = useAudioPlayerStatus(player);

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

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
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

      {saving ? <ActivityIndicator /> : <Button title="Save" onPress={handleSave} />}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 8 },
  heading: { fontSize: 16, fontWeight: "600", marginTop: 12 },
  row: { flexDirection: "row", gap: 8, alignItems: "center" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: "#ccc" },
  chipSelected: { backgroundColor: "#dbeafe", borderColor: "#2563eb" },
  input: { flex: 1, borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 10 },
  notes: { borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 10, minHeight: 80 },
  error: { color: "red" },
  commentRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#eee", gap: 2 },
  meta: { color: "#666", fontSize: 12 },
});
