import { useEffect, useState } from "react";
import { NavLink, Outlet, Link } from "react-router-dom";
import { Icon } from "../components/UI";
import { loadNewChapterFeed } from "../services/newChapters";

export function AppLayout() {
  const [newCount, setNewCount] = useState(0);
  const navItems = [
    { label: "استكشف", path: "/discover", icon: "search" },
    { label: "FYP", path: "/fyp", icon: "sparkles" },
    { label: "جديد", path: "/new", icon: "new", badge: newCount },
    { label: "حسابي", path: "/profile", icon: "profile" },
  ];

  useEffect(() => {
    let active = true;
    void loadNewChapterFeed(1)
      .then((feed) => {
        if (active) setNewCount(feed.unreadFollowedCount);
      })
      .catch(() => {
        if (active) setNewCount(0);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="app-shell">
      <header
        className="app-header"
        style={{ direction: "ltr", justifyContent: "flex-start" }}
      >
        <Link to="/profile" className="wordmark" dir="ltr">
          <span className="brand-mark">a</span>
          Anytime
        </Link>
      </header>

      <main className="page">
        <Outlet />
      </main>

      <nav className="bottom-nav" aria-label="التنقل الرئيسي">
        {navItems.map((item) => (
          <NavLink key={item.path} to={item.path} end={item.path === "/profile"}>
            <span className="bottom-nav-icon">
              <Icon name={item.icon} />
              {"badge" in item && item.badge > 0 && (
                <span className="bottom-nav-badge" aria-label={item.badge + " فصل جديد غير مقروء"}>
                  {item.badge > 99 ? "99+" : item.badge}
                </span>
              )}
            </span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
