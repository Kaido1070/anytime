import { useEffect } from "react";
import { Routes, Route, Navigate, useLocation, Link } from "react-router-dom";
import { useLibrary } from "./hooks/useLibrary";
import { AppLayout } from "./layouts/AppLayout";
import { AdminLayout } from "./layouts/AdminLayout";
import { Login } from "./pages/Login";
import { Favorites } from "./pages/Favorites";
import { FriendProfile, Friends } from "./pages/Friends";
import { Account } from "./pages/Account";
import { AdminDashboard, AdminUserDetail } from "./pages/Admin";
import { UserList } from "./pages/UserList";
import { Lists } from "./pages/Lists";
import { Discover } from "./pages/Discover";
import { Fyp } from "./pages/Fyp";
import { NewChapters } from "./pages/NewChapters";
import { SourceMangaDetails } from "./pages/SourceMangaDetails";
import { SourceReader } from "./pages/SourceReader";
import "./phase3.css";
import "./lists.css";
import "./phase4.css";
import "./account.css";
import "./phase5.css";
import "./phase6.css";
import "./phase7.css";
import "./phase8.css";
import "./phase9.css";
import "./phase10.css";
import "./phase10_5.css";
import "./profileOverview.css";

export default function App() {
  const { user, loading, error } = useLibrary();
  const { pathname } = useLocation();

  useEffect(() => {
    if (!pathname.startsWith("/read-source/") && !pathname.startsWith("/read/")) window.scrollTo(0, 0);
  }, [pathname]);

  if (loading) return <div className="loading">جاري فتح مكتبتك…</div>;

  return (
    <>
      {error && <div className="global-error" role="alert">{error}</div>}
      {!user ? (
        <Login />
      ) : user.role === "admin" ? (
        <Routes>
          <Route path="/login" element={<Navigate to="/admin" replace />} />
          <Route path="/profile" element={<Navigate to="/admin" replace />} />
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<AdminDashboard />} />
            <Route path="users/:id" element={<AdminUserDetail />} />
          </Route>
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      ) : (
        <Routes>
          <Route path="/login" element={<Navigate to="/profile" replace />} />
          <Route element={<AppLayout />}>
            <Route index element={<Navigate to="/profile" replace />} />
            <Route path="discover" element={<Discover />} />
            <Route path="fyp" element={<Fyp />} />
            <Route path="new" element={<NewChapters />} />
            <Route path="source/:key" element={<SourceMangaDetails />} />
            <Route path="favorites" element={<Favorites />} />
            <Route path="lists" element={<Lists />} />
            <Route path="lists/:id" element={<UserList />} />
            <Route path="friends" element={<Friends />} />
            <Route path="friends/:id" element={<FriendProfile />} />
            <Route path="profile" element={<Account />} />
            <Route
              path="*"
              element={<><h1>الصفحة غير موجودة</h1><Link to="/profile">العودة لحسابي</Link></>}
            />
          </Route>
          <Route path="read/:source/:work/:chapter" element={<SourceReader />} />
          <Route path="read-source/:key/:chapter" element={<SourceReader />} />
        </Routes>
      )}
    </>
  );
}
