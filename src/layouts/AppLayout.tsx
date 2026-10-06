import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, Link } from "react-router-dom";
import { Icon } from "../components/UI";

export function AppLayout() {
  const [mobileNavHidden, setMobileNavHidden] = useState(false);
  const lastScrollY = useRef(0);
  const navItems = [
    { label: "استكشف", path: "/discover", icon: "search" },
    { label: "FYP", path: "/fyp", icon: "sparkles" },
    { label: "جديد", path: "/new", icon: "new" },
    { label: "حسابي", path: "/profile", icon: "profile" },
  ];

  useEffect(() => {
    const mobile = window.matchMedia("(max-width: 759px)");
    lastScrollY.current = window.scrollY;

    const onScroll = () => {
      if (!mobile.matches) {
        setMobileNavHidden(false);
        lastScrollY.current = window.scrollY;
        return;
      }

      const currentY = Math.max(0, window.scrollY);
      const delta = currentY - lastScrollY.current;

      if (currentY < 48) {
        setMobileNavHidden(false);
      } else if (delta > 6) {
        setMobileNavHidden(true);
      } else if (delta < -6) {
        setMobileNavHidden(false);
      }

      lastScrollY.current = currentY;
    };

    const onViewportChange = () => {
      if (!mobile.matches) setMobileNavHidden(false);
      lastScrollY.current = window.scrollY;
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    mobile.addEventListener?.("change", onViewportChange);
    return () => {
      window.removeEventListener("scroll", onScroll);
      mobile.removeEventListener?.("change", onViewportChange);
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

      <nav className={`bottom-nav${mobileNavHidden ? " mobile-hidden" : ""}`} aria-label="التنقل الرئيسي">
        {navItems.map((item) => (
            <NavLink key={item.path} to={item.path} end={item.path === "/profile"}>
              <span className="bottom-nav-icon">
                <Icon name={item.icon} />
              </span>
              <span>{item.label}</span>
            </NavLink>
        ))}
      </nav>
    </div>
  );
}
