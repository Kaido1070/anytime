import { NavLink, Outlet, Link } from "react-router-dom";
import { Icon } from "../components/UI";

export function AppLayout() {
  const navItems = [
    { label: "استكشف", path: "/discover", icon: "search" },
    { label: "الأصدقاء", path: "/friends", icon: "friends" },
    { label: "حسابي", path: "/profile", icon: "profile" },
  ];

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
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
