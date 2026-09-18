import { useEffect } from "react";
import { Routes, Route, Navigate, useLocation, Link } from "react-router-dom";
import { useLibrary } from "./hooks/useLibrary";
import { AppLayout } from "./layouts/AppLayout";
import { Login } from "./pages/Login";
import { Home } from "./pages/Home";
import { Favorites } from "./pages/Favorites";
import { Friends, FriendProfile } from "./pages/Friends";
import { Profile } from "./pages/Profile";
import { Lists } from "./pages/Lists";
import { UserList } from "./pages/UserList";
import { Discover } from "./pages/Discover";
import { SourceMangaDetails } from "./pages/SourceMangaDetails";
import { SourceReader } from "./pages/SourceReader";
import "./phase3.css";
import "./lists.css";

export default function App() {
  const { user, loading, error } = useLibrary();
  const { pathname } = useLocation();

  useEffect(() => {
    if (!pathname.startsWith("/read-source/")) window.scrollTo(0, 0);
  }, [pathname]);

  if (loading) return <div className="loading">جاري فتح مكتبتك…</div>;

  return (
    <>
      {error && (
        <div className="global-error" role="alert">
          {error}
        </div>
      )}
      {!user ? (
        <Login />
      ) : (
        <Routes>
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route element={<AppLayout />}>
            <Route index element={<Home />} />
            <Route path="discover" element={<Discover />} />
            <Route path="source/:key" element={<SourceMangaDetails />} />
            <Route path="favorites" element={<Favorites />} />
            <Route path="lists" element={<Lists />} />
            <Route path="lists/:id" element={<UserList />} />
            <Route path="friends" element={<Friends />} />
            <Route path="friends/:id" element={<FriendProfile />} />
            <Route path="profile" element={<Profile />} />
            <Route
              path="*"
              element={
                <>
                  <h1>الصفحة غير موجودة</h1>
                  <Link to="/">العودة للرئيسية</Link>
                </>
              }
            />
          </Route>
          <Route path="read-source/:key/:chapter" element={<SourceReader />} />
        </Routes>
      )}
    </>
  );
}
