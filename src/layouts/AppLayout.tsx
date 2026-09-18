import { useEffect, useState } from "react";
import { NavLink, Outlet, Link } from "react-router-dom";
import { Icon } from "../components/UI";
import { loadUnreadFollowedCount } from "../services/newChapters";
import { PERSONALIZATION_CHANGE_EVENT } from "../services/userData";

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
    const refreshBadge = () => {
      void loadUnreadFollowedCount()
        .then((count) => {
          if (active) setNewCount(count);
        })
        .catch(() => {
          if (active) setNewCount(0);
        });
    };
    refreshBadge();
    window.addEventListener(PERSONALIZATION_CHANGE_EVENT, refreshBadge);
    return () => {
      active = false;
      window.removeEventListener(PERSONALIZATION_CHANGE_EVENT, refreshBadge);
    };
  }, []);

  return (
    <div className="app-shell">
      <header
        className="app-header"
        style={{ direction: "ltr", justifyContent: "flex-start" }}
      >
        <Link to="/profile" className="wordmark" dir="ltr">
          <span className="brand-mark">w</span>
          Wany
        </Link>
      </header>

      <main className="page">
        <Outlet />
      </main>

      <nav className="bottom-nav" aria-label="التنقل الرئيسي">
        {navItems.map((item) => {
          const badge = "badge" in item ? (item.badge ?? 0) : 0;
          return (
            <NavLink key={item.path} to={item.path} end={item.path === "/profile"}>
              <span className="bottom-nav-icon">
                <Icon name={item.icon} />
                {badge > 0 && (
                  <span className="bottom-nav-badge" aria-label={badge + " فصل جديد غير مقروء"}>
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </span>
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}
