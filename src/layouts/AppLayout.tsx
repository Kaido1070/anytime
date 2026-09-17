import { NavLink, Outlet, Link } from "react-router-dom";
import { Icon } from "../components/UI";
import { useLibrary } from "../hooks/useLibrary";
export function AppLayout() {
  const { user } = useLibrary();
  const navItems = [
    { label: "الرئيسية", path: "/", icon: "home" },
    { label: "المفضلة", path: "/favorites", icon: "favorites" },
    { label: "الأصدقاء", path: "/friends", icon: "friends" },
    { label: "حسابي", path: "/profile", icon: "profile" },
  ];
  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to="/" className="wordmark">
          <span className="brand-mark">a</span> Anytime
          <span className="brand-dot">.</span>
        </Link>
        <span className="private-label">مساحتك الخاصة للقراءة</span>
        <Link to="/profile" className="avatar" aria-label="فتح الحساب">
          {user?.name[0]}
        </Link>
      </header>
      <main className="page">
        <Outlet />
      </main>
      <nav className="bottom-nav" aria-label="التنقل الرئيسي">
        {navItems.map((item) => (
          <NavLink key={item.path} to={item.path} end={item.path === "/"}>
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
