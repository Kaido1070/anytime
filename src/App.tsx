import { useEffect } from "react";
import { Routes, Route, Navigate, useLocation, Link } from "react-router-dom";
import { useLibrary } from "./hooks/useLibrary";
import { AppLayout } from "./layouts/AppLayout";
import { Login } from "./pages/Login";
import { Home } from "./pages/Home";
import { Favorites } from "./pages/Favorites";
import { MangaDetails } from "./pages/MangaDetails";
import { Friends, FriendProfile } from "./pages/Friends";
import { Profile } from "./pages/Profile";
import { Reader } from "./pages/Reader";
export default function App() {
  const { user, loading, error } = useLibrary();
  const { pathname } = useLocation();
  useEffect(() => {
    if (!pathname.startsWith("/read/")) window.scrollTo(0, 0);
  }, [pathname]);
  if (loading) return <div className="loading">Opening your reading room…</div>;
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
            <Route path="manga/:id" element={<MangaDetails />} />
            <Route path="favorites" element={<Favorites />} />
            <Route path="friends" element={<Friends />} />
            <Route path="friends/:id" element={<FriendProfile />} />
            <Route path="profile" element={<Profile />} />
            <Route
              path="*"
              element={
                <>
                  <h1>Page not found</h1>
                  <Link to="/">Return home</Link>
                </>
              }
            />
          </Route>
          <Route path="read/:id/:chapter" element={<Reader />} />
        </Routes>
      )}
    </>
  );
}
