import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { SourceCoverImage } from "../components/SourceCoverImage";
import { UserAvatar } from "../components/UserAvatar";
import { sourceDisplayTitle } from "../services/sourceTitles";
import { sourceService, type SourceDiagnostic } from "../services/sources";
import { userDataService } from "../services/userData";
import type {
  ActivityEvent,
  AdminUserDetail as AdminUserDetailType,
  AdminUserSummary,
  LibraryEntry,
  SourceManga,
} from "../types";

const HISTORY_PAGE_SIZE = 50;

function formatDate(value: number | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function chapterLabel(value: number | null | undefined) {
  if (value == null) return "—";
  return Number.isInteger(value) ? String(value) : String(value).replace(/\.0+$/, "");
}

function useSourceItems(keys: string[]) {
  const [items, setItems] = useState<Record<string, SourceManga>>({});
  const signature = keys.join("|");

  useEffect(() => {
    let active = true;
    if (!keys.length) {
      setItems({});
      return;
    }
    sourceService
      .resolve(keys)
      .then((resolved) => {
        if (active) setItems(Object.fromEntries(resolved.map((item) => [item.key, item])));
      })
      .catch(() => {
        if (active) setItems({});
      });
    return () => {
      active = false;
    };
  }, [signature]);

  return items;
}

function WorkIdentity({
  mangaId,
  works,
  cover = false,
}: {
  mangaId: string;
  works: Record<string, SourceManga>;
  cover?: boolean;
}) {
  const item = works[mangaId];
  const title = item ? sourceDisplayTitle(item) : mangaId;
  return (
    <span className="admin-work-identity">
      {cover && (
        <span className="admin-work-cover">
          {item?.cover ? (
            <SourceCoverImage item={item} alt="" loading="lazy" />
          ) : (
            <span className="source-cover-placeholder">{title.slice(0, 1)}</span>
          )}
        </span>
      )}
      <span dir="auto">{title}</span>
    </span>
  );
}

function eventLabel(event: ActivityEvent, works: Record<string, SourceManga>) {
  const item = event.mangaId ? works[event.mangaId] : null;
  const work = item ? sourceDisplayTitle(item) : event.mangaId ?? "";
  switch (event.type) {
    case "started_work":
      return `بدأ قراءة ${work}`;
    case "progress_reached":
      return `وصل إلى الفصل ${chapterLabel(event.chapterNumber)} من ${work}`;
    case "completed_work":
      return `أنهى ${work}`;
    case "favorited_work":
      return `أضاف ${work} إلى المفضلة`;
    case "added_to_list":
      return `أضاف ${work} إلى قائمة ${event.list?.name ?? "شخصية"}`;
    case "created_list":
      return `أنشأ قائمة ${event.list?.name ?? "جديدة"}`;
  }
}

export function AdminDashboard() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sourceDiagnostics, setSourceDiagnostics] = useState<SourceDiagnostic[]>([]);
  const [sourceDiagnosticsError, setSourceDiagnosticsError] = useState("");
  const query = searchParams.get("q") ?? "";
  const visibility = searchParams.get("visibility") ?? "all";
  const sort = searchParams.get("sort") ?? "activity";
  const status = searchParams.get("status") ?? "all";
  const [draft, setDraft] = useState(query);

  useEffect(() => setDraft(query), [query]);

  useEffect(() => {
    let active = true;
    setSourceDiagnosticsError("");
    sourceService
      .status()
      .then((rows) => {
        if (active) setSourceDiagnostics(rows);
      })
      .catch((cause) => {
        if (active) {
          setSourceDiagnosticsError(
            cause instanceof Error ? cause.message : "تعذر تحميل حالة المصادر.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    userDataService
      .getAdminUsers({ query, visibility, sort, status, limit: 100, offset: 0 })
      .then((result) => {
        if (!active) return;
        setUsers(result.users);
        setTotal(result.total);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "تعذر تحميل الحسابات.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [query, visibility, sort, status]);

  const works = useSourceItems(
    useMemo(
      () => [...new Set(users.flatMap((item) => (item.lastRead ? [item.lastRead.mangaId] : [])))],
      [users],
    ),
  );

  function updateParam(name: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (!value || value === "all" || (name === "sort" && value === "activity")) next.delete(name);
    else next.set(name, value);
    setSearchParams(next, { replace: true });
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    updateParam("q", draft.trim());
  }

  return (
    <section className="admin-dashboard">
      <header className="admin-title-row">
        <div>
          <p className="eyebrow">لوحة الإدارة</p>
          <h1>الحسابات<span className="accent">.</span></h1>
          <p className="muted">متابعة المكتبات وتقدم القراءة بدون الدخول إلى كل حساب.</p>
        </div>
        <div className="admin-total"><b>{total}</b><span>حساب</span></div>
      </header>

      <section className="admin-source-health" aria-labelledby="admin-source-health-title">
        <div className="admin-source-health-heading">
          <div>
            <p className="eyebrow">المصادر</p>
            <h2 id="admin-source-health-title">حالة التحديث</h2>
          </div>
          <small>قراءة فقط · بدون عمليات كتابة إضافية على D1</small>
        </div>
        {sourceDiagnosticsError ? (
          <p className="error" role="alert">{sourceDiagnosticsError}</p>
        ) : sourceDiagnostics.length ? (
          <div className="admin-source-health-grid">
            {sourceDiagnostics.map((row) => {
              const published = row.lastVerifiedReleaseAt
                ? Date.parse(row.lastVerifiedReleaseAt)
                : NaN;
              return (
                <article key={row.source}>
                  <header>
                    <b>{sourceService.sourceLabel(row.source)}</b>
                    <span>{row.recent24h} خلال 24س</span>
                  </header>
                  <p>
                    <span>آخر إصدار موثق</span>
                    <b>{Number.isFinite(published) ? formatDate(published) : "—"}</b>
                  </p>
                  <p>
                    <span>آخر مزامنة خلفية</span>
                    <b>{formatDate(row.lastSyncAt)}</b>
                  </p>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="empty">جاري تحميل حالة المصادر…</p>
        )}
      </section>

      <div className="admin-toolbar">
        <form className="admin-search" onSubmit={submitSearch}>
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="بحث باسم المستخدم أو اسم العرض"
            aria-label="بحث الحسابات"
          />
          <button className="secondary" type="submit">بحث</button>
        </form>
        <div className="admin-filters">
          <select value={visibility} onChange={(event) => updateParam("visibility", event.target.value)}>
            <option value="all">الكل</option>
            <option value="public">عام</option>
            <option value="private">خاص</option>
          </select>
          <select value={status} onChange={(event) => updateParam("status", event.target.value)}>
            <option value="all">كل الحالات</option>
            <option value="reading">يقرأ حاليًا</option>
          </select>
          <select value={sort} onChange={(event) => updateParam("sort", event.target.value)}>
            <option value="activity">آخر نشاط</option>
            <option value="username">اسم المستخدم</option>
            <option value="works">عدد القصص</option>
            <option value="chapters">الفصول المقروءة</option>
          </select>
        </div>
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      {loading ? (
        <p className="empty">جاري تحميل الحسابات…</p>
      ) : users.length ? (
        <div className="admin-users-table-wrap">
          <table className="admin-users-table">
            <thead>
              <tr>
                <th>الحساب</th><th>الفصول المقروءة</th><th>القصص</th><th>القوائم</th>
                <th>الأصدقاء</th><th>الخصوصية</th><th>آخر قراءة</th>
              </tr>
            </thead>
            <tbody>
              {users.map((item) => (
                <tr key={item.user.id}>
                  <td data-label="الحساب">
                    <Link className="admin-user-link" to={`/admin/users/${encodeURIComponent(item.user.id)}`}>
                      <UserAvatar user={item.user} />
                      <span><b>{item.user.name}</b><small>@{item.user.username}</small></span>
                    </Link>
                  </td>
                  <td data-label="الفصول المقروءة" className="admin-chapters-read"><b>{item.chaptersReadCount}</b><span>فصل</span></td>
                  <td data-label="القصص">{item.worksCount}</td>
                  <td data-label="القوائم">{item.listsCount}</td>
                  <td data-label="الأصدقاء">{item.friendsCount}</td>
                  <td data-label="الخصوصية"><span className="admin-pill">{item.user.profileVisibility === "public" ? "عام" : "خاص"}</span></td>
                  <td data-label="آخر قراءة">
                    {item.lastRead ? (
                      <div className="admin-last-read">
                        <WorkIdentity mangaId={item.lastRead.mangaId} works={works} />
                        <small>الفصل {chapterLabel(item.lastRead.lastReadChapter)} · {formatDate(item.lastRead.lastReadAt)}</small>
                      </div>
                    ) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="empty">لا توجد حسابات مطابقة.</p>}
    </section>
  );
}

const statusLabels: Record<LibraryEntry["status"], string> = {
  reading: "يقرأ",
  completed: "مكتمل",
  paused: "متوقف",
  planned: "لاحقًا",
};

export function AdminUserDetail() {
  const { id = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") ?? "overview";
  const historyOffset = Math.max(0, Number(searchParams.get("historyOffset") ?? 0) || 0);
  const [detail, setDetail] = useState<AdminUserDetailType | null>(null);
  const [securityQuestion, setSecurityQuestion] = useState<string | null>(null);
  const [recoveryLocked, setRecoveryLocked] = useState(false);
  const [failedAnswers, setFailedAnswers] = useState(0);
  const [securityBusy, setSecurityBusy] = useState(false);
  const [securityMessage, setSecurityMessage] = useState("");
  const [resetEditing, setResetEditing] = useState(false);
  const [unlockEditing, setUnlockEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    userDataService
      .getAdminUser(id, HISTORY_PAGE_SIZE, historyOffset)
      .then((value) => {
        if (active) setDetail(value);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "تعذر تحميل الحساب.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id, historyOffset]);

  useEffect(() => {
    let active = true;
    setSecurityQuestion(null);
    setRecoveryLocked(false);
    setFailedAnswers(0);
    setSecurityMessage("");
    setResetEditing(false);
    setUnlockEditing(false);
    userDataService.getAdminSecurityQuestion(id).then(value => { if (active) { setSecurityQuestion(value.question); setRecoveryLocked(value.recoveryLocked); setFailedAnswers(value.failedAnswers); } })
      .catch(() => { if (active) setSecurityMessage("تعذر تحميل سؤال الأمان."); });
    return () => { active = false; };
  }, [id]);

  async function resetPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const password = String(data.get("newPassword") ?? "");
    if (password !== data.get("confirmPassword")) { setSecurityMessage("كلمتا المرور غير متطابقتين."); return; }
    setSecurityBusy(true);
    setSecurityMessage("");
    try {
      await userDataService.adminResetPassword(id, String(data.get("currentPassword") ?? ""), password);
      form.reset();
      setRecoveryLocked(false);
      setFailedAnswers(0);
      setResetEditing(false);
      setSecurityQuestion(null);
      setSecurityMessage("تم تغيير كلمة المرور وإبطال الجلسات ورموز الاستعادة وسؤال الأمان القديم. يستطيع المستخدم إعداد سؤال جديد بعد الدخول.");
    } catch (cause) { setSecurityMessage(cause instanceof Error ? cause.message : "تعذر تغيير كلمة المرور."); }
    finally { setSecurityBusy(false); }
  }

  async function unlockRecovery(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setSecurityBusy(true);
    setSecurityMessage("");
    try {
      await userDataService.adminUnlockRecovery(id, String(data.get("currentPassword") ?? ""));
      form.reset();
      setRecoveryLocked(false);
      setFailedAnswers(0);
      setUnlockEditing(false);
      setSecurityMessage("تم فتح قفل الاستعادة. سؤال الأمان وكلمة المرور لم يتغيرا.");
    } catch (cause) { setSecurityMessage(cause instanceof Error ? cause.message : "تعذر فتح قفل الاستعادة."); }
    finally { setSecurityBusy(false); }
  }

  const workKeys = useMemo(() => {
    if (!detail) return [];
    return [...new Set([
      ...detail.library.map((item) => item.mangaId),
      ...detail.readingHistory.map((item) => item.mangaId),
      ...detail.favorites,
      ...detail.lists.flatMap((list) => list.items.map((item) => item.mangaId)),
      ...detail.activity.flatMap((event) => (event.mangaId ? [event.mangaId] : [])),
    ])];
  }, [detail]);
  const works = useSourceItems(workKeys);

  function setTab(nextTab: string) {
    const next = new URLSearchParams(searchParams);
    if (nextTab === "overview") next.delete("tab");
    else next.set("tab", nextTab);
    next.delete("historyOffset");
    setSearchParams(next, { replace: true });
  }

  function setHistoryOffset(nextOffset: number) {
    const next = new URLSearchParams(searchParams);
    next.set("tab", "history");
    if (nextOffset > 0) next.set("historyOffset", String(nextOffset));
    else next.delete("historyOffset");
    setSearchParams(next, { replace: true });
  }

  if (loading && !detail) return <p className="empty">جاري تحميل بيانات الحساب…</p>;
  if (error && !detail) {
    return <section className="admin-dashboard"><Link className="back" to="/admin">رجوع إلى الحسابات</Link><p className="error" role="alert">{error}</p></section>;
  }
  if (!detail) return null;

  const tabs = [
    ["overview", "نظرة عامة"], ["library", "المكتبة"], ["history", "سجل القراءة"],
    ["lists", "القوائم"], ["favorites", "المفضلة"], ["friends", "الأصدقاء"], ["activity", "النشاط"],
  ] as const;

  return (
    <section className="admin-user-detail">
      <Link className="back" to="/admin">رجوع إلى الحسابات</Link>
      <header className="admin-user-hero">
        <UserAvatar user={detail.user} className="large" loading="eager" />
        <div>
          <p className="eyebrow">حساب مستخدم</p>
          <h1>{detail.user.name}<span className="accent">.</span></h1>
          <p className="muted">@{detail.user.username} · {detail.user.profileVisibility === "public" ? "عام" : "خاص"}</p>
        </div>
      </header>

      <section className="settings-card">
        <h2>أمان الحساب</h2>
        <p>سؤال الأمان: {securityQuestion ?? "لم يُحفظ سؤال أمان"}</p>
        <p>الاستعادة: {recoveryLocked ? "مقفلة بعد 5 إجابات خاطئة" : `غير مقفلة · ${failedAnswers} من 5 إجابات خاطئة`}</p>
        <p className="muted">كلمات المرور وإجابات الأمان لا تُعرض. إعادة التعيين تُبطل سؤال الأمان والرموز القديمة وتُخرج المستخدم من جميع الأجهزة.</p>
        {recoveryLocked && <>
          <button type="button" className="secondary" disabled={securityBusy} onClick={() => { setUnlockEditing(!unlockEditing); setResetEditing(false); }}>فتح قفل الاستعادة فقط</button>
          {unlockEditing && <form onSubmit={unlockRecovery}>
            <p>يبقى جواب الأمان القديم صالحًا. إذا انكشف الجواب، استخدم إعادة تعيين كلمة المرور وإبطال الاستعادة القديمة.</p>
            <label>كلمة مرور الأدمن الحالية<input name="currentPassword" type="password" required maxLength={128} autoComplete="current-password" /></label>
            <button disabled={securityBusy}>{securityBusy ? "جارٍ الفتح…" : "فتح القفل"}</button>
          </form>}
        </>}
        <button type="button" className="secondary" disabled={securityBusy} onClick={() => { setResetEditing(!resetEditing); setUnlockEditing(false); }}>إعادة تعيين كلمة المرور وإبطال الاستعادة القديمة</button>
        {resetEditing && <form onSubmit={resetPassword}>
          <label>كلمة مرور الأدمن الحالية<input name="currentPassword" type="password" required maxLength={128} autoComplete="current-password" /></label>
          <label>كلمة مرور المستخدم الجديدة<input name="newPassword" type="password" required minLength={6} maxLength={128} autoComplete="new-password" /></label>
          <label>تأكيد كلمة المرور الجديدة<input name="confirmPassword" type="password" required minLength={6} maxLength={128} autoComplete="new-password" /></label>
          <button disabled={securityBusy}>{securityBusy ? "جارٍ الحفظ…" : "حفظ كلمة المرور الجديدة"}</button>
        </form>}
        {securityMessage && <p role="status">{securityMessage}</p>}
      </section>

      <nav className="admin-tabs" aria-label="أقسام الحساب">
        {tabs.map(([key, label]) => (
          <button type="button" className={tab === key ? "active" : ""} onClick={() => setTab(key)} key={key}>{label}</button>
        ))}
      </nav>

      {error && <p className="error" role="alert">{error}</p>}

      {tab === "overview" && (
        <div className="admin-overview-grid">
          <article><span>القصص</span><b>{detail.stats.works}</b></article>
          <article><span>القوائم</span><b>{detail.stats.lists}</b></article>
          <article><span>الأصدقاء</span><b>{detail.stats.friends}</b></article>
          <article><span>سجل القراءة</span><b>{detail.readingHistoryTotal}</b></article>
          <article className="wide"><span>تاريخ إنشاء الحساب</span><b>{formatDate(detail.createdAt)}</b></article>
          <article className="wide"><span>آخر نشاط</span><b>{formatDate(detail.lastActivityAt)}</b></article>
        </div>
      )}

      {tab === "library" && (
        <div className="admin-library-grid">
          {detail.library.length ? detail.library.map((entry) => (
            <article className="admin-library-card" key={entry.mangaId}>
              <WorkIdentity mangaId={entry.mangaId} works={works} cover />
              <div className="admin-library-meta">
                <span className="admin-pill">{statusLabels[entry.status]}</span>
                <p><span>وصل إلى</span><b>{chapterLabel(entry.highestReachedChapter)}</b></p>
                <p><span>آخر فصل فتحه</span><b>{chapterLabel(entry.lastReadChapter)}</b></p>
                <p><span>آخر قراءة</span><b>{formatDate(entry.lastReadAt)}</b></p>
              </div>
            </article>
          )) : <p className="empty">المكتبة فارغة.</p>}
        </div>
      )}

      {tab === "history" && (
        <section className="admin-history">
          {detail.readingHistory.length ? detail.readingHistory.map((item) => (
            <article key={item.id}>
              <WorkIdentity mangaId={item.mangaId} works={works} />
              <span>الفصل {chapterLabel(item.chapter)}</span>
              <time dateTime={new Date(item.readAt).toISOString()}>{formatDate(item.readAt)}</time>
            </article>
          )) : <p className="empty">لا يوجد سجل قراءة.</p>}
          <div className="admin-pagination">
            <button className="secondary" type="button" disabled={historyOffset === 0} onClick={() => setHistoryOffset(Math.max(0, historyOffset - HISTORY_PAGE_SIZE))}>السابق</button>
            <span>{historyOffset + 1}–{Math.min(historyOffset + detail.readingHistory.length, detail.readingHistoryTotal)} من {detail.readingHistoryTotal}</span>
            <button className="secondary" type="button" disabled={!detail.readingHistoryHasMore} onClick={() => setHistoryOffset(historyOffset + HISTORY_PAGE_SIZE)}>التالي</button>
          </div>
        </section>
      )}

      {tab === "lists" && (
        <div className="admin-lists">
          {detail.lists.length ? detail.lists.map((list) => (
            <article className="admin-list-card" key={list.id}>
              <header><div><h2>{list.name}</h2>{list.description && <p className="muted">{list.description}</p>}</div><span>{list.itemCount} قصص</span></header>
              <ol>{list.items.map((item) => <li key={item.mangaId}><WorkIdentity mangaId={item.mangaId} works={works} /></li>)}</ol>
            </article>
          )) : <p className="empty">لا توجد قوائم.</p>}
        </div>
      )}

      {tab === "favorites" && (
        <div className="admin-favorites-grid">
          {detail.favorites.length ? detail.favorites.map((mangaId) => <WorkIdentity mangaId={mangaId} works={works} cover key={mangaId} />) : <p className="empty">لا توجد مفضلة.</p>}
        </div>
      )}

      {tab === "friends" && (
        <div className="admin-friends-list">
          {detail.friends.length ? detail.friends.map((friend) => (
            <article key={friend.id}><UserAvatar user={friend} /><span><b>{friend.name}</b><small>@{friend.username}</small></span></article>
          )) : <p className="empty">لا يوجد أصدقاء.</p>}
        </div>
      )}

      {tab === "activity" && (
        <div className="admin-activity-list">
          {detail.activity.length ? detail.activity.map((event) => (
            <article key={event.id}>
              <span>{eventLabel(event, works)}</span>
              <time dateTime={new Date(event.createdAt).toISOString()}>{formatDate(event.createdAt)}</time>
            </article>
          )) : <p className="empty">لا يوجد نشاط مسجل.</p>}
        </div>
      )}
    </section>
  );
}
