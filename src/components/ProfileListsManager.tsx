import { useCallback, useEffect, useMemo, useState } from "react";
import { ListEditorDialog } from "./ListEditorDialog";
import { userDataService } from "../services/userData";
import type { UserListSummary, UserProfileSection, UserProfileSectionInput } from "../types";

type EditableListRow = {
  key: string;
  sectionType: "favorites" | "custom_list";
  referenceId: string | null;
  name: string;
  description: string | null;
  isVisible: boolean;
  system: boolean;
};

function isListSection(section: UserProfileSection) {
  return section.sectionType === "favorites" || section.sectionType === "custom_list";
}

function buildRows(
  sections: UserProfileSection[],
  lists: UserListSummary[],
): EditableListRow[] {
  const byId = new Map(lists.map((list) => [list.id, list]));
  return sections
    .filter(isListSection)
    .sort((a, b) => a.position - b.position || a.key.localeCompare(b.key))
    .flatMap((section) => {
      if (section.sectionType === "favorites") {
        return [{
          key: section.key,
          sectionType: "favorites" as const,
          referenceId: null,
          name: "المفضلة",
          description: "قائمة نظامية",
          isVisible: section.isVisible,
          system: true,
        }];
      }
      const list = section.referenceId ? byId.get(section.referenceId) : null;
      if (!list) return [];
      return [{
        key: section.key,
        sectionType: "custom_list" as const,
        referenceId: list.id,
        name: list.name,
        description: list.description,
        isVisible: section.isVisible,
        system: false,
      }];
    });
}

function buildSectionPayload(
  sections: UserProfileSection[],
  rows: EditableListRow[],
): UserProfileSectionInput[] {
  const ordered = [...sections].sort(
    (a, b) => a.position - b.position || a.key.localeCompare(b.key),
  );
  const replacements = rows.map((row) => ({
    sectionType: row.sectionType,
    referenceId: row.referenceId,
    isVisible: row.isVisible,
  }));
  let listIndex = 0;

  return ordered.map((section) => {
    if (!isListSection(section)) {
      return {
        sectionType: section.sectionType,
        referenceId: section.referenceId,
        isVisible: section.isVisible,
      };
    }
    const replacement = replacements[listIndex++];
    return replacement ?? {
      sectionType: section.sectionType,
      referenceId: section.referenceId,
      isVisible: section.isVisible,
    };
  });
}

export function ProfileListsManager({
  onClose,
}: {
  onClose: () => void;
}) {
  const [sections, setSections] = useState<UserProfileSection[]>([]);
  const [lists, setLists] = useState<UserListSummary[]>([]);
  const [rows, setRows] = useState<EditableListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [nextSections, nextLists] = await Promise.all([
        userDataService.getProfileSections(10),
        userDataService.getLists(),
      ]);
      setSections(nextSections);
      setLists(nextLists);
      setRows(buildRows(nextSections, nextLists));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تحميل إدارة القوائم.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const editingList = useMemo(
    () => lists.find((list) => list.id === editingId) ?? null,
    [editingId, lists],
  );
  const deletingList = useMemo(
    () => lists.find((list) => list.id === deletingId) ?? null,
    [deletingId, lists],
  );

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= rows.length || busy) return;
    const next = [...rows];
    const [moving] = next.splice(index, 1);
    next.splice(target, 0, moving);
    setRows(next);
    setMessage("");
  };

  const saveOrder = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const saved = await userDataService.saveProfileSections(
        buildSectionPayload(sections, rows),
      );
      setSections(saved);
      setRows(buildRows(saved, lists));
      setMessage("تم حفظ ترتيب القوائم.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر حفظ ترتيب القوائم.");
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
      setMessage("تم تحديث القائمة.");
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

  return (
    <section className="profile-content-editor" aria-labelledby="profile-lists-manager-title">
      <div className="profile-content-editor-heading">
        <div>
          <p className="eyebrow">القوائم</p>
          <h2 id="profile-lists-manager-title">إدارة القوائم</h2>
        </div>
        <button className="secondary" type="button" onClick={onClose} disabled={busy}>
          إغلاق
        </button>
      </div>

      <div className="profile-content-editor-heading">
        <p className="muted profile-content-editor-hint">
          إنشاء، تعديل، حذف، إظهار وترتيب القوائم من مكان واحد.
        </p>
        <button className="primary" type="button" onClick={() => setShowCreate(true)} disabled={busy}>
          + إنشاء قائمة
        </button>
      </div>

      {loading ? (
        <div className="profile-overview-skeleton" aria-label="جاري تحميل القوائم">
          <span className="section" />
        </div>
      ) : (
        <div className="profile-content-editor-list">
          {rows.map((row, index) => (
            <div className="profile-content-editor-row" key={row.key}>
              <span className="profile-content-drag" aria-hidden="true">☰</span>
              <div>
                <b dir="auto">{row.name}</b>
                {row.description && <small className="muted" dir="auto">{row.description}</small>}
              </div>

              <div className="profile-content-move">
                <button
                  type="button"
                  disabled={busy || index === 0}
                  aria-label={`تحريك ${row.name} للأعلى`}
                  onClick={() => move(index, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  disabled={busy || index === rows.length - 1}
                  aria-label={`تحريك ${row.name} للأسفل`}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </button>
              </div>

              <button
                className="profile-content-visibility"
                type="button"
                aria-pressed={row.isVisible}
                disabled={busy}
                onClick={() =>
                  setRows((current) =>
                    current.map((item) =>
                      item.key === row.key
                        ? { ...item, isVisible: !item.isVisible }
                        : item,
                    ),
                  )
                }
              >
                {row.isVisible ? "ظاهر" : "مخفي"}
              </button>

              {!row.system && row.referenceId && (
                <div className="profile-content-move">
                  <button
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
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {!loading && (
        <div className="settings-actions">
          <button className="primary" type="button" onClick={() => void saveOrder()} disabled={busy}>
            {busy ? "جاري الحفظ…" : "حفظ الترتيب والتغييرات"}
          </button>
        </div>
      )}

      {message && <p className="settings-feedback" role="status">{message}</p>}
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
            <p>سيتم حذف القائمة فقط. القصص وتقدم القراءة وسجل القراءة لن تتأثر.</p>
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
