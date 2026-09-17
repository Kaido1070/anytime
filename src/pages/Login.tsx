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
      setError(error instanceof Error ? error.message : "تعذر تسجيل الدخول.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login">
      <div className="login-art">
        <span className="brand-mark">a</span>
        <p>تابع قصتك</p>
        <h1>
          في أي وقت
          <br />
          وأي مكان<span>.</span>
        </h1>
        <div className="login-covers">
          <img src="/covers/eleceed.svg" alt="" />
          <img src="/covers/returner.svg" alt="" />
          <img src="/covers/solo.svg" alt="" />
        </div>
      </div>
      <div className="login-form">
        <p className="eyebrow">أهلا بك في ANYTIME</p>
        <h2>مكانك داخل القصة.</h2>
        <p className="muted">سجل دخولك إلى مكتبتك الخاصة.</p>
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
        <p className="demo-note">
          المرحلة الأولى · تسجيل تجريبي
          <br />
          <span>
            Mahdi أو Kaido أو Ahmed · كلمة المرور: <b>anytime</b>
          </span>
        </p>
      </div>
    </main>
  );
}
