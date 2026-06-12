import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { clearToken, me, setToken, type User } from "../api/client";

type SessionState = {
  hydrated: boolean;
  token?: string;
  user?: User;
};

type SessionContextValue = SessionState & {
  loginToken: (token: string) => Promise<void>;
  logoutFn: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ hydrated: false });

  useEffect(() => {
    const token = sessionStorage.getItem("gym_session_token");
    if (!token) {
      // #region agent log
      void fetch("http://127.0.0.1:7446/ingest/1cb515c7-c4af-48be-a4e5-3665f7d270e2", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "5f3141" },
        body: JSON.stringify({
          sessionId: "5f3141",
          location: "SessionProvider.tsx:no-token",
          message: "hydrate without token",
          data: {},
          timestamp: Date.now(),
          hypothesisId: "H5",
        }),
      }).catch(() => {});
      // #endregion
      setState({ hydrated: true });
      return;
    }
    me()
      .then((d) => {
        // #region agent log
        void fetch("http://127.0.0.1:7446/ingest/1cb515c7-c4af-48be-a4e5-3665f7d270e2", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "5f3141" },
          body: JSON.stringify({
            sessionId: "5f3141",
            location: "SessionProvider.tsx:me:ok",
            message: "me() ok",
            data: { role: d.user.role },
            timestamp: Date.now(),
            hypothesisId: "H4",
          }),
        }).catch(() => {});
        // #endregion
        setState({ token, user: d.user, hydrated: true });
      })
      .catch((e) => {
        // #region agent log
        void fetch("http://127.0.0.1:7446/ingest/1cb515c7-c4af-48be-a4e5-3665f7d270e2", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "5f3141" },
          body: JSON.stringify({
            sessionId: "5f3141",
            location: "SessionProvider.tsx:me:catch",
            message: "me() failed",
            data: { err: String(e) },
            timestamp: Date.now(),
            hypothesisId: "H4",
          }),
        }).catch(() => {});
        // #endregion
        clearToken();
        setState({ hydrated: true });
      });
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      ...state,
      loginToken: async (token) => {
        setToken(token);
        const d = await me();
        setState({ token, user: d.user, hydrated: true });
      },
      logoutFn: async () => {
        try {
          await fetch("/api/auth/logout", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${sessionStorage.getItem("gym_session_token") ?? ""}`,
              "Content-Type": "application/json",
            },
            body: "{}",
          });
        } catch {
          /* ignore */
        }
        clearToken();
        setState({ hydrated: true, token: undefined, user: undefined });
      },
    }),
    [state],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("SessionProvider missing");
  return ctx;
}
