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
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تسجيل الدخول.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <div className="login-art">
        <p className="eyebrow login-welcome">أهلا بك في WANY</p>
        <span className="brand-mark">w</span>
        <p>تابع قصتك</p>
        <h1>
          في أي وقت<span>.</span>
        </h1>
        <div className="login-covers">
          <img src="/covers/eleceed.svg" alt="" />
          <img src="/covers/returner.svg" alt="" />
          <img src="/covers/solo.svg" alt="" />
        </div>
      </div>
      <div className="login-form">
        <h2>ومن أي مكان.</h2>
        <p className="muted">سجّل دخولك وكمل من حيث توقفت.</p>
        <form onSubmit={submit}>
          <label>
            اسم المستخدم
            <input
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              placeholder="اسم المستخدم"
            />
          </label>
          <label>
            كلمة المرور
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              placeholder="كلمة المرور"
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "جاري الدخول…" : "تسجيل الدخول"} <span>←</span>
          </button>
        </form>
      </div>
    </main>
  );
}
