import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { login } from "../api/client";
import { useSession } from "../auth/SessionProvider";

export function LoginPage() {
  const nav = useNavigate();
  const session = useSession();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const fd = new FormData(e.currentTarget);
    const username = String(fd.get("u") ?? "");
    const password = String(fd.get("p") ?? "");
    try {
      const res = await login(username, password);
      await session.loginToken(res.sessionToken);
      if (res.user.role === "ADMIN") {
        nav("/admin", { replace: true });
      } else if (res.user.role === "JUDGE") {
        nav("/judge", { replace: true });
      } else {
        setError("Unknown account role.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "1rem",
        background: "#05070c",
      }}
    >
      <form
        onSubmit={onSubmit}
        style={{
          width: "min(420px, 92vw)",
          padding: "1.25rem",
          border: "1px solid #233249",
          borderRadius: "14px",
          background: "#0d151f",
        }}
      >
        <h1 style={{ margin: "0 0 0.35rem", fontSize: "1.35rem" }}>Arena login</h1>
        <p className="muted" style={{ margin: "0 0 1rem" }}>
          Admins manage competitions; judges score routines.
        </p>
        <label className="muted" style={{ display: "block", marginBottom: "0.25rem" }}>
          Username
        </label>
        <input name="u" autoComplete="username" required style={{ width: "100%", marginBottom: "0.75rem" }} />
        <label className="muted" style={{ display: "block", marginBottom: "0.25rem" }}>
          Password
        </label>
        <input
          name="p"
          type="password"
          autoComplete="current-password"
          required
          style={{ width: "100%", marginBottom: "0.75rem" }}
        />
        {error ? <p className="error">{error}</p> : null}
        <button type="submit" className="primary" disabled={busy} style={{ width: "100%", marginTop: "0.5rem" }}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
