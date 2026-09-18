import { useEffect, useState, type FormEvent } from "react";
import { AvatarPicker } from "../components/AvatarPicker";
import { UserAvatar } from "../components/UserAvatar";
import { useLibrary } from "../hooks/useLibrary";

const DISPLAY_NAME_MAX_LENGTH = 50;
const PASSWORD_MAX_LENGTH = 128;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function normalizeDisplayName(value: string) {
  const trimmed = value.trim();
  if (
    !trimmed ||
    trimmed.length > DISPLAY_NAME_MAX_LENGTH ||
    CONTROL_CHARACTERS.test(trimmed)
  ) {
    return null;
  }
  return trimmed;
}

export function Profile({ embedded = false }: { embedded?: boolean }) {
  const {
    user,
    signOut,
    setAvatar,
    setDisplayName,
    setProfileVisibility,
    changePassword,
  } = useLibrary();

  const [displayName, setDisplayNameValue] = useState(user?.name ?? "");
  const [nameBusy, setNameBusy] = useState(false);
  const [nameMessage, setNameMessage] = useState("");
  const [nameError, setNameError] = useState("");

  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [avatarMessage, setAvatarMessage] = useState("");

  const [privacyBusy, setPrivacyBusy] = useState(false);
  const [privacyMessage, setPrivacyMessage] = useState("");
  const [privacyError, setPrivacyError] = useState("");

  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordError, setPasswordError] = useState("");

  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutError, setLogoutError] = useState("");

  useEffect(() => {
    setDisplayNameValue(user?.name ?? "");
  }, [user?.name]);

  async function submitDisplayName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (nameBusy) return;

    setNameMessage("");
    setNameError("");

    const normalized = normalizeDisplayName(displayName);
    if (!normalized) {
      setNameError("اسم العرض مطلوب ويجب ألا يتجاوز 50 حرفًا.");
      return;
    }

    if (normalized === user?.name) {
      setDisplayNameValue(normalized);
      setNameMessage("لا توجد تغييرات للحفظ.");
      return;
    }

    setNameBusy(true);
    try {
      const updatedUser = await setDisplayName(normalized);
      setDisplayNameValue(updatedUser.name);
      setNameMessage("تم حفظ اسم العرض.");
    } catch (cause) {
      setNameError(
        cause instanceof Error ? cause.message : "تعذر حفظ اسم العرض.",
      );
    } finally {
      setNameBusy(false);
    }
  }

  async function changeVisibility(visibility: "public" | "private") {
    if (privacyBusy || user?.profileVisibility === visibility) return;

    setPrivacyBusy(true);
    setPrivacyMessage("");
    setPrivacyError("");

    try {
      await setProfileVisibility(visibility);
      setPrivacyMessage(
        visibility === "public"
          ? "أصبح حسابك عامًا."
          : "أصبح حسابك خاصًا.",
      );
    } catch (cause) {
      setPrivacyError(
        cause instanceof Error ? cause.message : "تعذر تحديث خصوصية الحساب.",
      );
    } finally {
      setPrivacyBusy(false);
    }
  }

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (passwordBusy) return;

    setPasswordMessage("");
    setPasswordError("");

    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const currentPassword = String(form.get("currentPassword") ?? "");
    const newPassword = String(form.get("newPassword") ?? "");
    const confirmPassword = String(form.get("confirmPassword") ?? "");

    if (newPassword !== confirmPassword) {
      setPasswordError("كلمتا المرور الجديدتان غير متطابقتين.");
      return;
    }

    if (newPassword.length < 4 || newPassword.length > PASSWORD_MAX_LENGTH) {
      setPasswordError("كلمة المرور الجديدة لازم تكون 4 أحرف أو أكثر.");
      return;
    }

    setPasswordBusy(true);
    try {
      await changePassword(currentPassword, newPassword);
      formElement.reset();
      setPasswordMessage("تم تحديث كلمة المرور.");
    } catch (cause) {
      setPasswordError(
        cause instanceof Error ? cause.message : "تعذر تغيير كلمة المرور.",
      );
    } finally {
      setPasswordBusy(false);
    }
  }

  async function handleSignOut() {
    if (logoutBusy) return;
    setLogoutBusy(true);
    setLogoutError("");
    try {
      await signOut();
    } catch (cause) {
      setLogoutError(
        cause instanceof Error ? cause.message : "تعذر تسجيل الخروج الآن.",
      );
      setLogoutBusy(false);
    }
  }

  const privacyDescription =
    user?.profileVisibility === "public"
      ? "يمكن للمستخدمين الآخرين رؤية ملفك العام، مكتبتك، قوائمك، أصدقائك وتقدم القراءة المسموح بعرضه."
      : "سيظهر للآخرين اسمك وصورتك واسم المستخدم وحالة الحساب والمفضلة فقط.";

  return (
    <>
      <div className={"settings-page" + (embedded ? " embedded" : "")}>
        <header className="settings-heading">
          <p className="eyebrow">الحساب والأمان</p>
          <h2>الإعدادات</h2>
          <p className="muted">
            إدارة بيانات حسابك وخصوصيته وأمانه من مكان واحد.
          </p>
        </header>

        <section className="settings-card" aria-labelledby="settings-account-title">
          <div className="settings-card-header">
            <div>
              <p className="eyebrow">الحساب</p>
              <h3 id="settings-account-title">بيانات الحساب</h3>
            </div>
          </div>

          <form className="settings-form" onSubmit={submitDisplayName}>
            <label className="settings-field">
              <span>اسم العرض</span>
              <input
                name="displayName"
                type="text"
                value={displayName}
                maxLength={DISPLAY_NAME_MAX_LENGTH}
                autoComplete="name"
                disabled={nameBusy}
                onChange={(event) => setDisplayNameValue(event.target.value)}
                required
              />
              <small>يظهر هذا الاسم في حسابك ولدى أصدقائك.</small>
            </label>

            <div className="settings-readonly" aria-label="اسم المستخدم">
              <span>اسم المستخدم</span>
              <b dir="ltr">@{user?.username ?? "—"}</b>
              <small>غير قابل للتعديل حاليًا.</small>
            </div>

            {nameError && (
              <p className="settings-feedback error" role="alert">
                {nameError}
              </p>
            )}
            {nameMessage && (
              <p className="settings-feedback" role="status" aria-live="polite">
                {nameMessage}
              </p>
            )}

            <div className="settings-actions">
              <button className="primary" type="submit" disabled={nameBusy}>
                {nameBusy ? "جارٍ الحفظ…" : "حفظ اسم العرض"}
              </button>
            </div>
          </form>
        </section>

        <section className="settings-card" aria-labelledby="settings-avatar-title">
          <div className="settings-card-header">
            <div>
              <p className="eyebrow">الصورة الشخصية</p>
              <h3 id="settings-avatar-title">Avatar</h3>
            </div>
          </div>

          <div className="settings-avatar-row">
            <UserAvatar
              user={user}
              className="settings-avatar-preview"
              loading="eager"
            />
            <div className="settings-avatar-copy">
              <b>الصورة الحالية</b>
              <span className="muted">
                الاختيار فقط من مكتبة Wany. لا يوجد رفع صور من الجهاز.
              </span>
            </div>
            <button
              className="secondary"
              type="button"
              onClick={() => {
                setAvatarMessage("");
                setAvatarPickerOpen(true);
              }}
            >
              تغيير الصورة
            </button>
          </div>

          {avatarMessage && (
            <p className="settings-feedback" role="status" aria-live="polite">
              {avatarMessage}
            </p>
          )}
        </section>

        <section className="settings-card" aria-labelledby="settings-privacy-title">
          <div className="settings-card-header">
            <div>
              <p className="eyebrow">الخصوصية</p>
              <h3 id="settings-privacy-title">خصوصية الحساب</h3>
            </div>
          </div>

          <div
            className="settings-choice-group"
            role="group"
            aria-label="خصوصية الحساب"
          >
            <button
              type="button"
              className={user?.profileVisibility === "public" ? "active" : ""}
              aria-pressed={user?.profileVisibility === "public"}
              disabled={privacyBusy}
              onClick={() => void changeVisibility("public")}
            >
              عام
            </button>
            <button
              type="button"
              className={user?.profileVisibility !== "public" ? "active" : ""}
              aria-pressed={user?.profileVisibility !== "public"}
              disabled={privacyBusy}
              onClick={() => void changeVisibility("private")}
            >
              خاص
            </button>
          </div>

          <p className="settings-privacy-description muted">
            {privacyBusy ? "جارٍ تحديث الخصوصية…" : privacyDescription}
          </p>

          {privacyError && (
            <p className="settings-feedback error" role="alert">
              {privacyError}
            </p>
          )}
          {privacyMessage && (
            <p className="settings-feedback" role="status" aria-live="polite">
              {privacyMessage}
            </p>
          )}
        </section>

        <section className="settings-card" aria-labelledby="settings-security-title">
          <div className="settings-card-header">
            <div>
              <p className="eyebrow">الأمان</p>
              <h3 id="settings-security-title">تغيير كلمة المرور</h3>
            </div>
          </div>

          <form className="settings-form" onSubmit={submitPassword}>
            <label className="settings-field">
              <span>كلمة المرور الحالية</span>
              <input
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                maxLength={PASSWORD_MAX_LENGTH}
                disabled={passwordBusy}
                required
              />
            </label>

            <label className="settings-field">
              <span>كلمة المرور الجديدة</span>
              <input
                name="newPassword"
                type="password"
                autoComplete="new-password"
                minLength={4}
                maxLength={PASSWORD_MAX_LENGTH}
                disabled={passwordBusy}
                required
              />
            </label>

            <label className="settings-field">
              <span>تأكيد كلمة المرور الجديدة</span>
              <input
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                minLength={4}
                maxLength={PASSWORD_MAX_LENGTH}
                disabled={passwordBusy}
                required
              />
            </label>

            {passwordError && (
              <p className="settings-feedback error" role="alert">
                {passwordError}
              </p>
            )}
            {passwordMessage && (
              <p className="settings-feedback" role="status" aria-live="polite">
                {passwordMessage}
              </p>
            )}

            <div className="settings-actions">
              <button className="primary" type="submit" disabled={passwordBusy}>
                {passwordBusy ? "جارٍ التحديث…" : "تحديث كلمة المرور"}
              </button>
            </div>
          </form>
        </section>

        <section
          className="settings-card settings-session-card"
          aria-labelledby="settings-session-title"
        >
          <div className="settings-card-header">
            <div>
              <p className="eyebrow">الجلسة</p>
              <h3 id="settings-session-title">تسجيل الخروج</h3>
            </div>
          </div>

          <p className="muted">
            ينهي هذا الإجراء الجلسة الحالية ويعيدك إلى شاشة تسجيل الدخول.
          </p>

          {logoutError && (
            <p className="settings-feedback error" role="alert">
              {logoutError}
            </p>
          )}

          <button
            className="secondary settings-logout"
            type="button"
            disabled={logoutBusy}
            onClick={() => void handleSignOut()}
          >
            {logoutBusy ? "جارٍ تسجيل الخروج…" : "تسجيل الخروج"}
          </button>
        </section>
      </div>

      {avatarPickerOpen && (
        <AvatarPicker
          currentAvatarId={user?.avatarId ?? null}
          onSave={async (avatarId) => {
            await setAvatar(avatarId);
            setAvatarMessage("تم تحديث الصورة الشخصية.");
          }}
          onClose={() => setAvatarPickerOpen(false)}
        />
      )}
    </>
  );
}
