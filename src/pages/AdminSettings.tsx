import { useState, type FormEvent } from "react";
import { useLibrary } from "../hooks/useLibrary";

export function AdminSettings() {
  const { user, changePassword, signOut } = useLibrary();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    const password = String(values.get("newPassword") ?? "");
    setError(""); setMessage("");
    if (password !== values.get("confirmPassword")) {
      setError("كلمتا المرور غير متطابقتين."); return;
    }
    setBusy(true);
    try {
      await changePassword(String(values.get("currentPassword") ?? ""), password);
      form.reset();
      setMessage("تم تغيير كلمة مرورك وتسجيل الخروج من الأجهزة الأخرى.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تغيير كلمة المرور.");
    } finally { setBusy(false); }
  }

  async function logoutAll() {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try { await signOut(true); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر تسجيل الخروج."); }
    finally { setBusy(false); }
  }

  return <section className="settings-card" dir="rtl">
    <h1>إعدادات حساب الأدمن</h1>
    <p>اسم المستخدم: {user?.username}</p>
    <form className="settings-password-form" onSubmit={savePassword}>
      <h2>تغيير كلمة المرور</h2>
      <label>كلمة المرور الحالية<input name="currentPassword" type="password" autoComplete="current-password" maxLength={128} required disabled={busy} /></label>
      <label>كلمة المرور الجديدة<input name="newPassword" type="password" autoComplete="new-password" minLength={6} maxLength={128} required disabled={busy} /></label>
      <label>تأكيد كلمة المرور<input name="confirmPassword" type="password" autoComplete="new-password" minLength={6} maxLength={128} required disabled={busy} /></label>
      <button className="primary" type="submit" disabled={busy}>{busy ? "جارٍ التنفيذ…" : "حفظ كلمة المرور"}</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    <button className="secondary" type="button" disabled={busy} onClick={() => void logoutAll()}>تسجيل الخروج من كل الأجهزة</button>
  </section>;
}
