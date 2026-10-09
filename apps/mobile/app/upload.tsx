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
