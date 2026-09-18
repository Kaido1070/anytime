import { useEffect, useState } from "react";
import { useLibrary } from "../hooks/useLibrary";
import { userDataService } from "../services/userData";
import type { UserListSummary } from "../types";
import { Icon } from "./UI";

export function ListManager({ mangaId }: { mangaId: string }) {
  const { data, favorite } = useLibrary();
  const [open, setOpen] = useState(false);
  const [lists, setLists] = useState<UserListSummary[]>([]);
  const [membership, setMembership] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [busyListId, setBusyListId] = useState("");
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError("");
    Promise.all([
      userDataService.getLists(),
      userDataService.getListMembership(mangaId),
    ])
      .then(([nextLists, nextMembership]) => {
        if (!active) return;
        setLists(nextLists);
        setMembership(new Set(nextMembership));
      })
      .catch((cause) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : "تعذر تحميل القوائم.");
        }
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [open, mangaId]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !creating && !busyListId) setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, creating, busyListId]);

  const toggleList = async (listId: string) => {
    if (busyListId) return;
    const had = membership.has(listId);
    const optimistic = new Set(membership);
    if (had) optimistic.delete(listId);
    else optimistic.add(listId);
    setMembership(optimistic);
    setBusyListId(listId);
    setError("");
    try {
      if (had) await userDataService.removeWorkFromList(listId, mangaId);
      else await userDataService.addWorkToList(listId, mangaId);
    } catch (cause) {
      setMembership(membership);
      setError(cause instanceof Error ? cause.message : "تعذر تحديث القائمة.");
    } finally {
      setBusyListId("");
    }
  };

  const createAndAdd = async () => {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    setError("");
    try {
      const list = await userDataService.createList(name, newDescription.trim());
      setLists((current) => [...current, list]);
      await userDataService.addWorkToList(list.id, mangaId);
      setMembership((current) => new Set(current).add(list.id));
      setNewName("");
      setNewDescription("");
      setShowCreate(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر إنشاء القائمة.");
    } finally {
      setCreating(false);
    }
  };

  const isFavorite = Boolean(data?.favorites.includes(mangaId));

  return (
    <>
      <button className="secondary" type="button" onClick={() => setOpen(true)}>
        <Icon name="lists" />
        إضافة إلى قائمة
      </button>
      {open && (
        <div
          className="list-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busyListId && !creating) setOpen(false);
          }}
        >
          <section className="list-manager-sheet" role="dialog" aria-modal="true" aria-label="إضافة العمل إلى قائمة">
            <div className="list-dialog-header">
              <div>
                <p className="eyebrow">تنظيم العمل</p>
                <h2>إضافة إلى قائمة</h2>
              </div>
              <button className="list-dialog-close" type="button" onClick={() => setOpen(false)} aria-label="إغلاق">×</button>
            </div>

            <div className="list-membership-options">
              <button
                className={`list-membership-row ${isFavorite ? "selected" : ""}`}
                type="button"
                aria-pressed={isFavorite}
                onClick={() => void favorite(mangaId)}
              >
                <span className="list-check">{isFavorite ? "✓" : ""}</span>
                <span>
                  <b>المفضلة</b>
                  <small>تستخدم نظام المفضلة الحالي بدون تكرار البيانات.</small>
                </span>
              </button>

              {loading ? (
                <>
                  <div className="list-membership-skeleton" />
                  <div className="list-membership-skeleton" />
                </>
              ) : (
                lists.map((list) => {
                  const selected = membership.has(list.id);
                  return (
                    <button
                      key={list.id}
                      className={`list-membership-row ${selected ? "selected" : ""}`}
                      type="button"
                      aria-pressed={selected}
                      disabled={busyListId === list.id}
                      onClick={() => void toggleList(list.id)}
                    >
                      <span className="list-check">{selected ? "✓" : ""}</span>
                      <span>
                        <b>{list.name}</b>
                        <small>{list.itemCount} عمل{list.description ? ` · ${list.description}` : ""}</small>
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            {!loading && !lists.length && !showCreate && (
              <p className="list-manager-empty">ما عندك قوائم شخصية حتى الآن.</p>
            )}

            {showCreate ? (
              <div className="list-inline-create">
                <label>
                  اسم القائمة
                  <input maxLength={80} value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="مثال: أفضل الأعمال" />
                </label>
                <label>
                  الوصف <small>اختياري</small>
                  <textarea maxLength={500} value={newDescription} onChange={(event) => setNewDescription(event.target.value)} />
                </label>
                <div className="list-dialog-actions">
                  <button className="secondary" type="button" onClick={() => setShowCreate(false)} disabled={creating}>إلغاء</button>
                  <button className="primary" type="button" onClick={() => void createAndAdd()} disabled={creating || !newName.trim()}>
                    {creating ? "جاري الإنشاء…" : "إنشاء وإضافة"}
                  </button>
                </div>
              </div>
            ) : (
              <button className="list-create-inline-trigger" type="button" onClick={() => setShowCreate(true)}>
                + إنشاء قائمة جديدة
              </button>
            )}

            {error && <p className="error">{error}</p>}
          </section>
        </div>
      )}
    </>
  );
}
