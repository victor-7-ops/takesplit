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
    let cancelled = false;

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
        if (cancelled) return;
        setBandId(data && data.length > 0 ? (data[0].band_id as string) : null);
        setBandLoading(false);
      });

    return () => {
      cancelled = true;
    };
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
