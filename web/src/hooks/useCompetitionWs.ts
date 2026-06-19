import { useCallback, useEffect, useRef, useState } from "react";
import { getToken } from "../api/client";

export type LiveWsEvent = { type: string; competitionId?: string };

type WsSend = (message: Record<string, unknown>) => void;

const LIVE_EVENT_TYPES = new Set([
  "global.updated",
  "competition.updated",
  "score.updated",
  "rankings.updated",
  "correction.requested",
]);

function isLiveEvent(type: string | undefined): boolean {
  return typeof type === "string" && LIVE_EVENT_TYPES.has(type);
}

/** Live sync over WebSocket — refreshes when server data changes. */
export function useCompetitionWs(
  competitionId: string | undefined,
  onLiveEvent: (event: LiveWsEvent) => void,
  onServerMessage?: (errorMessage: string) => void,
) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);
  const [ready, setReady] = useState(false);
  const onLiveEventRef = useRef(onLiveEvent);
  onLiveEventRef.current = onLiveEvent;
  const onServerMessageRef = useRef(onServerMessage);
  onServerMessageRef.current = onServerMessage;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingEventRef = useRef<LiveWsEvent | null>(null);
  const competitionIdRef = useRef(competitionId);
  competitionIdRef.current = competitionId;

  const flushLiveEvent = useCallback(() => {
    const ev = pendingEventRef.current;
    pendingEventRef.current = null;
    if (ev) onLiveEventRef.current(ev);
  }, []);

  const scheduleLiveEvent = useCallback(
    (event: LiveWsEvent) => {
      pendingEventRef.current = event;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        flushLiveEvent();
      }, 250);
    },
    [flushLiveEvent],
  );

  const subscribeCompetition = useCallback((ws: WebSocket, compId: string) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "competition.subscribe", competitionId: compId }));
    }
  }, []);

  const connect = useCallback(() => {
    const token = getToken();
    if (!token || unmountedRef.current) return;

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
          competitionId?: string;
          error?: string;
          payload?: { message?: string };
        };
        if (d.type === "auth.ok") {
          setReady(true);
          const compId = competitionIdRef.current;
          if (compId) subscribeCompetition(ws, compId);
          return;
        }
        if (d.type === "error.auth") {
          setReady(false);
          const authErr = typeof d.error === "string" ? d.error : "WebSocket authentication failed";
          onServerMessageRef.current?.(authErr);
          return;
        }
        const msg = d.payload?.message;
        if (typeof msg === "string" && (d.type === "error.ws" || d.type === "error.conflict")) {
          onServerMessageRef.current?.(msg);
          return;
        }
        if (isLiveEvent(d.type)) {
          scheduleLiveEvent({ type: d.type!, competitionId: d.competitionId });
        }
      } catch {
        /* ignore parse errors */
      }
    });

    ws.addEventListener("close", () => {
      setReady(false);
      wsRef.current = null;
      if (unmountedRef.current) return;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = setTimeout(() => connect(), 2500);
    });
  }, [scheduleLiveEvent, subscribeCompetition]);

  useEffect(() => {
    unmountedRef.current = false;
    connect();
    return () => {
      unmountedRef.current = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
      setReady(false);
    };
  }, [connect]);

  useEffect(() => {
    if (!competitionId || !ready) return;
    const ws = wsRef.current;
    if (ws) subscribeCompetition(ws, competitionId);
  }, [competitionId, ready, subscribeCompetition]);

  const send: WsSend = useCallback(
    (message) => {
      if (!competitionId || wsRef.current?.readyState !== WebSocket.OPEN) return;
      wsRef.current.send(JSON.stringify({ ...message, competitionId }));
    },
    [competitionId],
  );

  return { ready, send };
}

/** @deprecated Use useCompetitionWs */
export const useJudgeWs = useCompetitionWs;
