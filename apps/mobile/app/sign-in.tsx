import { useState } from "react";
import { Button, StyleSheet, Text, TextInput, View } from "react-native";
import { supabase } from "../lib/supabase";

export default function SignIn() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignIn() {
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithOtp({ email });
    if (signInError) {
      setError(signInError.message);
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <View style={styles.container}>
        <Text>Check your email for a sign-in link.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text>Sign in to TakeSplit</Text>
      <TextInput
        style={styles.input}
        placeholder="you@example.com"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <Button title="Send magic link" onPress={handleSignIn} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 12, width: "100%" },
  error: { color: "red" },
});
