import { Link, Outlet } from "react-router-dom";
import { useState } from "react";
import { useLibrary } from "../hooks/useLibrary";

export function AdminLayout() {
  const { signOut } = useLibrary();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function logout() {
    if (busy) return;
    setBusy(true); setError("");
    try { await signOut(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "تعذر تسجيل الخروج."); }
    finally { setBusy(false); }
  }

  return (
    <div className="app-shell admin-shell">
      <header className="app-header admin-header" style={{ direction: "ltr" }}>
        <Link to="/admin" className="wordmark" dir="ltr">
          <span className="brand-mark">w</span>
          Wany
        </Link>
        <span className="admin-role-badge">ADMIN</span>
        <Link to="/admin/settings">إعدادات الحساب</Link>
        <button className="secondary admin-signout" type="button" disabled={busy} onClick={() => void logout()}>
          تسجيل الخروج
        </button>
      </header>

      <main className="page admin-page">
        {error && <p role="alert">{error}</p>}
        <Outlet />
      </main>
    </div>
  );
}
