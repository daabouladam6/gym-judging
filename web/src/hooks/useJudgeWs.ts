import { useCallback, useEffect, useRef, useState } from "react";
import { getToken } from "../api/client";

type WsSend = (message: Record<string, unknown>) => void;

export function useJudgeWs(
  competitionId: string | undefined,
  onRefresh: () => void,
  onServerMessage?: (errorMessage: string) => void,
) {
  const wsRef = useRef<WebSocket | null>(null);
  const [ready, setReady] = useState(false);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;
  const onServerMessageRef = useRef(onServerMessage);
  onServerMessageRef.current = onServerMessage;

  useEffect(() => {
    if (!competitionId) return;
    const token = getToken();
    if (!token) return;

    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${location.host}/ws`);
    wsRef.current = ws;

    ws.addEventListener("open", () => {
      setReady(false);
      ws.send(JSON.stringify({ type: "auth.session", payload: { sessionToken: token } }));
    });

    ws.addEventListener("message", (ev) => {
      try {
        const d = JSON.parse(String(ev.data)) as {
          type?: string;
          error?: string;
          payload?: { message?: string };
        };
        if (d.type === "auth.ok") {
          setReady(true);
        }
        if (d.type === "error.auth") {
          setReady(false);
          const authErr = typeof d.error === "string" ? d.error : "WebSocket authentication failed";
          onServerMessageRef.current?.(authErr);
        }
        const msg = d.payload?.message;
        if (typeof msg === "string" && (d.type === "error.ws" || d.type === "error.conflict")) {
          onServerMessageRef.current?.(msg);
        }
      } catch {
        /* ignore parse errors */
      }
      onRefreshRef.current();
    });

    ws.addEventListener("close", () => setReady(false));

    return () => {
      ws.close();
      wsRef.current = null;
      setReady(false);
    };
  }, [competitionId]);

  const send: WsSend = useCallback(
    (message) => {
      if (!competitionId || wsRef.current?.readyState !== WebSocket.OPEN) return;
      wsRef.current.send(JSON.stringify({ ...message, competitionId }));
    },
    [competitionId],
  );

  return { ready, send };
}
