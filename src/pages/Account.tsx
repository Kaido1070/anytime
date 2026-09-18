import { useEffect } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { UserAvatar } from "../components/UserAvatar";
import { useLibrary } from "../hooks/useLibrary";
import { Home } from "./Home";
import { Lists } from "./Lists";
import { Friends } from "./Friends";
import { Profile } from "./Profile";

export function Account() {
  const { user } = useLibrary();
  const [searchParams] = useSearchParams();
  const { hash } = useLocation();
  const settingsOpen = searchParams.get("tab") === "settings";

  useEffect(() => {
    if (settingsOpen || !hash) return;
    const id = hash.slice(1);
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ block: "start" });
    });
  }, [hash, settingsOpen]);

  return (
    <>
      <header className="account-header">
        <div className="account-header-row">
          <div className="account-identity">
            <UserAvatar user={user} className="account-avatar" loading="eager" />
            <div>
              <p className="eyebrow">حسابي</p>
              <h1>
                {user?.name}
                <span className="accent">.</span>
              </h1>
              <p className="muted">@{user?.username}</p>
            </div>
          </div>

          <Link
            className="secondary account-settings-link"
            to={settingsOpen ? "/profile" : "/profile?tab=settings"}
          >
            {settingsOpen ? "العودة للحساب" : "⚙ الإعدادات"}
          </Link>
        </div>
      </header>

      <div className="account-content">
        {settingsOpen ? (
          <Profile embedded />
        ) : (
          <>
            <Home embedded />
            <section id="account-lists" className="account-lists-section">
              <Lists embedded />
            </section>
            <section id="account-friends" className="account-friends-section">
              <Friends embedded />
            </section>
          </>
        )}
      </div>
    </>
  );
}
