import {
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { UserProfileSection } from "../types";

type DragState = {
  key: string;
  pointerId: number;
  snapshot: UserProfileSection[];
};

function moveSection(
  sections: UserProfileSection[],
  movingKey: string,
  targetKey: string,
  after: boolean,
) {
  const moving = sections.find((section) => section.key === movingKey);
  if (!moving || movingKey === targetKey) return sections;
  const remaining = sections.filter((section) => section.key !== movingKey);
  const targetIndex = remaining.findIndex((section) => section.key === targetKey);
  if (targetIndex < 0) return sections;
  const next = [...remaining];
  next.splice(targetIndex + (after ? 1 : 0), 0, moving);
  return next;
}

function sectionLabel(section: UserProfileSection) {
  if (section.sectionType === "continue_reading") return "أكمل القراءة";
  if (section.sectionType === "favorites") return "المفضلة";
  return section.list?.name ?? "قائمة شخصية";
}

export function ProfileSectionEditor({
  sections,
  busy,
  error,
  onChange,
  onDone,
  onCancel,
}: {
  sections: UserProfileSection[];
  busy: boolean;
  error: string;
  onChange: (sections: UserProfileSection[]) => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const sectionsRef = useRef(sections);
  const dragRef = useRef<DragState | null>(null);

  useEffect(() => {
    sectionsRef.current = sections;
  }, [sections]);

  const update = (next: UserProfileSection[]) => {
    sectionsRef.current = next;
    onChange(next);
  };

  const endDrag = (pointerId: number, cancelled = false) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== pointerId) return;
    dragRef.current = null;
    if (cancelled) update(drag.snapshot);
  };

  const onPointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    key: string,
  ) => {
    if (busy || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      key,
      pointerId: event.pointerId,
      snapshot: [...sectionsRef.current],
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();

    const target = document
      .elementsFromPoint(event.clientX, event.clientY)
      .map((element) => element.closest<HTMLElement>("[data-profile-section-key]"))
      .find(
        (element) =>
          element?.dataset.profileSectionKey &&
          element.dataset.profileSectionKey !== drag.key,
      );
    const targetKey = target?.dataset.profileSectionKey;
    if (!target || !targetKey) return;

    const edge = Math.min(96, window.innerHeight * 0.18);
    if (event.clientY < edge) window.scrollBy({ top: -18, behavior: "auto" });
    else if (event.clientY > window.innerHeight - edge) {
      window.scrollBy({ top: 18, behavior: "auto" });
    }

    const rect = target.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    const next = moveSection(sectionsRef.current, drag.key, targetKey, after);
    if (next !== sectionsRef.current) update(next);
  };

  const moveByKeyboard = (key: string, delta: number) => {
    if (busy) return;
    const visible = sectionsRef.current.filter((section) => section.isVisible);
    const index = visible.findIndex((section) => section.key === key);
    const target = visible[index + delta];
    if (index < 0 || !target) return;
    const next = moveSection(
      sectionsRef.current,
      key,
      target.key,
      delta > 0,
    );
    if (next !== sectionsRef.current) update(next);
  };

  const toggleVisibility = (key: string, isVisible: boolean) => {
    if (busy) return;
    update(
      sectionsRef.current.map((section) =>
        section.key === key ? { ...section, isVisible } : section,
      ),
    );
  };

  const visible = sections.filter((section) => section.isVisible);
  const hidden = sections.filter((section) => !section.isVisible);

  return (
    <section className="profile-editor" aria-label="تعديل أقسام الصفحة">
      <div className="profile-editor-toolbar">
        <div>
          <p className="eyebrow">تخصيص الصفحة</p>
          <h2>تعديل الصفحة</h2>
        </div>
        <div className="profile-editor-actions">
          <button className="secondary" type="button" onClick={onCancel} disabled={busy}>
            إلغاء
          </button>
          <button className="primary" type="button" onClick={onDone} disabled={busy}>
            {busy ? "جاري الحفظ…" : "تم"}
          </button>
        </div>
      </div>

      <p className="profile-editor-hint">
        اسحب من المقبض لتغيير الترتيب. على لوحة المفاتيح استخدم السهمين للأعلى والأسفل.
      </p>

      <div className="profile-editor-list">
        {visible.map((section, index) => (
          <div
            className="profile-editor-row"
            data-profile-section-key={section.key}
            key={section.key}
          >
            <button
              className="profile-section-drag"
              type="button"
              aria-label={`تغيير ترتيب ${sectionLabel(section)}. الموضع الحالي ${index + 1}`}
              title="اسحب لتغيير الترتيب"
              onPointerDown={(event) => onPointerDown(event, section.key)}
              onPointerMove={onPointerMove}
              onPointerUp={(event) => endDrag(event.pointerId)}
              onPointerCancel={(event) => endDrag(event.pointerId, true)}
              onKeyDown={(event) => {
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  moveByKeyboard(section.key, -1);
                }
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  moveByKeyboard(section.key, 1);
                }
              }}
            >
              <span aria-hidden="true">☰</span>
            </button>
            <div className="profile-editor-copy">
              <b>{sectionLabel(section)}</b>
              <small>
                {section.sectionType === "custom_list"
                  ? `${section.list?.itemCount ?? 0} عمل`
                  : "قسم تلقائي"}
              </small>
            </div>
            <button
              className="profile-visibility-button"
              type="button"
              onClick={() => toggleVisibility(section.key, false)}
              disabled={busy}
              aria-label={`إخفاء ${sectionLabel(section)}`}
            >
              إخفاء
            </button>
          </div>
        ))}
      </div>

      {hidden.length > 0 && (
        <div className="profile-hidden-sections">
          <h3>الأقسام المخفية</h3>
          <div>
            {hidden.map((section) => (
              <button
                key={section.key}
                type="button"
                onClick={() => toggleVisibility(section.key, true)}
                disabled={busy}
              >
                <span aria-hidden="true">+</span>
                {sectionLabel(section)}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && <p className="error profile-editor-error">{error}</p>}
    </section>
  );
}
