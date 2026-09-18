import { Link, NavLink, Outlet } from "react-router-dom";
import { Icon } from "../components/UI";
import { useLibrary } from "../hooks/useLibrary";

export function AdminLayout() {
  const { signOut } = useLibrary();

  return (
    <div className="app-shell admin-shell">
      <header className="app-header admin-header" style={{ direction: "ltr" }}>
        <Link to="/admin" className="wordmark" dir="ltr">
          <span className="brand-mark">a</span>
          Anytime
        </Link>
        <span className="admin-role-badge">ADMIN</span>
        <button className="secondary admin-signout" type="button" onClick={() => void signOut()}>
          تسجيل الخروج
        </button>
      </header>

      <main className="page admin-page">
        <Outlet />
      </main>

      <nav className="bottom-nav admin-bottom-nav" aria-label="تنقل الإدارة">
        <NavLink to="/admin" end>
          <Icon name="profile" />
          <span>الحسابات</span>
        </NavLink>
      </nav>
    </div>
  );
}
