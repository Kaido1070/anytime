import { useCallback, useEffect, useState } from "react";
import { ListEditorDialog } from "./ListEditorDialog";
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
  itemCount: number;
  isVisible: boolean;
  system: boolean;
};

function isManagedListSection(section: UserProfileSection) {
  return section.sectionType === "favorites" || section.sectionType === "custom_list";
}

function rowsFromData(
  sections: UserProfileSection[],
  lists: UserListSummary[],
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
        itemCount: 0,
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

    const replacement = listRows[listIndex];
    listIndex += 1;
    return (
      replacement ?? {
        sectionType: section.sectionType,
        referenceId: section.referenceId,
        isVisible: section.isVisible,
      }
    );
  });
}

export function ProfileListsManager({
  onClose,
}: {
  onClose: () => void;
}) {
  const [sections, setSections] = useState<UserProfileSection[]>([]);
  const [lists, setLists] = useState<UserListSummary[]>([]);
  const [rows, setRows] = useState<ListRow[]>([]);
  const [favoritesCount, setFavoritesCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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
      setFavoritesCount(data.favorites.length);
      const nextRows = rowsFromData(nextSections, nextLists).map((row) =>
        row.system ? { ...row, itemCount: data.favorites.length } : row,
      );
      setRows(nextRows);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تحميل القوائم.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const persistRows = async (nextRows: ListRow[]) => {
    const saved = await userDataService.saveProfileSections(
      buildSectionPayload(sections, nextRows),
    );
    setSections(saved);
    setRows(
      rowsFromData(saved, lists).map((row) =>
        row.system ? { ...row, itemCount: favoritesCount } : row,
      ),
    );
  };

  const move = async (index: number, delta: number) => {
    const target = index + delta;
    if (busy || target < 0 || target >= rows.length) return;

    const previous = rows;
    const next = [...rows];
    const [moving] = next.splice(index, 1);
    next.splice(target, 0, moving);
    setRows(next);
    setBusy(true);
    setError("");
    setMessage("");

    try {
      await persistRows(next);
      setMessage("تم تحديث ترتيب القوائم.");
    } catch (cause) {
      setRows(previous);
      setError(cause instanceof Error ? cause.message : "تعذر حفظ ترتيب القوائم.");
    } finally {
      setBusy(false);
    }
  };

  const toggleVisibility = async (key: string) => {
    if (busy) return;
    const previous = rows;
    const next = rows.map((row) =>
      row.key === key ? { ...row, isVisible: !row.isVisible } : row,
    );
    setRows(next);
    setBusy(true);
    setError("");
    setMessage("");

    try {
      await persistRows(next);
      setMessage("تم تحديث ظهور القائمة.");
    } catch (cause) {
      setRows(previous);
      setError(cause instanceof Error ? cause.message : "تعذر تحديث ظهور القائمة.");
    } finally {
      setBusy(false);
    }
  };

  const createList = async (name: string, description: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await userDataService.createList(name, description);
      setShowCreate(false);
      await load();
      setMessage("تم إنشاء القائمة.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر إنشاء القائمة.");
    } finally {
      setBusy(false);
    }
  };

  const updateList = async (name: string, description: string) => {
    if (!editingId || busy) return;
    setBusy(true);
    setError("");
    try {
      await userDataService.updateList(editingId, name, description);
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
          رتّب القوائم من الأسهم، وعدّل الاسم أو احذف القائمة مباشرة.
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
          {rows.map((row, index) => (
            <div className="profile-lists-manager-row" key={row.key}>
              <div className="profile-lists-manager-main">
                <div className="profile-lists-manager-name">
                  <b dir="auto">{row.name}</b>
                  <small>{row.itemCount} قصص</small>
                </div>

                <div className="profile-lists-manager-order" aria-label={`ترتيب ${row.name}`}>
                  <button
                    type="button"
                    disabled={busy || index === 0}
                    aria-label={`رفع ${row.name}`}
                    onClick={() => void move(index, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={busy || index === rows.length - 1}
                    aria-label={`خفض ${row.name}`}
                    onClick={() => void move(index, 1)}
                  >
                    ↓
                  </button>
                </div>
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
