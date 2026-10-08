# Phase 3a Auth and Band Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get a real user from "opens the app" to "signed in and in a band" — magic-link auth, create-or-join band, and auth-state gating — on top of the Expo Router scaffold already in `apps/mobile`.

**Architecture:** One Supabase client module, one React Context for session+band state (no redux/zustand — a context is all two booleans and a string need), two screens (sign-in, band-setup), and real gating logic replacing the placeholder `app/index.tsx`. The real rehearsal list/upload/playback is Phase 3b — this phase stops at a placeholder "home" screen once a user has a band.

**Tech Stack:** Expo Router, `@supabase/supabase-js`, `@react-native-async-storage/async-storage` (already installed in Task 1 of the scaffold commit).

---

## File Structure

```
apps/mobile/
├── .env.example
├── lib/
│   ├── supabase.ts          # Supabase client, AsyncStorage session persistence
│   ├── invite-code.ts        # pure: generates a short invite code
│   └── session-context.tsx    # SessionProvider: tracks auth session + band membership
└── app/
    ├── _layout.tsx           # wraps the Stack in SessionProvider (modifies scaffold placeholder)
    ├── index.tsx              # gating: redirect to sign-in / band-setup / show home (modifies scaffold placeholder)
    ├── sign-in.tsx            # magic-link email form
    └── band-setup.tsx          # create band or join via invite code
```

`lib/supabase.ts` is the only file that constructs a Supabase client. `lib/session-context.tsx` is the only file that calls `supabase.auth.onAuthStateChange` — every screen reads session/band state through `useSession()`, never queries auth directly. This keeps the "who am I, what band am I in" logic in one place instead of duplicated across screens.

**Testing note:** `generateInviteCode()` in `lib/invite-code.ts` is a one-line wrapper around `crypto.randomUUID()`. No test framework exists in `apps/mobile` yet (no jest/testing-library in `package.json`), and adding one for a single trivial line would be the exact kind of unneeded dependency CLAUDE.md's lazy framing and this session's ponytail mode warn against. Per ponytail's own rule ("trivial one-liners need no test"), this function gets no dedicated test file — this is a deliberate call, not a silently-skipped requirement.

**Acceptance scope for 3a alone:** `HANDOFF.md`'s Phase 3 acceptance criterion ("Victor uploads a real rehearsal from iPhone and plays correct clips") needs Phase 3b's upload/playback work and can't be met by this phase alone. 3a's own bar: `tsc --noEmit` passes, and a real user can go from cold-start → magic-link email → signed in → create or join a band → placeholder home screen, verified against the local Supabase stack's Mailpit inbox (not mocked) via `npx expo start --web`.

---

## Task 1: Supabase client and env config

**Files:**
- Create: `apps/mobile/lib/supabase.ts`
- Create: `apps/mobile/.env.example`

No TDD here — this is a thin wrapper around a well-documented SDK constructor, not behavior to test in isolation.

- [ ] **Step 1: Write the client**

```typescript
import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. Copy .env.example to .env and fill in values."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});
```

`detectSessionInUrl: true` is required for the web-based manual verification in Task 7 (clicking a real magic-link email opens a browser URL containing the session token — the client needs to read it from there). It's a harmless no-op on native, where there's no browser URL to read.

- [ ] **Step 2: Write `.env.example`**

```
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
EXPO_PUBLIC_SUPABASE_ANON_KEY=change-me
```

Per `CLAUDE.md`: never commit real keys. `apps/mobile/.gitignore` already ignores `.env` (added when the scaffold was committed).

- [ ] **Step 3: Verify it compiles**

```bash
cd apps/mobile
npx tsc --noEmit
```

Expected: `TypeScript: No errors found` (the module isn't imported by anything yet, but it must still typecheck standalone).

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/lib/supabase.ts apps/mobile/.env.example
git commit -m "feat(mobile): add Supabase client with AsyncStorage session persistence"
```

---

## Task 2: Invite code generator

**Files:**
- Create: `apps/mobile/lib/invite-code.ts`

- [ ] **Step 1: Write the function**

```typescript
export function generateInviteCode(): string {
  return crypto.randomUUID().slice(0, 8).toUpperCase();
}
```

No test file — see the File Structure section's testing note above.

- [ ] **Step 2: Verify it compiles**

```bash
cd apps/mobile
npx tsc --noEmit
```

Expected: `TypeScript: No errors found`.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/lib/invite-code.ts
git commit -m "feat(mobile): add invite code generator"
```

---

## Task 3: Session context

**Files:**
- Create: `apps/mobile/lib/session-context.tsx`

This is the one place that tracks "who's signed in" and "what band are they in." Every screen reads from `useSession()` instead of querying Supabase auth/band_members directly.

- [ ] **Step 1: Write the context**

```typescript
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

type SessionState = {
  session: Session | null;
  bandId: string | null;
  loading: boolean;
};

const SessionContext = createContext<SessionState>({ session: null, bandId: null, loading: true });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [bandId, setBandId] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [bandLoading, setBandLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setAuthLoading(false);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setBandId(null);
      setBandLoading(false);
      return;
    }

    setBandLoading(true);
    supabase
      .from("band_members")
      .select("band_id")
      .eq("user_id", session.user.id)
      .limit(1)
      .then(({ data }) => {
        setBandId(data && data.length > 0 ? (data[0].band_id as string) : null);
        setBandLoading(false);
      });
  }, [session]);

  return (
    <SessionContext.Provider value={{ session, bandId, loading: authLoading || bandLoading }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionState {
  return useContext(SessionContext);
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd apps/mobile
npx tsc --noEmit
```

Expected: `TypeScript: No errors found`.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/lib/session-context.tsx
git commit -m "feat(mobile): add session context tracking auth and band membership"
```

---

## Task 4: Root layout and gating

**Files:**
- Modify: `apps/mobile/app/_layout.tsx` (currently a bare `<Stack />` from the scaffold commit)
- Modify: `apps/mobile/app/index.tsx` (currently a static placeholder from the scaffold commit)

- [ ] **Step 1: Wrap the Stack in `SessionProvider`**

Replace the full contents of `apps/mobile/app/_layout.tsx`:

```typescript
import { Stack } from "expo-router";
import { SessionProvider } from "../lib/session-context";

export default function RootLayout() {
  return (
    <SessionProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </SessionProvider>
  );
}
```

- [ ] **Step 2: Replace the placeholder index with real gating**

Replace the full contents of `apps/mobile/app/index.tsx`:

```typescript
import { Redirect } from "expo-router";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useSession } from "../lib/session-context";

export default function Index() {
  const { session, bandId, loading } = useSession();

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
      <Text>TakeSplit</Text>
      <Text>Signed in. Band ID: {bandId}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
});
```

- [ ] **Step 3: Verify it compiles**

```bash
cd apps/mobile
npx tsc --noEmit
```

Expected: `TypeScript: No errors found`. (It will fail to resolve `../lib/session-context` until Task 3 is done — this task assumes Task 3 is already committed, since tasks execute in order.)

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/app/_layout.tsx apps/mobile/app/index.tsx
git commit -m "feat(mobile): gate root screen on auth and band membership"
```

---

## Task 5: Sign-in screen

**Files:**
- Create: `apps/mobile/app/sign-in.tsx`

- [ ] **Step 1: Write the screen**

```typescript
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
```

- [ ] **Step 2: Verify it compiles**

```bash
cd apps/mobile
npx tsc --noEmit
```

Expected: `TypeScript: No errors found`.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/app/sign-in.tsx
git commit -m "feat(mobile): add magic-link sign-in screen"
```

---

## Task 6: Band setup screen

**Files:**
- Create: `apps/mobile/app/band-setup.tsx`

Uses the RLS policies from `supabase/migrations/0002_rls.sql`, already approved in Phase 1: `bands_insert` allows any authenticated user to create a band (`created_by = auth.uid()`), `band_members_insert` allows a user to insert only their own membership row. DECISIONS.md already tracks that invite-code validation is app-layer-only for now (no DB-level check) — this screen's "join" flow is exactly that app-layer validation: look up the band by invite code, then insert membership only if a matching band was found.

- [ ] **Step 1: Write the screen**

```typescript
import { useState } from "react";
import { Button, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { supabase } from "../lib/supabase";
import { generateInviteCode } from "../lib/invite-code";

export default function BandSetup() {
  const [mode, setMode] = useState<"create" | "join">("create");
  const [bandName, setBandName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setError(null);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      setError("Not signed in.");
      return;
    }

    const { data: band, error: bandError } = await supabase
      .from("bands")
      .insert({ name: bandName, invite_code: generateInviteCode(), created_by: userId })
      .select()
      .single();
    if (bandError || !band) {
      setError(bandError?.message ?? "Could not create band.");
      return;
    }

    const { error: memberError } = await supabase
      .from("band_members")
      .insert({ band_id: band.id, user_id: userId, display_name: displayName, role: "owner" });
    if (memberError) {
      setError(memberError.message);
      return;
    }

    router.replace("/");
  }

  async function handleJoin() {
    setError(null);
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      setError("Not signed in.");
      return;
    }

    const { data: band, error: bandError } = await supabase
      .from("bands")
      .select("id")
      .eq("invite_code", inviteCode)
      .single();
    if (bandError || !band) {
      setError("Invite code not found.");
      return;
    }

    const { error: memberError } = await supabase
      .from("band_members")
      .insert({ band_id: band.id, user_id: userId, display_name: displayName, role: "member" });
    if (memberError) {
      setError(memberError.message);
      return;
    }

    router.replace("/");
  }

  return (
    <View style={styles.container}>
      <Text>Set up your band</Text>
      <View style={styles.row}>
        <Button title="Create" onPress={() => setMode("create")} />
        <Button title="Join" onPress={() => setMode("join")} />
      </View>
      <TextInput style={styles.input} placeholder="Your name" value={displayName} onChangeText={setDisplayName} />
      {mode === "create" ? (
        <TextInput style={styles.input} placeholder="Band name" value={bandName} onChangeText={setBandName} />
      ) : (
        <TextInput
          style={styles.input}
          placeholder="Invite code"
          autoCapitalize="characters"
          value={inviteCode}
          onChangeText={setInviteCode}
        />
      )}
      <Button
        title={mode === "create" ? "Create band" : "Join band"}
        onPress={mode === "create" ? handleCreate : handleJoin}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 },
  row: { flexDirection: "row", gap: 12 },
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 12, width: "100%" },
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
git add apps/mobile/app/band-setup.tsx
git commit -m "feat(mobile): add create/join band screen"
```

---

## Task 7: Manual end-to-end verification (Victor or an agent with access to a browser)

Not automatable as a unit test — this is the real local-stack check that the whole flow actually works, mirroring how every previous phase's final acceptance step has been a real run against real infrastructure rather than a mock.

- [ ] **Step 1: Get local Supabase credentials and confirm the stack is running**

```bash
supabase status -o env
```

If it errors with "not running," run `supabase start` first (Docker Desktop must be running — this has needed a manual relaunch more than once this session; if `docker ps` shows no `supabase_*_takesplit` containers, open Docker Desktop and wait for it, then `supabase start`).

- [ ] **Step 2: Write `.env` for the mobile app**

```bash
cd apps/mobile
cat > .env <<'EOF'
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
EXPO_PUBLIC_SUPABASE_ANON_KEY=<paste ANON_KEY from `supabase status -o env`>
EOF
```

- [ ] **Step 3: Start the web dev server**

```bash
npx expo start --web
```

Note the actual local URL it prints (usually `http://localhost:8081`, but confirm — don't assume).

- [ ] **Step 4: Sign in with a real email**

Open the printed URL in a browser. Enter any email (e.g. `victor@ktd.test`) on the sign-in screen, tap "Send magic link."

- [ ] **Step 5: Read the magic link from the local Mailpit inbox**

`supabase status` prints a Mailpit/Inbucket URL (something like `http://127.0.0.1:54324`). Open it, find the email just sent, and click the magic link inside it. It should open back in the app's browser tab and land you signed in.

If the link redirects to a different port than Step 3's dev server printed, the `signInWithOtp` call needs an explicit `emailRedirectTo` pointing at the right URL — add `{ emailRedirectTo: "http://localhost:<actual-port>" }` as a second argument to `supabase.auth.signInWithOtp({ email })` in `apps/mobile/app/sign-in.tsx` and retry, committing that fix if needed.

- [ ] **Step 6: Create a band**

After signing in, you should land on the band-setup screen (no band yet). Enter a display name and band name, tap "Create band." You should land on the placeholder home screen showing your band ID.

- [ ] **Step 7: Confirm the join flow works for a second user**

Open a private/incognito browser window, repeat steps 4-5 with a different email, and on band-setup choose "Join" with the invite code from the band created in Step 6 (visible in Supabase Studio's `bands` table, or query it: the local Studio URL is also in `supabase status` output). Confirm the second user also lands on the home screen.

- [ ] **Step 8: Record the result in `DECISIONS.md`**

Read the current file first, then append (don't rewrite existing content):

```markdown
- **<date>** — Phase 3a (auth + band setup) manually verified end-to-end against the local Supabase stack via `npx expo start --web`: real magic-link email read from Mailpit, sign-in succeeded, band creation and a second user joining via invite code both worked, landing on the placeholder home screen. Native (iOS/Android) deep-link handling for the magic-link redirect was NOT tested in this phase — `detectSessionInUrl: true` covers the web flow tested here; native magic-link completion (via `expo-linking` + a registered URL scheme) is deferred to whenever device testing starts, consistent with Phase 0-2's pattern of deferring real-device verification to its own explicit step.
```

- [ ] **Step 9: Commit**

```bash
git add DECISIONS.md
git commit -m "docs: record Phase 3a end-to-end verification"
```

---

## Self-Review Notes

- **Spec coverage:** `HANDOFF.md` §10 screen 1 (auth, magic link) → Task 5. Screen 2 (band setup, create or join with invite code) → Task 6. §7's schema/RLS (bands self-serve creation, band_members self-join) → Tasks 6, already-approved Phase 1 policies reused as-is, no new migration needed. §14's TypeScript strict rule → every task's compile-check step. The narrowed 3a acceptance bar (typecheck + real local auth/band flow, not full device upload/playback) is defined explicitly in the File Structure section rather than silently reinterpreting HANDOFF's Phase 3 criterion.
- **Placeholder scan:** none — every task has complete, runnable code. The one deliberate scope-narrowing (no native deep-link testing) is written out as a real limitation in Task 7's DECISIONS.md entry, not hidden.
- **Type consistency:** `useSession()` returns `{ session: Session | null; bandId: string | null; loading: boolean }` consistently used in `app/index.tsx` (Task 4). `generateInviteCode(): string` signature matches its one call site in `app/band-setup.tsx` (Task 6). `supabase` export from `lib/supabase.ts` (Task 1) is the only import used across `session-context.tsx`, `sign-in.tsx`, and `band-setup.tsx` — no screen constructs its own client.
