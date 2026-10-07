import { useState, type FormEvent } from "react";
import { useLibrary } from "../hooks/useLibrary";
import { userDataService } from "../services/userData";

export function Login() {
  const { signIn } = useLibrary();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [accountCreated, setAccountCreated] = useState(false);
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
    if (busy) return;
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const element = event.currentTarget;
    try {
      if (registering) {
        const password = String(form.get("password"));
        if (password !== String(form.get("confirmPassword"))) throw new Error("تأكيد كلمة المرور غير مطابق.");
        await userDataService.register(String(form.get("username")), password, String(form.get("inviteCode")));
        element.reset();
        setRegistering(false);
        setAccountCreated(true);
      } else {
        await signIn(String(form.get("username")), String(form.get("password")));
      }
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
        <h2>{recovering ? "استعادة الحساب." : registering ? "إنشاء حساب." : "ومن أي مكان."}</h2>
        <p className="muted">
          {recovering ? "استعد حسابك بسؤال الأمان أو رمز الاستعادة." : registering ? "تحتاج كود دعوة من صاحب الموقع لإنشاء حساب." : "سجّل دخولك وكمل من حيث توقفت."}
        </p>

        {recoveryDone && <p className="login-success" role="status">تم تغيير كلمة المرور. تقدر تسجل دخولك الآن.</p>}
        {accountCreated && <p className="login-success" role="status">تم إنشاء حسابك. سجّل دخولك الآن.</p>}

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
          <form key={registering ? "register" : "login"} onSubmit={submit}>
            <label>اسم المستخدم
              <input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required disabled={busy} minLength={registering ? 3 : undefined} maxLength={registering ? 32 : undefined} pattern={registering ? "[A-Za-z0-9][A-Za-z0-9_]{2,31}" : undefined} placeholder="اسم المستخدم" />
            </label>
            <label>كلمة المرور
              <input name="password" type="password" autoComplete={registering ? "new-password" : "current-password"} disabled={busy} minLength={registering ? 8 : undefined} maxLength={128} required placeholder="كلمة المرور" />
            </label>
            {registering && <>
              <label>تأكيد كلمة المرور
                <input name="confirmPassword" type="password" autoComplete="new-password" minLength={8} maxLength={128} disabled={busy} required placeholder="أعد كتابة كلمة المرور" />
              </label>
              <label>كود الدعوة
                <input name="inviteCode" type="password" autoComplete="off" autoCapitalize="none" spellCheck={false} minLength={8} maxLength={128} disabled={busy} required placeholder="الكود الذي أعطاك صاحب الموقع" />
              </label>
            </>}
            {error && <p className="error" role="alert">{error}</p>}
            <button className="primary" disabled={busy}>{busy ? registering ? "جاري إنشاء الحساب…" : "جاري الدخول…" : registering ? "إنشاء الحساب" : "تسجيل الدخول"} <span>←</span></button>
            <button className="login-recovery-link" type="button" disabled={busy} onClick={() => { setRegistering(!registering); setAccountCreated(false); setRecoveryDone(false); setError(""); }}>{registering ? "العودة لتسجيل الدخول" : "إنشاء حساب بكود دعوة"}</button>
            {!registering && <button className="login-recovery-link" type="button" disabled={busy} onClick={() => { setRecovering(true); setAccountCreated(false); setRecoveryDone(false); setError(""); }}>نسيت كلمة المرور؟</button>}
          </form>
        )}
      </div>
    </main>
  );
}
