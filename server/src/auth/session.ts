import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { sessions, users } from "../db/schema.js";

export async function createSession(userId: string) {
  const id = crypto.randomUUID();
  await db.insert(sessions).values({ id, userId, createdAt: new Date().toISOString() });
  return id;
}

export async function destroySession(sessionId: string | undefined | null) {
  if (!sessionId) return;
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export async function validateSession(sessionId: string | undefined | null) {
  if (!sessionId) return null;
  const [row] = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, sessionId));
  return row?.user ?? null;
}
