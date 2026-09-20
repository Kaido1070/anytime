import { useEffect, useState, type FormEvent } from "react";
import { AvatarPicker } from "../components/AvatarPicker";
import { Icon } from "../components/UI";
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

export function Profile({
  embedded = false,
  hideIdentityEditor = false,
}: {
  embedded?: boolean;
  hideIdentityEditor?: boolean;
}) {
  const {
    user,
    signOut,
    setAvatar,
    setDisplayName,
    setProfileVisibility,
    changePassword,
  } = useLibrary();

  const [displayName, setDisplayNameValue] = useState(user?.name ?? "");
  const [nameEditing, setNameEditing] = useState(false);
  const [nameBusy, setNameBusy] = useState(false);
  const [nameMessage, setNameMessage] = useState("");
  const [nameError, setNameError] = useState("");

  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [avatarMessage, setAvatarMessage] = useState("");

  const [privacyBusy, setPrivacyBusy] = useState(false);
  const [privacyMessage, setPrivacyMessage] = useState("");
  const [privacyError, setPrivacyError] = useState("");

  const [passwordEditing, setPasswordEditing] = useState(false);
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
      setNameEditing(false);
      return;
    }

    setNameBusy(true);
    try {
      const updatedUser = await setDisplayName(normalized);
      setDisplayNameValue(updatedUser.name);
      setNameMessage("تم حفظ اسم العرض.");
      setNameEditing(false);
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
      setPasswordEditing(false);
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
      ? "يمكن للآخرين رؤية ملفك العام والمحتوى المسموح بعرضه."
      : "يظهر للآخرين الاسم والصورة واسم المستخدم والمفضلة فقط.";

  return (
    <>
      <div className={"settings-page settings-page-v2" + (embedded ? " embedded" : "")}>
        <header className="settings-heading settings-heading-v2">
          <p className="eyebrow">الحساب والأمان</p>
          <h2>الإعدادات</h2>
          <p className="muted">عدّل بيانات حسابك مباشرة من نفس الخانة.</p>
        </header>

        {!hideIdentityEditor && (
          <>
                    <section className="settings-profile-card" aria-label="بيانات الحساب">
                      <button
                        className="settings-avatar-edit"
                        type="button"
                        aria-label="تغيير الصورة الشخصية"
                        onClick={() => {
                          setAvatarMessage("");
                          setAvatarPickerOpen(true);
                        }}
                      >
                        <UserAvatar
                          user={user}
                          className="settings-avatar-preview settings-avatar-preview-v2"
                          loading="eager"
                        />
                        <span className="settings-avatar-pencil" aria-hidden="true">
                          <Icon name="edit" />
                        </span>
                      </button>
            
                      <div className="settings-profile-main">
                        <form className="settings-inline-form" onSubmit={submitDisplayName}>
                          <div className="settings-inline-label">
                            <span>اسم العرض</span>
                            {!nameEditing && (
                              <button
                                className="settings-edit-trigger"
                                type="button"
                                aria-label="تعديل اسم العرض"
                                onClick={() => {
                                  setNameMessage("");
                                  setNameError("");
                                  setNameEditing(true);
                                }}
                              >
                                <Icon name="edit" />
                              </button>
                            )}
                          </div>
            
                          {nameEditing ? (
                            <div className="settings-inline-editor">
                              <input
                                name="displayName"
                                type="text"
                                value={displayName}
                                maxLength={DISPLAY_NAME_MAX_LENGTH}
                                autoComplete="name"
                                disabled={nameBusy}
                                onChange={(event) => setDisplayNameValue(event.target.value)}
                                autoFocus
                                required
                              />
                              <button className="primary" type="submit" disabled={nameBusy}>
                                {nameBusy ? "حفظ…" : "حفظ"}
                              </button>
                              <button
                                className="secondary"
                                type="button"
                                disabled={nameBusy}
                                onClick={() => {
                                  setDisplayNameValue(user?.name ?? "");
                                  setNameError("");
                                  setNameEditing(false);
                                }}
                              >
                                إلغاء
                              </button>
                            </div>
                          ) : (
                            <strong className="settings-inline-value" dir="auto">
                              {user?.name ?? "—"}
                            </strong>
                          )}
            
                          {nameError && <p className="settings-feedback error" role="alert">{nameError}</p>}
                          {nameMessage && <p className="settings-feedback" role="status">{nameMessage}</p>}
                        </form>
            
                        <div className="settings-username-row">
                          <span>اسم المستخدم</span>
                          <b dir="ltr">@{user?.username ?? "—"}</b>
                        </div>
                      </div>
                    </section>
            
                    {avatarMessage && (
                      <p className="settings-feedback settings-standalone-feedback" role="status">
                        {avatarMessage}
                      </p>
                    )}
            
          </>
        )}

        <section className="settings-compact-card" aria-labelledby="settings-privacy-title">
          <div className="settings-compact-copy">
            <div>
              <p className="eyebrow">الخصوصية</p>
              <h3 id="settings-privacy-title">خصوصية الحساب</h3>
            </div>
            <p className="muted">{privacyBusy ? "جارٍ التحديث…" : privacyDescription}</p>
          </div>

          <div
            className="settings-choice-group settings-choice-group-v2"
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

          {privacyError && <p className="settings-feedback error" role="alert">{privacyError}</p>}
          {privacyMessage && <p className="settings-feedback" role="status">{privacyMessage}</p>}
        </section>

        <section className={"settings-compact-card settings-password-card" + (passwordEditing ? " editing" : "")}>
          <div className="settings-row-heading">
            <div>
              <p className="eyebrow">الأمان</p>
              <h3>كلمة المرور</h3>
              {!passwordEditing && <p className="muted">••••••••</p>}
            </div>
            <button
              className="settings-edit-trigger"
              type="button"
              aria-label={passwordEditing ? "إغلاق تعديل كلمة المرور" : "تعديل كلمة المرور"}
              onClick={() => {
                setPasswordError("");
                setPasswordMessage("");
                setPasswordEditing((value) => !value);
              }}
            >
              <Icon name="edit" />
            </button>
          </div>

          {passwordEditing && (
            <form className="settings-password-form" onSubmit={submitPassword}>
              <label>
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
              <label>
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
              <label>
                <span>تأكيد كلمة المرور</span>
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

              {passwordError && <p className="settings-feedback error" role="alert">{passwordError}</p>}
              {passwordMessage && <p className="settings-feedback" role="status">{passwordMessage}</p>}

              <div className="settings-password-actions">
                <button className="primary" type="submit" disabled={passwordBusy}>
                  {passwordBusy ? "جارٍ التحديث…" : "تحديث كلمة المرور"}
                </button>
                <button
                  className="secondary"
                  type="button"
                  disabled={passwordBusy}
                  onClick={() => setPasswordEditing(false)}
                >
                  إلغاء
                </button>
              </div>
            </form>
          )}

          {!passwordEditing && passwordMessage && (
            <p className="settings-feedback" role="status">{passwordMessage}</p>
          )}
        </section>

        <div className="settings-logout-simple">
          <button
            className="settings-logout-danger"
            type="button"
            disabled={logoutBusy}
            onClick={() => void handleSignOut()}
          >
            {logoutBusy ? "جارٍ تسجيل الخروج…" : "تسجيل الخروج"}
          </button>
          {logoutError && <p className="settings-feedback error" role="alert">{logoutError}</p>}
        </div>
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
