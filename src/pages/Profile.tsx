import { useState, type FormEvent } from "react";
import { useLibrary } from "../hooks/useLibrary";
import { sourceService } from "../services/sources";

export function Profile({ embedded = false }: { embedded?: boolean }) {
  const { user, data, signOut, changePassword } = useLibrary();
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [busy, setBusy] = useState(false);

  const favorites = (data?.favorites ?? []).filter((id) => sourceService.isSourceKey(id)).length;
  const reading = new Set(
    Object.values(data?.progress ?? {})
      .filter((p) => sourceService.isSourceKey(p.mangaId))
      .filter((p) => !data?.completed.includes(`${p.mangaId}:${p.chapter}`))
      .map((p) => p.mangaId),
  ).size;

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setPasswordMessage("");
    setPasswordError("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const currentPassword = String(form.get("currentPassword") ?? "");
    const newPassword = String(form.get("newPassword") ?? "");
    const confirmPassword = String(form.get("confirmPassword") ?? "");

    if (newPassword !== confirmPassword) {
      setPasswordError("تأكيد كلمة المرور غير مطابق.");
      setBusy(false);
      return;
    }

    try {
      await changePassword(currentPassword, newPassword);
      formElement.reset();
      setPasswordMessage("تم تغيير كلمة المرور.");
    } catch (cause) {
      setPasswordError(
        cause instanceof Error ? cause.message : "تعذر تغيير كلمة المرور.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {embedded ? (
        <div className="account-settings-intro">
          <p className="eyebrow">الحساب والأمان</p>
          <h2>الإعدادات</h2>
        </div>
      ) : (
        <>
          <p className="eyebrow">حسابك في ANYTIME</p>
          <h1>
            حسابي<span className="accent">.</span>
          </h1>
          <div className="profile-heading">
            <span className="avatar profile-avatar">{user?.name[0]}</span>
            <h2>{user?.name}</h2>
            <p className="muted">@{user?.username}</p>
          </div>
          <div className="stats">
            <div>
              <strong>{favorites}</strong>
              <span>المفضلة</span>
            </div>
            <div>
              <strong>{reading}</strong>
              <span>قيد القراءة</span>
            </div>
          </div>
        </>
      )}
      <div className="profile-info">
        <p>
          <span>الاسم الظاهر</span>
          <b>{user?.name}</b>
        </p>
        <p>
          <span>اسم المستخدم</span>
          <b>@{user?.username}</b>
        </p>
        <p>
          <span>المزامنة</span>
          <b>محفوظة في حسابك</b>
        </p>
      </div>

      <div className="login-form" style={{ maxWidth: 460, margin: "34px auto 0" }}>
        <p className="eyebrow">الأمان</p>
        <h2>تغيير كلمة المرور</h2>
        <form onSubmit={submitPassword}>
          <label>
            كلمة المرور الحالية
            <input
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <label>
            كلمة المرور الجديدة
            <input
              name="newPassword"
              type="password"
              autoComplete="new-password"
              minLength={4}
              required
            />
          </label>
          <label>
            تأكيد كلمة المرور
            <input
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              minLength={4}
              required
            />
          </label>
          {passwordError && <p className="error">{passwordError}</p>}
          {passwordMessage && <p className="muted">{passwordMessage}</p>}
          <button className="primary" disabled={busy}>
            {busy ? "جاري الحفظ…" : "حفظ كلمة المرور"}
          </button>
        </form>
      </div>

      <button className="secondary signout" onClick={signOut}>
        تسجيل الخروج <span>↗</span>
      </button>
    </>
  );
}
