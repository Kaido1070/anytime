import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ListEditorDialog } from "../components/ListEditorDialog";
import { Icon } from "../components/UI";
import { useLibrary } from "../hooks/useLibrary";
import { userDataService } from "../services/userData";
import type { UserListSummary } from "../types";

export function Lists() {
  const { data } = useLibrary();
  const [lists, setLists] = useState<UserListSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const loadLists = useCallback(async () => {
    setLoading(true);
    try {
      setError("");
      setLists(await userDataService.getLists());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تحميل القوائم.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLists();
  }, [loadLists]);

  const createList = async (name: string, description: string) => {
    setCreating(true);
    setError("");
    try {
      const created = await userDataService.createList(name, description);
      setLists((current) => [...current, created]);
      setShowCreate(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر إنشاء القائمة.");
    } finally {
      setCreating(false);
    }
  };

  const favoritesCount = data?.favorites.length ?? 0;

  return (
    <>
      <header className="lists-page-header">
        <div>
          <p className="eyebrow">رتب أعمالك بطريقتك</p>
          <h1>
            القوائم<span className="accent">.</span>
          </h1>
          <p className="muted">العمل الواحد يقدر يكون في أكثر من قائمة في نفس الوقت.</p>
        </div>
        <button className="primary" type="button" onClick={() => setShowCreate(true)}>
          <span aria-hidden="true">+</span>
          إنشاء قائمة
        </button>
      </header>

      {error && <p className="error lists-error">{error}</p>}

      <section aria-label="قوائمك">
        <div className="lists-overview-grid">
          <Link className="user-list-card system-list-card" to="/favorites">
            <div className="list-card-top">
              <span className="list-card-icon"><Icon name="favorites" /></span>
              <span className="list-count">{favoritesCount} عمل</span>
            </div>
            <div>
              <h2>المفضلة</h2>
              <p>المفضلة الحالية في Wany، بدون نسخ أو تكرار للبيانات.</p>
            </div>
          </Link>

          {loading
            ? Array.from({ length: 2 }, (_, index) => (
                <div className="user-list-card list-card-skeleton" key={index} aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
              ))
            : lists.map((list) => (
                <Link className="user-list-card" to={`/lists/${encodeURIComponent(list.id)}`} key={list.id}>
                  <div className="list-card-top">
                    <span className="list-card-icon"><Icon name="lists" /></span>
                    <span className="list-count">{list.itemCount} عمل</span>
                  </div>
                  <div>
                    <h2>{list.name}</h2>
                    <p>{list.description || "قائمة شخصية"}</p>
                  </div>
                </Link>
              ))}
        </div>

        {!loading && !lists.length && (
          <div className="lists-empty-state">
            <span className="list-card-icon"><Icon name="lists" /></span>
            <h2>ما عندك قوائم حتى الآن</h2>
            <p>أنشئ قائمتك الأولى ورتب أعمالك بالطريقة اللي تناسبك.</p>
            <button className="primary" type="button" onClick={() => setShowCreate(true)}>
              + إنشاء قائمة
            </button>
          </div>
        )}
      </section>

      <ListEditorDialog
        open={showCreate}
        title="إنشاء قائمة"
        submitLabel="إنشاء"
        busy={creating}
        error={showCreate ? error : ""}
        onClose={() => {
          if (!creating) setShowCreate(false);
        }}
        onSubmit={createList}
      />
    </>
  );
}
