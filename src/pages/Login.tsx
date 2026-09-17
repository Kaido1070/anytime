import { useState, type FormEvent } from "react";
import { useLibrary } from "../hooks/useLibrary";
export function Login() {
  const { signIn } = useLibrary();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await signIn(String(form.get("username")), String(form.get("password")));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to sign in.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login">
      <div className="login-art">
        <span className="brand-mark">a</span>
        <p>A LITTLE ESCAPE, ALWAYS HERE.</p>
        <h1>
          One more
          <br />
          chapter<span>.</span>
        </h1>
        <div className="login-covers">
          <img src="/covers/eleceed.svg" alt="" />
          <img src="/covers/returner.svg" alt="" />
          <img src="/covers/solo.svg" alt="" />
        </div>
      </div>
      <div className="login-form">
        <p className="eyebrow">WELCOME TO ANYTIME</p>
        <h2>Your place in the story.</h2>
        <p className="muted">Sign in to your private reading room.</p>
        <form onSubmit={submit}>
          <label>
            Username
            <input
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              placeholder="Your username"
            />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              placeholder="Your password"
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"} <span>→</span>
          </button>
        </form>
        <p className="demo-note">
          PHASE 01 · MOCK LOGIN
          <br />
          <span>
            Mahdi, Kaido, or Ahmed · Password: <b>anytime</b>
          </span>
        </p>
      </div>
    </main>
  );
}
