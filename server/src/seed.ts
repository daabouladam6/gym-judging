import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";
import { db } from "./db/index.js";
import { users } from "./db/schema.js";

const [existing] = await db.select().from(users).where(eq(users.username, "admin"));
if (existing) {
  console.log("Admin already exists, skipping seed.");
  process.exit(0);
}

const id = crypto.randomUUID();
await db.insert(users).values({
  id,
  username: "admin",
  passwordHash: bcrypt.hashSync("admin123", 10),
  displayName: "Admin",
  role: "ADMIN",
  createdAt: new Date().toISOString(),
});
console.log("Seeded admin / admin123");
