import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useLibrary } from "../hooks/useLibrary";
import { Home } from "./Home";
import { Lists } from "./Lists";
import { Profile } from "./Profile";

type AccountTab = "home" | "lists" | "settings";

const tabs: Array<{ id: AccountTab; label: string }> = [
  { id: "home", label: "صفحتي" },
  { id: "lists", label: "القوائم" },
  { id: "settings", label: "الإعدادات" },
];

function normalizeTab(value: string | null): AccountTab {
  if (value === "lists" || value === "settings") return value;
  return "home";
}

export function Account() {
  const { user } = useLibrary();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = useMemo(
    () => normalizeTab(searchParams.get("tab")),
    [searchParams],
  );

  const selectTab = (tab: AccountTab) => {
    if (tab === "home") {
      setSearchParams({}, { replace: true });
      return;
    }
    setSearchParams({ tab }, { replace: true });
  };

  return (
    <>
      <header className="account-header">
        <div className="account-identity">
          <span className="avatar account-avatar">{user?.name?.slice(0, 1)}</span>
          <div>
            <p className="eyebrow">حسابي</p>
            <h1>
              {user?.name}
              <span className="accent">.</span>
            </h1>
            <p className="muted">@{user?.username}</p>
          </div>
        </div>

        <nav className="account-tabs" aria-label="أقسام حسابي">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={activeTab === tab.id ? "active" : ""}
              aria-pressed={activeTab === tab.id}
              onClick={() => selectTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>

      <div className="account-tab-content">
        {activeTab === "home" && <Home embedded />}
        {activeTab === "lists" && <Lists embedded />}
        {activeTab === "settings" && <Profile embedded />}
      </div>
    </>
  );
}
