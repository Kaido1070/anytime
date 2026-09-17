import { NavLink, Outlet, Link } from "react-router-dom";
import { Icon } from "../components/UI";
import { useLibrary } from "../hooks/useLibrary";
export function AppLayout() {
  const { user } = useLibrary();
  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to="/" className="wordmark">
          <span className="brand-mark">a</span> anytime
          <span className="brand-dot">.</span>
        </Link>
        <span className="private-label">YOUR PRIVATE READING ROOM</span>
        <Link to="/profile" className="avatar" aria-label="Open profile">
          {user?.name[0]}
        </Link>
      </header>
      <main className="page">
        <Outlet />
      </main>
      <nav className="bottom-nav" aria-label="Main navigation">
        {["Home", "Favorites", "Friends", "Profile"].map((label) => (
          <NavLink
            key={label}
            to={label === "Home" ? "/" : `/${label.toLowerCase()}`}
            end
          >
            <Icon name={label.toLowerCase()} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
