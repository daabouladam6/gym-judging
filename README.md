# Gym judging (local dev)

## Quick start (Windows)

1. Double-click **`start-dev.cmd`** in this folder  
   *(or open PowerShell here and run `npm run dev`* after `npm install`*)*.
2. Wait until the terminal shows Vite is ready; your browser may auto-open the app root (then you land on **`/login`** if not signed in). You can open **`http://127.0.0.1:5173/login`** manually (use **`127.0.0.1`**, not only `localhost`, if you hit connection errors).

You must keep the terminal window open — closing it stops the servers.

API + WebSocket: `http://127.0.0.1:3000`

## Database schema updates

After pulling changes that add new tables (e.g. judge correction requests), run from the repo root:

`npm run db:push -w @gym/server`

That applies the current Drizzle schema to `server/data/gym.db`. If the CLI warns about data loss (e.g. dropping an old column) and you are stuck on the prompt, use **`npm run db:push:force -w @gym/server`** instead so the push completes non-interactively (review the warning first).

## Error -102 (`ERR_CONNECTION_REFUSED`)

Usually means the dev servers were **not running** (nothing listening on port 5173), or `localhost` hit IPv6 while Vite listened on IPv4. **Any path** (`/`, `/login`, `/admin`) fails the same way until Vite is up. Start **`npm run dev`** (or **`start-dev.cmd`**), wait for Vite **ready**, then open **`http://127.0.0.1:5173/`** or **`http://127.0.0.1:5173/login`**.

## Archiving to History (admin)

History is **per athlete category** inside a competition (for example HP2 finished while USAG Level 1 is still active). In **Arena control → History**, pick the competition and an **active** category, then **Archive this category to History**. That category’s athletes and scores leave the main workspace; other categories in the same competition stay active. Use the same password as **deleting a competition** (default **`admin123`**, or **`COMPETITION_DELETE_PASSWORD`** on the server). **Restore category** brings a History segment back. Admins can open a History segment to view or adjust scores and roster metadata. After schema pulls, run **`npm run db:push -w @gym/server`** so SQLite has `athletes.archived_at` (see Database schema updates above).

## Deleting a competition

Deleting a competition asks for confirmation, then prompts for a deletion password (default **`admin123`**). On the server you can set env **`COMPETITION_DELETE_PASSWORD`** to change it.
