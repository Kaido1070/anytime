import { useState, type FormEvent } from "react";
import { useLibrary } from "../hooks/useLibrary";
import { userDataService } from "../services/userData";

export function Login() {
  const { signIn } = useLibrary();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [recoveryDone, setRecoveryDone] = useState(false);
  const [recoveryMethod, setRecoveryMethod] = useState("security-question");
  const [recoveryUsername, setRecoveryUsername] = useState("");
  const [securityQuestion, setSecurityQuestion] = useState("");

  async function loadSecurityQuestion() {
    if (busy || !recoveryUsername.trim()) return;
    setBusy(true); setError(""); setSecurityQuestion("");
    try { setSecurityQuestion(await userDataService.getSecurityQuestion(recoveryUsername)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر عرض سؤال الأمان."); }
    finally { setBusy(false); }
  }

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

  async function recover(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setRecoveryDone(false);
    const form = new FormData(event.currentTarget);
    const password = String(form.get("newPassword"));
    const confirm = String(form.get("confirmPassword"));
    if (password !== confirm) {
      setError("تأكيد كلمة المرور غير مطابق.");
      setBusy(false);
      return;
    }
    try {
      if (recoveryMethod === "security-question") {
        if (!securityQuestion) throw new Error("اضغط «عرض سؤال الأمان» أولًا.");
        await userDataService.recoverWithSecurityAnswer(String(form.get("username")), String(form.get("securityAnswer")), password);
      } else {
        await userDataService.recoverPassword(String(form.get("username")), String(form.get("recoveryCode")), password);
      }
      setRecoveryDone(true);
      setRecovering(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر استعادة الحساب.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <div className="login-art">
        <span className="brand-mark">w</span>
        <p className="eyebrow login-welcome">أهلا بك في WANY</p>
        <p className="login-kicker">تابع قصتك</p>
        <h1>في أي وقت<span>.</span></h1>
        <div className="login-covers">
          <img src="/covers/eleceed.svg" alt="" />
          <img src="/covers/returner.svg" alt="" />
          <img src="/covers/solo.svg" alt="" />
        </div>
      </div>
      <div className="login-form">
        <h2>{recovering ? "استعادة الحساب." : "ومن أي مكان."}</h2>
        <p className="muted">
          {recovering ? "استعد حسابك بسؤال الأمان أو رمز الاستعادة." : "سجّل دخولك وكمل من حيث توقفت."}
        </p>

        {recoveryDone && <p className="login-success" role="status">تم تغيير كلمة المرور. تقدر تسجل دخولك الآن.</p>}

        {recovering ? (
          <form onSubmit={recover}>
            <label>اسم المستخدم
              <input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required placeholder="اسم المستخدم" value={recoveryUsername} disabled={busy} onChange={event => { setRecoveryUsername(event.target.value); setSecurityQuestion(""); }} />
            </label>
            <label>طريقة الاستعادة<select value={recoveryMethod} disabled={busy} onChange={event => { setRecoveryMethod(event.target.value); setError(""); }}><option value="security-question">سؤال الأمان</option><option value="code">رمز الاستعادة</option></select></label>
            {recoveryMethod === "security-question" ? <>
              <button className="secondary" type="button" disabled={busy || !recoveryUsername.trim()} onClick={() => void loadSecurityQuestion()}>عرض سؤال الأمان</button>
              {securityQuestion && <label>{securityQuestion}<input name="securityAnswer" type="password" autoComplete="off" minLength={1} maxLength={128} required disabled={busy} placeholder="إجابتك" /></label>}
            </> : <label>رمز الاستعادة
              <input name="recoveryCode" autoComplete="off" autoCapitalize="none" spellCheck={false} required placeholder="WANY-..." />
            </label>}
            <label>كلمة المرور الجديدة
              <input name="newPassword" type="password" autoComplete="new-password" minLength={6} required placeholder="كلمة المرور الجديدة" />
            </label>
            <label>تأكيد كلمة المرور
              <input name="confirmPassword" type="password" autoComplete="new-password" minLength={6} required placeholder="أعد كتابة كلمة المرور" />
            </label>
            {error && <p className="error" role="alert">{error}</p>}
            <button className="primary" disabled={busy}>{busy ? "جاري الاستعادة…" : "تغيير كلمة المرور"} <span>←</span></button>
            <button className="login-recovery-link" type="button" onClick={() => { setRecovering(false); setError(""); }}>العودة لتسجيل الدخول</button>
          </form>
        ) : (
          <form onSubmit={submit}>
            <label>اسم المستخدم
              <input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required placeholder="اسم المستخدم" />
            </label>
            <label>كلمة المرور
              <input name="password" type="password" autoComplete="current-password" required placeholder="كلمة المرور" />
            </label>
            {error && <p className="error" role="alert">{error}</p>}
            <button className="primary" disabled={busy}>{busy ? "جاري الدخول…" : "تسجيل الدخول"} <span>←</span></button>
            <button className="login-recovery-link" type="button" onClick={() => { setRecovering(true); setRecoveryDone(false); setError(""); }}>نسيت كلمة المرور؟</button>
          </form>
        )}
      </div>
    </main>
  );
}
