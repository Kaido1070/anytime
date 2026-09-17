import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { SourceCard } from "../components/SourceCard";
import { SourceCoverImage } from "../components/SourceCoverImage";
import { Progress, SectionTitle } from "../components/UI";
import { useLibrary } from "../hooks/useLibrary";
import { mergeSourceItems } from "../services/sourceMerge";
import { sourceService } from "../services/sources";
import type { ReadingProgress, SourceManga } from "../types";

export function Profile() {
  const {
    user,
    data,
    profilePrivate,
    setProfilePrivate,
    signOut,
    changePassword,
  } = useLibrary();
  const [sourceItems, setSourceItems] = useState<Record<string, SourceManga>>({});
  const [privacyBusy, setPrivacyBusy] = useState(false);
  const [privacyError, setPrivacyError] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [busy, setBusy] = useState(false);

  const history = useMemo(() => {
    const latest = new Map<string, ReadingProgress>();
    for (const progress of Object.values(data?.progress ?? {})) {
      if (!sourceService.isSourceKey(progress.mangaId)) continue;
      const current = latest.get(progress.mangaId);
      if (!current || progress.updatedAt > current.updatedAt) {
        latest.set(progress.mangaId, progress);
      }
    }
    return [...latest.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [data?.progress]);

  const sourceKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const id of data?.favorites ?? []) {
      if (sourceService.isSourceKey(id)) keys.add(id);
    }
    for (const progress of history) keys.add(progress.mangaId);
    return [...keys];
  }, [data?.favorites, history]);

  useEffect(() => {
    let active = true;
    if (!sourceKeys.length) {
      setSourceItems({});
      return;
    }
    sourceService
      .resolve(sourceKeys)
      .then((items) => {
        if (active) setSourceItems(Object.fromEntries(items.map((item) => [item.key, item])));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [sourceKeys.join("|")]);

  const favoriteItems = (data?.favorites ?? [])
    .filter((id) => sourceService.isSourceKey(id))
    .map((id) => sourceItems[id])
    .filter((item): item is SourceManga => Boolean(item));
  const favoriteGroups = mergeSourceItems(favoriteItems);
  const favorites = favoriteGroups.length;
  const completedChapters = (data?.completed ?? []).filter((key) =>
    /^(?:mt|tx|aq):/.test(key),
  ).length;

  async function changeVisibility(nextPrivate: boolean) {
    if (nextPrivate === profilePrivate || privacyBusy) return;
    setPrivacyBusy(true);
    setPrivacyError("");
    try {
      await setProfilePrivate(nextPrivate);
    } catch (cause) {
      setPrivacyError(cause instanceof Error ? cause.message : "تعذر تغيير خصوصية الحساب.");
    } finally {
      setPrivacyBusy(false);
    }
  }

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
      <p className="eyebrow">حسابك في ANYTIME</p>
      <h1>
        حسابي<span className="accent">.</span>
      </h1>

      <div className="profile-heading">
        <span className="avatar profile-avatar">{user?.name[0]}</span>
        <h2>{user?.name}</h2>
        <p className="muted">@{user?.username}</p>
        <span className="profile-visibility-badge">{profilePrivate ? "خاص" : "عام"}</span>
      </div>

      <div className="stats profile-stats">
        <div>
          <strong>{favorites}</strong>
          <span>المفضلة</span>
        </div>
        <div>
          <strong>{history.length}</strong>
          <span>تابعتها</span>
        </div>
        <div>
          <strong>{completedChapters}</strong>
          <span>فصول مكتملة</span>
        </div>
      </div>

      <section className="profile-privacy-card">
        <div className="profile-privacy-copy">
          <p className="eyebrow">خصوصية الملف</p>
          <h2>{profilePrivate ? "حسابك خاص" : "حسابك عام"}</h2>
          <p className="muted">
            {profilePrivate
              ? "الآخرون يشوفون مفضلتك فقط. تقدم القراءة وسجل المتابعة مخفي."
              : "أصدقاؤك يشوفون مفضلتك والأعمال اللي تابعتها وآخر فصل وقفت عنده."}
          </p>
        </div>
        <div className="privacy-toggle" aria-label="خصوصية الملف">
          <button
            type="button"
            className={!profilePrivate ? "active" : ""}
            aria-pressed={!profilePrivate}
            disabled={privacyBusy}
            onClick={() => void changeVisibility(false)}
          >
            عام
          </button>
          <button
            type="button"
            className={profilePrivate ? "active" : ""}
            aria-pressed={profilePrivate}
            disabled={privacyBusy}
            onClick={() => void changeVisibility(true)}
          >
            خاص
          </button>
        </div>
        {privacyError && <p className="error">{privacyError}</p>}
      </section>

      <section className="profile-library-section">
        <SectionTitle title="متابعتك" />
        <div className="profile-reading-list">
          {history.map((progress) => {
            const item = sourceItems[progress.mangaId];
            if (!item) return null;
            return (
              <Link
                className="profile-reading-row"
                key={progress.mangaId}
                to={`/source/${encodeURIComponent(item.key)}`}
              >
                <div className="profile-reading-cover">
                  {item.cover ? (
                    <SourceCoverImage item={item} alt={`غلاف ${item.title}`} />
                  ) : (
                    <div className="source-cover-placeholder">{item.title.slice(0, 1)}</div>
                  )}
                </div>
                <div className="profile-reading-copy">
                  <div className="profile-reading-title">
                    <div>
                      <small>{sourceService.sourceLabel(item.source)}</small>
                      <h3 dir="auto">{item.title}</h3>
                    </div>
                    <b>{Math.round(progress.percent)}%</b>
                  </div>
                  <p>وقفت عند الفصل {progress.chapter}</p>
                  <Progress value={progress.percent} />
                </div>
                <span className="profile-row-arrow">←</span>
              </Link>
            );
          })}
        </div>
        {!history.length && <p className="empty">لما تبدأ قراءة عمل بيظهر هنا مع آخر فصل وقفت عنده.</p>}
      </section>

      <section className="profile-library-section">
        <SectionTitle title="المفضلة" to="/favorites" label="عرض الكل" />
        <div className="cover-grid profile-favorites-grid">
          {favoriteGroups.slice(0, 6).map((group) => (
            <SourceCard key={group.id} item={group.primary} sources={group.items} />
          ))}
        </div>
        {!favoriteGroups.length && <p className="empty">مفضلتك فارغة حاليا.</p>}
      </section>

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

      <div className="login-form profile-security">
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
