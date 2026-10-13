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
