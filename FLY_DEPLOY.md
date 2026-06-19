# Fly deploy (dashboard / GitHub only)

## If deploys keep failing — read this first

Fly often prints a command like:

```text
flyctl deploy -a artisticg-gymnastics-judging --image registry.fly.io/...:deployment-XXXXXXXX...
```

**Do not copy and run that command again after a failed deploy.**

That command **does not build** your app. It only says “run this **already-built** image.” If that image is broken, you will get the **same failure forever** (wrong port, or Node not running at all).

You need a **new build from GitHub `main`**, not another deploy of the same `deployment-…` tag.

---

## Your Fly settings are correct

In **Configuration → Internal port: 8080** — **leave it at 8080.**  
That must match `fly.toml` `internal_port` and the app listening on `PORT=8080`.

---

## Deploy the right way (no local CLI)

1. Open [Fly dashboard](https://fly.io/apps/artisticg-gymnastics-judging) → your app.
2. Confirm **GitHub** is connected to **`daabouladam6/gym-judging`**, branch **`main`**.
3. Click **Deploy app** (or push a new commit to `main` if auto-deploy is on).
4. Wait until the log shows a **build** step (`npm run build`, Dockerfile, etc.), not only `Searching for image ... image found`.
5. While it deploys, open **Logs & Errors**:
   - If you see **`Missing frontend build`** → build failed in the image.
   - If you see **`no such table`** → DB seed step missing (old Dockerfile).
   - If you see **`Gym judging server http://0.0.0.0:8080`** → server started correctly.

6. After success, open `https://artisticg-gymnastics-judging.fly.dev/login` and sign in with **`admin` / `admin123`**.

---

## What the error messages mean

| Fly message | Meaning |
|-------------|---------|
| `node ... 0.0.0.0:3000` | Old image; app on wrong port. Need **new build** from current `main`. |
| Only `hallpass` on port 22, **no `node`** | App **crashed on startup**. Check **Logs & Errors**; do not redeploy same `--image` tag. |
| `not listening on 0.0.0.0:8080` | Proxy port mismatch or process not up. New build + logs. |

---

## Optional: deploy from your PC

Install [flyctl](https://fly.io/docs/hands-on/install-flyctl/), then from this repo root:

```bash
fly deploy --config fly.toml
```

Or double-click **`scripts/fly-deploy.cmd`**.  
**Never** add `--image registry.fly.io/...:deployment-...` for routine updates.
