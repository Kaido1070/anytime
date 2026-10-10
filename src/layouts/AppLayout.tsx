import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, Link } from "react-router-dom";
import { Icon } from "../components/UI";

export function AppLayout() {
  const [mobileNavHidden, setMobileNavHidden] = useState(false);
  const lastScrollY = useRef(0);
  const scrollTravel = useRef(0);
  const scrollDirection = useRef(0);
  const scrollFrame = useRef<number | null>(null);
  const navItems = [
    { label: "استكشف", path: "/discover", icon: "search" },
    { label: "FYP", path: "/fyp", icon: "sparkles" },
    { label: "جديد", path: "/new", icon: "new" },
    { label: "حسابي", path: "/profile", icon: "profile" },
  ];

  useEffect(() => {
    const mobile = window.matchMedia("(max-width: 759px)");
    lastScrollY.current = Math.max(0, window.scrollY);

    const resetDirection = () => {
      scrollTravel.current = 0;
      scrollDirection.current = 0;
    };

    const updateForScroll = () => {
      const currentY = Math.max(0, window.scrollY);
      const delta = currentY - lastScrollY.current;
      lastScrollY.current = currentY;

      // Keep the navigation visible near the start and on short pages.
      if (!mobile.matches || currentY < 80 ||
          document.documentElement.scrollHeight <= window.innerHeight + 20) {
        resetDirection();
        setMobileNavHidden(false);
        return;
      }

      if (Math.abs(delta) < 1) return;
      const direction = delta > 0 ? 1 : -1;
      if (direction !== scrollDirection.current) {
        scrollDirection.current = direction;
        scrollTravel.current = 0;
      }

      // Accumulate intentional movement; ignore small Safari scroll jitter.
      scrollTravel.current += Math.abs(delta);
      const threshold = direction > 0 ? 28 : 16;
      if (scrollTravel.current >= threshold) {
        setMobileNavHidden(direction > 0);
        scrollTravel.current = 0;
      }
    };

    // One read per paint keeps scrolling smooth on mobile Safari.
    const onScroll = () => {
      if (scrollFrame.current !== null) return;
      scrollFrame.current = window.requestAnimationFrame(() => {
        scrollFrame.current = null;
        updateForScroll();
      });
    };

    const onViewportChange = () => {
      lastScrollY.current = Math.max(0, window.scrollY);
      resetDirection();
      setMobileNavHidden(false);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    mobile.addEventListener?.("change", onViewportChange);
    return () => {
      window.removeEventListener("scroll", onScroll);
      mobile.removeEventListener?.("change", onViewportChange);
      if (scrollFrame.current !== null) {
        window.cancelAnimationFrame(scrollFrame.current);
        scrollFrame.current = null;
      }
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

      <nav className={`bottom-nav${mobileNavHidden ? " mobile-hidden" : ""}`} aria-label="التنقل الرئيسي" onFocusCapture={() => setMobileNavHidden(false)}>
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
