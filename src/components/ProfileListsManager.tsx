import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ListEditorDialog } from "./ListEditorDialog";
import { Icon } from "./UI";
import { userDataService } from "../services/userData";
import type {
  UserListSummary,
  UserProfileSection,
  UserProfileSectionInput,
} from "../types";

type ListRow = {
  key: string;
  sectionType: "favorites" | "custom_list";
  referenceId: string | null;
  name: string;
  description: string | null;
  iconKey: string;
  itemCount: number;
  isVisible: boolean;
  system: boolean;
};

type DragState = {
  key: string;
  pointerId: number;
  snapshot: ListRow[];
};

function isManagedListSection(section: UserProfileSection) {
  return section.sectionType === "favorites" || section.sectionType === "custom_list";
}

function rowsFromData(
  sections: UserProfileSection[],
  lists: UserListSummary[],
  favoritesCount: number,
): ListRow[] {
  const listMap = new Map(lists.map((list) => [list.id, list]));
  const ordered = [...sections]
    .filter(isManagedListSection)
    .sort((a, b) => a.position - b.position || a.key.localeCompare(b.key));

  const rows: ListRow[] = [];
  for (const section of ordered) {
    if (section.sectionType === "favorites") {
      rows.push({
        key: section.key,
        sectionType: "favorites",
        referenceId: null,
        name: "المفضلة",
        description: "قائمة نظامية",
        iconKey: "favorites",
        itemCount: favoritesCount,
        isVisible: section.isVisible,
        system: true,
      });
      continue;
    }

    if (section.sectionType !== "custom_list" || !section.referenceId) continue;
    const list = listMap.get(section.referenceId);
    if (!list) continue;

    rows.push({
      key: section.key,
      sectionType: "custom_list",
      referenceId: list.id,
      name: list.name,
      description: list.description,
      iconKey: list.iconKey || "lists",
      itemCount: list.itemCount,
      isVisible: section.isVisible,
      system: false,
    });
  }

  return rows;
}

function buildSectionPayload(
  sections: UserProfileSection[],
  rows: ListRow[],
): UserProfileSectionInput[] {
  const ordered = [...sections].sort(
    (a, b) => a.position - b.position || a.key.localeCompare(b.key),
  );
  const listRows = rows.map((row) => ({
    sectionType: row.sectionType,
    referenceId: row.referenceId,
    isVisible: row.isVisible,
  }));

  let listIndex = 0;
  return ordered.map((section) => {
    if (!isManagedListSection(section)) {
      return {
        sectionType: section.sectionType,
        referenceId: section.referenceId,
        isVisible: section.isVisible,
      };
    }

    const replacement = listRows[listIndex++];
    return replacement ?? {
      sectionType: section.sectionType,
      referenceId: section.referenceId,
      isVisible: section.isVisible,
    };
  });
}

function moveRow(rows: ListRow[], movingKey: string, targetKey: string, after: boolean) {
  const moving = rows.find((row) => row.key === movingKey);
  if (!moving || movingKey === targetKey) return rows;
  const remaining = rows.filter((row) => row.key !== movingKey);
  const targetIndex = remaining.findIndex((row) => row.key === targetKey);
  if (targetIndex < 0) return rows;
  const next = [...remaining];
  next.splice(targetIndex + (after ? 1 : 0), 0, moving);
  return next;
}

export function ProfileListsManager({
  onClose,
}: {
  onClose: () => void;
}) {
  const [sections, setSections] = useState<UserProfileSection[]>([]);
  const [lists, setLists] = useState<UserListSummary[]>([]);
  const [rows, setRows] = useState<ListRow[]>([]);
  const rowsRef = useRef<ListRow[]>([]);
  const dragRef = useRef<DragState | null>(null);
  const [draggingKey, setDraggingKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const updateRows = useCallback((next: ListRow[]) => {
    rowsRef.current = next;
    setRows(next);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [nextSections, nextLists, data] = await Promise.all([
        userDataService.getProfileSections(10),
        userDataService.getLists(),
        userDataService.getData(),
      ]);
      setSections(nextSections);
      setLists(nextLists);
      updateRows(rowsFromData(nextSections, nextLists, data.favorites.length));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تحميل القوائم.");
    } finally {
      setLoading(false);
    }
  }, [updateRows]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => () => {
    dragRef.current = null;
  }, []);

  const persistRows = async (nextRows: ListRow[]) => {
    const saved = await userDataService.saveProfileSections(
      buildSectionPayload(sections, nextRows),
    );
    setSections(saved);
    const favoritesCount = nextRows.find((row) => row.system)?.itemCount ?? 0;
    updateRows(rowsFromData(saved, lists, favoritesCount));
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>, key: string) => {
    if (busy || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      key,
      pointerId: event.pointerId,
      snapshot: [...rowsRef.current],
    };
    setDraggingKey(key);
    setMessage("");
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();

    const target = document
      .elementsFromPoint(event.clientX, event.clientY)
      .map((element) => element.closest<HTMLElement>("[data-profile-list-key]"))
      .find((element) => element?.dataset.profileListKey && element.dataset.profileListKey !== drag.key);

    const targetKey = target?.dataset.profileListKey;
    if (!target || !targetKey) return;

    const rect = target.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    const next = moveRow(rowsRef.current, drag.key, targetKey, after);
    if (next !== rowsRef.current) updateRows(next);

    const edge = Math.min(88, window.innerHeight * 0.14);
    if (event.clientY < edge) window.scrollBy({ top: -14, behavior: "auto" });
    else if (event.clientY > window.innerHeight - edge) {
      window.scrollBy({ top: 14, behavior: "auto" });
    }
  };

  const endDrag = async (pointerId: number, cancelled = false) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== pointerId) return;
    dragRef.current = null;
    setDraggingKey("");

    if (cancelled) {
      updateRows(drag.snapshot);
      return;
    }

    const before = drag.snapshot.map((row) => row.key).join("|");
    const after = rowsRef.current.map((row) => row.key).join("|");
    if (before === after) return;

    setBusy(true);
    setError("");
    try {
      await persistRows(rowsRef.current);
      setMessage("تم حفظ ترتيب القوائم.");
    } catch (cause) {
      updateRows(drag.snapshot);
      setError(cause instanceof Error ? cause.message : "تعذر حفظ ترتيب القوائم.");
    } finally {
      setBusy(false);
    }
  };

  const toggleVisibility = async (key: string) => {
    if (busy) return;
    const previous = rowsRef.current;
    const next = previous.map((row) =>
      row.key === key ? { ...row, isVisible: !row.isVisible } : row,
    );
    updateRows(next);
    setBusy(true);
    setError("");
    setMessage("");

    try {
      await persistRows(next);
      setMessage("تم تحديث ظهور القائمة.");
    } catch (cause) {
      updateRows(previous);
      setError(cause instanceof Error ? cause.message : "تعذر تحديث ظهور القائمة.");
    } finally {
      setBusy(false);
    }
  };

  const createList = async (name: string, description: string, iconKey: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await userDataService.createList(name, description, iconKey);
      setShowCreate(false);
      await load();
      setMessage("تم إنشاء القائمة.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر إنشاء القائمة.");
    } finally {
      setBusy(false);
    }
  };

  const updateList = async (name: string, description: string, iconKey: string) => {
    if (!editingId || busy) return;
    setBusy(true);
    setError("");
    try {
      await userDataService.updateList(editingId, name, description, iconKey);
      setEditingId(null);
      await load();
      setMessage("تم تعديل القائمة.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تعديل القائمة.");
    } finally {
      setBusy(false);
    }
  };

  const deleteList = async () => {
    if (!deletingId || busy) return;
    setBusy(true);
    setError("");
    try {
      await userDataService.deleteList(deletingId);
      setDeletingId(null);
      await load();
      setMessage("تم حذف القائمة.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر حذف القائمة.");
    } finally {
      setBusy(false);
    }
  };

  const editingList = lists.find((list) => list.id === editingId) ?? null;
  const deletingList = lists.find((list) => list.id === deletingId) ?? null;

  return (
    <section className="profile-content-editor profile-lists-manager" aria-labelledby="profile-lists-manager-title">
      <div className="profile-content-editor-heading">
        <div>
          <p className="eyebrow">القوائم</p>
          <h2 id="profile-lists-manager-title">إدارة القوائم</h2>
        </div>
        <button className="secondary" type="button" onClick={onClose} disabled={busy}>
          إغلاق
        </button>
      </div>

      <div className="profile-lists-manager-toolbar">
        <p className="muted">
          امسك الثلاث خطوط واسحب القائمة لمكانها. الحفظ تلقائي عند الإفلات.
        </p>
        <button className="primary" type="button" onClick={() => setShowCreate(true)} disabled={busy}>
          + قائمة جديدة
        </button>
      </div>

      {loading ? (
        <div className="profile-overview-skeleton" aria-label="جاري تحميل القوائم">
          <span className="section short" />
        </div>
      ) : (
        <div className="profile-lists-manager-rows">
          {rows.map((row) => (
            <div
              className={"profile-lists-manager-row" + (draggingKey === row.key ? " dragging" : "")}
              data-profile-list-key={row.key}
              key={row.key}
            >
              <button
                className="profile-list-drag-handle"
                type="button"
                aria-label={`اسحب لتغيير ترتيب ${row.name}`}
                title="اسحب لتغيير الترتيب"
                disabled={busy}
                onPointerDown={(event) => onPointerDown(event, row.key)}
                onPointerMove={onPointerMove}
                onPointerUp={(event) => void endDrag(event.pointerId)}
                onPointerCancel={(event) => void endDrag(event.pointerId, true)}
              >
                <span aria-hidden="true">☰</span>
              </button>

              <span className="profile-list-custom-icon" aria-hidden="true">
                <Icon name={row.iconKey} />
              </span>

              <div className="profile-lists-manager-name">
                <b dir="auto">{row.name}</b>
                <small>{row.itemCount} قصص</small>
              </div>

              <div className="profile-lists-manager-actions">
                <button
                  className="secondary"
                  type="button"
                  disabled={busy}
                  onClick={() => void toggleVisibility(row.key)}
                >
                  {row.isVisible ? "إخفاء" : "إظهار"}
                </button>

                {!row.system && row.referenceId && (
                  <>
                    <button
                      className="secondary"
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setError("");
                        setEditingId(row.referenceId);
                      }}
                    >
                      تعديل
                    </button>
                    <button
                      className="list-danger-button"
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setError("");
                        setDeletingId(row.referenceId);
                      }}
                    >
                      حذف
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {busy && <p className="muted profile-lists-manager-status">جاري الحفظ…</p>}
      {message && !busy && <p className="settings-feedback" role="status">{message}</p>}
      {error && <p className="error" role="alert">{error}</p>}

      <ListEditorDialog
        open={showCreate}
        title="إنشاء قائمة"
        submitLabel="إنشاء"
        busy={busy}
        error={showCreate ? error : ""}
        onClose={() => {
          if (!busy) {
            setError("");
            setShowCreate(false);
          }
        }}
        onSubmit={createList}
      />

      <ListEditorDialog
        open={Boolean(editingList)}
        title="تعديل القائمة"
        submitLabel="حفظ"
        initialName={editingList?.name ?? ""}
        initialDescription={editingList?.description ?? ""}
        initialIconKey={editingList?.iconKey ?? "lists"}
        busy={busy}
        error={editingList ? error : ""}
        onClose={() => {
          if (!busy) {
            setError("");
            setEditingId(null);
          }
        }}
        onSubmit={updateList}
      />

      {deletingList && (
        <div
          className="list-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) setDeletingId(null);
          }}
        >
          <section className="list-delete-dialog" role="alertdialog" aria-modal="true" aria-label="تأكيد حذف القائمة">
            <p className="eyebrow">تأكيد الحذف</p>
            <h2>حذف قائمة “{deletingList.name}”؟</h2>
            <p>القائمة فقط ستحذف. القصص وتقدم القراءة وسجل القراءة لن تتأثر.</p>
            <div className="list-dialog-actions">
              <button className="secondary" type="button" disabled={busy} onClick={() => setDeletingId(null)}>
                إلغاء
              </button>
              <button className="list-danger-confirm" type="button" disabled={busy} onClick={() => void deleteList()}>
                {busy ? "جاري الحذف…" : "حذف"}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
