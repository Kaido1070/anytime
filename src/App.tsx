import { lazy, Suspense, useEffect } from "react";
import { Routes, Route, Navigate, useLocation, Link } from "react-router-dom";
import { useLibrary } from "./hooks/useLibrary";
import { AppLayout } from "./layouts/AppLayout";
import { AdminLayout } from "./layouts/AdminLayout";
import { Login } from "./pages/Login";
const Favorites = lazy(() => import("./pages/Favorites").then((module) => ({ default: module.Favorites })));
const FriendProfile = lazy(() => import("./pages/Friends").then((module) => ({ default: module.FriendProfile })));
const Friends = lazy(() => import("./pages/Friends").then((module) => ({ default: module.Friends })));
import { Account } from "./pages/Account";
const AdminDashboard = lazy(() => import("./pages/Admin").then((module) => ({ default: module.AdminDashboard })));
const AdminUserDetail = lazy(() => import("./pages/Admin").then((module) => ({ default: module.AdminUserDetail })));
const AdminSettings = lazy(() => import("./pages/AdminSettings").then((module) => ({ default: module.AdminSettings })));
const UserList = lazy(() => import("./pages/UserList").then((module) => ({ default: module.UserList })));
const Lists = lazy(() => import("./pages/Lists").then((module) => ({ default: module.Lists })));
const Discover = lazy(() => import("./pages/Discover").then((module) => ({ default: module.Discover })));
const Fyp = lazy(() => import("./pages/Fyp").then((module) => ({ default: module.Fyp })));
const NewChapters = lazy(() => import("./pages/NewChapters").then((module) => ({ default: module.NewChapters })));
const SourceMangaDetails = lazy(() => import("./pages/SourceMangaDetails").then((module) => ({ default: module.SourceMangaDetails })));
const SourceReader = lazy(() => import("./pages/SourceReader").then((module) => ({ default: module.SourceReader })));
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
      <Suspense fallback={<div className="loading">جاري فتح الصفحة…</div>}>
      {!user ? (
        <Login />
      ) : user.role === "admin" ? (
        <Routes>
          <Route path="/login" element={<Navigate to="/admin" replace />} />
          <Route path="/profile" element={<Navigate to="/admin" replace />} />
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<AdminDashboard />} />
            <Route path="settings" element={<AdminSettings />} />
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
      </Suspense>
    </>
  );
}
