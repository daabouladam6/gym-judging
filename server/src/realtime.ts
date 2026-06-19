import type { WebSocket } from "ws";

const rooms = new Map<string, Set<WebSocket>>();
const globalSockets = new Set<WebSocket>();

export function registerGlobalSocket(socket: WebSocket): () => void {
  globalSockets.add(socket);
  return () => {
    globalSockets.delete(socket);
  };
}

export function subscribe(competitionId: string, socket: WebSocket): () => void {
  let set = rooms.get(competitionId);
  if (!set) {
    set = new Set();
    rooms.set(competitionId, set);
  }
  if (set.has(socket)) {
    return () => {
      set!.delete(socket);
      if (!set!.size) rooms.delete(competitionId);
    };
  }
  set.add(socket);
  return () => {
    set!.delete(socket);
    if (!set!.size) rooms.delete(competitionId);
  };
}

export function broadcast(competitionId: string, message: Record<string, unknown>) {
  const set = rooms.get(competitionId);
  if (!set) return;
  const raw = JSON.stringify(message);
  for (const s of set) {
    if (s.readyState === 1) s.send(raw);
  }
}

export function broadcastGlobal(message: Record<string, unknown>) {
  const raw = JSON.stringify(message);
  for (const s of globalSockets) {
    if (s.readyState === 1) s.send(raw);
  }
}
