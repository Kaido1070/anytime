import { useLibrary } from "../hooks/useLibrary";
export function Profile() {
  const { user, data, signOut } = useLibrary();
  const reading = new Set(
    Object.values(data?.progress ?? {})
      .filter((p) => !data?.completed.includes(`${p.mangaId}:${p.chapter}`))
      .map((p) => p.mangaId),
  ).size;
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
      </div>
      <div className="stats">
        <div>
          <strong>{data?.favorites.length ?? 0}</strong>
          <span>المفضلة</span>
        </div>
        <div>
          <strong>{reading}</strong>
          <span>قيد القراءة</span>
        </div>
      </div>
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
          <span>مكتبتك</span>
          <b>محفوظة على هذا الجهاز</b>
        </p>
      </div>
      <button className="secondary signout" onClick={signOut}>
        تسجيل الخروج <span>↗</span>
      </button>
      <p className="demo-note">
        المرحلة الأولى
        <br />
        <span>نسخة خاصة تجريبية بحسابات وبيانات قراءة محلية.</span>
      </p>
    </>
  );
}
