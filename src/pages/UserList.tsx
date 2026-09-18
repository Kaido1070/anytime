import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ListEditorDialog } from "../components/ListEditorDialog";
import { SourceCoverImage } from "../components/SourceCoverImage";
import { Back, Icon } from "../components/UI";
import { sourceDisplayTitle } from "../services/sourceTitles";
import { sourceService } from "../services/sources";
import { userDataService } from "../services/userData";
import type { SourceManga, UserListItem, UserListSummary } from "../types";

type DragState = {
  mangaId: string;
  pointerId: number;
  snapshot: UserListItem[];
};

function moveItem(items: UserListItem[], mangaId: string, targetId: string, after: boolean) {
  const moving = items.find((item) => item.mangaId === mangaId);
  if (!moving || mangaId === targetId) return items;
  const remaining = items.filter((item) => item.mangaId !== mangaId);
  const targetIndex = remaining.findIndex((item) => item.mangaId === targetId);
  if (targetIndex < 0) return items;
  const next = [...remaining];
  next.splice(targetIndex + (after ? 1 : 0), 0, moving);
  return next;
}

export function UserList() {
  const { id = "" } = useParams();
  const listId = decodeURIComponent(id);
  const navigate = useNavigate();
  const [list, setList] = useState<UserListSummary | null>(null);
  const [items, setItems] = useState<UserListItem[]>([]);
  const itemsRef = useRef<UserListItem[]>([]);
  const [works, setWorks] = useState<Record<string, SourceManga>>({});
  const [loading, setLoading] = useState(true);
  const [savingOrder, setSavingOrder] = useState(false);
  const [draggingId, setDraggingId] = useState("");
  const [dropTargetId, setDropTargetId] = useState("");
  const [dropPlacement, setDropPlacement] = useState<"before" | "after" | "">("");
  const dragRef = useRef<DragState | null>(null);
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [busyEdit, setBusyEdit] = useState(false);
  const [busyDelete, setBusyDelete] = useState(false);
  const [error, setError] = useState("");

  const updateItems = useCallback((next: UserListItem[]) => {
    itemsRef.current = next;
    setItems(next);
  }, []);

  const resolveWorks = useCallback(async (nextItems: UserListItem[]) => {
    if (!nextItems.length) {
      setWorks({});
      return;
    }
    const resolved = await sourceService.resolve(nextItems.map((item) => item.mangaId));
    setWorks(Object.fromEntries(resolved.map((item) => [item.key, item])));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const detail = await userDataService.getList(listId);
      const { items: nextItems, ...summary } = detail;
      setList(summary);
      updateItems(nextItems);
      await resolveWorks(nextItems);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تحميل القائمة.");
    } finally {
      setLoading(false);
    }
  }, [listId, resolveWorks, updateItems]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return () => {
      dragRef.current = null;
    };
  }, []);

  const persistOrder = useCallback(
    async (mangaId: string, snapshot: UserListItem[]) => {
      const current = itemsRef.current;
      const index = current.findIndex((item) => item.mangaId === mangaId);
      if (index < 0) return;
      const beforeId = current[index + 1]?.mangaId ?? null;
      const afterId = current[index - 1]?.mangaId ?? null;
      setSavingOrder(true);
      setError("");
      try {
        await userDataService.reorderListItem(listId, mangaId, beforeId, afterId);
        const fresh = await userDataService.getList(listId);
        const { items: freshItems, ...summary } = fresh;
        setList(summary);
        updateItems(freshItems);
      } catch (cause) {
        updateItems(snapshot);
        setError(cause instanceof Error ? cause.message : "تعذر حفظ ترتيب القائمة.");
      } finally {
        setSavingOrder(false);
      }
    },
    [listId, updateItems],
  );

  const endPointerDrag = async (pointerId: number, cancelled = false) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== pointerId) return;
    dragRef.current = null;
    setDraggingId("");
    setDropTargetId("");
    setDropPlacement("");
    if (cancelled) {
      updateItems(drag.snapshot);
      return;
    }
    const changed = drag.snapshot.map((item) => item.mangaId).join("|") !==
      itemsRef.current.map((item) => item.mangaId).join("|");
    if (changed) await persistOrder(drag.mangaId, drag.snapshot);
  };

  const onPointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    mangaId: string,
  ) => {
    if (savingOrder || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const snapshot = [...itemsRef.current];
    dragRef.current = { mangaId, pointerId: event.pointerId, snapshot };
    setDraggingId(mangaId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const target = document
      .elementsFromPoint(event.clientX, event.clientY)
      .map((element) => element.closest<HTMLElement>("[data-list-work-id]"))
      .find((element) => element?.dataset.listWorkId && element.dataset.listWorkId !== drag.mangaId);
    const targetId = target?.dataset.listWorkId;
    if (!target || !targetId) return;
    const edge = Math.min(96, window.innerHeight * 0.18);
    if (event.clientY < edge) window.scrollBy({ top: -18, behavior: "auto" });
    else if (event.clientY > window.innerHeight - edge) {
      window.scrollBy({ top: 18, behavior: "auto" });
    }

    const rect = target.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    setDropTargetId(targetId);
    setDropPlacement(after ? "after" : "before");
    const next = moveItem(itemsRef.current, drag.mangaId, targetId, after);
    if (next !== itemsRef.current) updateItems(next);
  };

  const moveByKeyboard = async (mangaId: string, delta: number) => {
    if (savingOrder) return;
    const snapshot = [...itemsRef.current];
    const index = snapshot.findIndex((item) => item.mangaId === mangaId);
    const targetIndex = index + delta;
    if (index < 0 || targetIndex < 0 || targetIndex >= snapshot.length) return;
    const next = [...snapshot];
    const [moving] = next.splice(index, 1);
    next.splice(targetIndex, 0, moving);
    updateItems(next);
    await persistOrder(mangaId, snapshot);
  };

  const removeItem = async (mangaId: string) => {
    const snapshot = [...itemsRef.current];
    updateItems(snapshot.filter((item) => item.mangaId !== mangaId));
    setList((current) => current ? { ...current, itemCount: Math.max(0, current.itemCount - 1) } : current);
    setError("");
    try {
      await userDataService.removeWorkFromList(listId, mangaId);
    } catch (cause) {
      updateItems(snapshot);
      setList((current) => current ? { ...current, itemCount: snapshot.length } : current);
      setError(cause instanceof Error ? cause.message : "تعذر إزالة العمل من القائمة.");
    }
  };

  const saveEdit = async (name: string, description: string) => {
    setBusyEdit(true);
    setError("");
    try {
      const updated = await userDataService.updateList(listId, name, description);
      setList(updated);
      setShowEdit(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تعديل القائمة.");
    } finally {
      setBusyEdit(false);
    }
  };

  const deleteList = async () => {
    if (busyDelete) return;
    setBusyDelete(true);
    setError("");
    try {
      await userDataService.deleteList(listId);
      navigate("/lists", { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر حذف القائمة.");
      setBusyDelete(false);
      setShowDelete(false);
    }
  };

  if (loading) {
    return (
      <>
        <Back to="/lists" />
        <div className="list-detail-loading" aria-label="جاري تحميل القائمة">
          <span />
          <span />
          <span />
        </div>
      </>
    );
  }

  if (!list) {
    return (
      <>
        <Back to="/lists" />
        <h1>تعذر فتح القائمة</h1>
        <p className="error">{error || "القائمة غير موجودة."}</p>
      </>
    );
  }

  return (
    <>
      <Back to="/lists" />
      <header className="list-detail-header">
        <div>
          <p className="eyebrow">{list.itemCount} عمل</p>
          <h1>{list.name}<span className="accent">.</span></h1>
          {list.description && <p className="muted">{list.description}</p>}
        </div>
        <div className="list-detail-actions">
          <button className="secondary" type="button" onClick={() => setShowEdit(true)}>
            تعديل القائمة
          </button>
          <button className="list-danger-button" type="button" onClick={() => setShowDelete(true)}>
            حذف
          </button>
        </div>
      </header>

      {savingOrder && <p className="list-saving-order" role="status">جاري حفظ الترتيب…</p>}
      {error && <p className="error lists-error">{error}</p>}

      {!items.length ? (
        <div className="lists-empty-state list-detail-empty">
          <span className="list-card-icon"><Icon name="lists" /></span>
          <h2>هذه القائمة فارغة</h2>
          <p>أضف أعمالًا إليها من صفحات الأعمال.</p>
          <Link className="primary" to="/discover">استكشف الأعمال</Link>
        </div>
      ) : (
        <section className="list-sortable" aria-label={`أعمال قائمة ${list.name}`}>
          {items.map((entry, index) => {
            const work = works[entry.mangaId];
            if (!work) {
              return (
                <article
                  className={`list-sortable-row missing ${draggingId === entry.mangaId ? "dragging" : ""}`}
                  data-list-work-id={entry.mangaId}
                  key={entry.mangaId}
                >
                  <button
                    className="list-drag-handle"
                    type="button"
                    aria-label={`تغيير ترتيب العنصر ${index + 1}`}
                    onPointerDown={(event) => onPointerDown(event, entry.mangaId)}
                    onPointerMove={onPointerMove}
                    onPointerUp={(event) => void endPointerDrag(event.pointerId)}
                    onPointerCancel={(event) => void endPointerDrag(event.pointerId, true)}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowUp") void moveByKeyboard(entry.mangaId, -1);
                      if (event.key === "ArrowDown") void moveByKeyboard(entry.mangaId, 1);
                    }}
                  >
                    <span aria-hidden="true">☰</span>
                  </button>
                  <div className="list-work-copy">
                    <b>{entry.mangaId}</b>
                    <small>تعذر تحميل بيانات العمل من المصدر حاليًا.</small>
                  </div>
                  <button className="list-remove" type="button" onClick={() => void removeItem(entry.mangaId)}>إزالة</button>
                </article>
              );
            }
            const title = sourceDisplayTitle(work);
            return (
              <article
                className={[
                  "list-sortable-row",
                  draggingId === entry.mangaId ? "dragging" : "",
                  dropTargetId === entry.mangaId ? `drop-target drop-${dropPlacement}` : "",
                ].filter(Boolean).join(" ")}
                data-list-work-id={entry.mangaId}
                key={entry.mangaId}
              >
                <button
                  className="list-drag-handle"
                  type="button"
                  aria-label={`تغيير ترتيب ${title}. الموضع الحالي ${index + 1}`}
                  title="اسحب لتغيير الترتيب"
                  onPointerDown={(event) => onPointerDown(event, entry.mangaId)}
                  onPointerMove={onPointerMove}
                  onPointerUp={(event) => void endPointerDrag(event.pointerId)}
                  onPointerCancel={(event) => void endPointerDrag(event.pointerId, true)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      void moveByKeyboard(entry.mangaId, -1);
                    }
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      void moveByKeyboard(entry.mangaId, 1);
                    }
                  }}
                >
                  <span aria-hidden="true">☰</span>
                </button>

                <Link className="list-work-link" to={`/source/${encodeURIComponent(work.key)}`}>
                  <span className="list-work-cover">
                    {work.cover ? (
                      <SourceCoverImage item={work} alt={`غلاف ${title}`} loading="lazy" />
                    ) : (
                      <span className="source-cover-placeholder">{title.slice(0, 1)}</span>
                    )}
                  </span>
                  <span className="list-work-copy">
                    <small>{sourceService.sourceLabel(work.source)}</small>
                    <b dir="auto">{title}</b>
                  </span>
                </Link>

                <button className="list-remove" type="button" onClick={() => void removeItem(entry.mangaId)}>
                  إزالة
                </button>
              </article>
            );
          })}
        </section>
      )}

      <ListEditorDialog
        open={showEdit}
        title="تعديل القائمة"
        submitLabel="حفظ"
        initialName={list.name}
        initialDescription={list.description}
        busy={busyEdit}
        error={showEdit ? error : ""}
        onClose={() => {
          if (!busyEdit) setShowEdit(false);
        }}
        onSubmit={saveEdit}
      />

      {showDelete && (
        <div
          className="list-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busyDelete) setShowDelete(false);
          }}
        >
          <section className="list-delete-dialog" role="alertdialog" aria-modal="true" aria-label="تأكيد حذف القائمة">
            <p className="eyebrow">تأكيد الحذف</p>
            <h2>هل تريد حذف قائمة “{list.name}”؟</h2>
            <p>سيتم حذف القائمة فقط. لن يتم حذف الأعمال من مكتبتك، ولن يتأثر تقدم القراءة أو سجل القراءة.</p>
            <div className="list-dialog-actions">
              <button className="secondary" type="button" onClick={() => setShowDelete(false)} disabled={busyDelete}>
                إلغاء
              </button>
              <button className="list-danger-confirm" type="button" onClick={() => void deleteList()} disabled={busyDelete}>
                {busyDelete ? "جاري الحذف…" : "حذف"}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
