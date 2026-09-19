import { Link, Outlet } from "react-router-dom";
import { useLibrary } from "../hooks/useLibrary";

export function AdminLayout() {
  const { signOut } = useLibrary();

  return (
    <div className="app-shell admin-shell">
      <header className="app-header admin-header" style={{ direction: "ltr" }}>
        <Link to="/admin" className="wordmark" dir="ltr">
          <span className="brand-mark">w</span>
          Wany
        </Link>
        <span className="admin-role-badge">ADMIN</span>
        <button className="secondary admin-signout" type="button" onClick={() => void signOut()}>
          تسجيل الخروج
        </button>
      </header>

      <main className="page admin-page">
        <Outlet />
      </main>
    </div>
  );
}
