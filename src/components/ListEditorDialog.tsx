import { useEffect, useState, type FormEvent } from "react";
import { Icon } from "./UI";

export function ListEditorDialog({
  open,
  title,
  submitLabel,
  initialName = "",
  initialDescription = "",
  initialIconKey = "lists",
  busy = false,
  error = "",
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  submitLabel: string;
  initialName?: string;
  initialDescription?: string | null;
  initialIconKey?: string;
  busy?: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (name: string, description: string, iconKey: string) => Promise<void> | void;
}) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription ?? "");
  const [iconKey, setIconKey] = useState(initialIconKey);

  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setDescription(initialDescription ?? "");
    setIconKey(initialIconKey);
  }, [open, initialName, initialDescription, initialIconKey]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, busy, onClose]);

  if (!open) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const normalized = name.trim();
    if (!normalized || busy) return;
    await onSubmit(normalized, description.trim(), iconKey);
  };

  return (
    <div
      className="list-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section className="list-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="list-dialog-header">
          <div>
            <p className="eyebrow">قائمة شخصية</p>
            <h2>{title}</h2>
          </div>
          <button className="list-dialog-close" type="button" onClick={onClose} disabled={busy} aria-label="إغلاق">
            ×
          </button>
        </div>
        <form onSubmit={(event) => void submit(event)}>
          <label>
            اسم القائمة <span aria-hidden="true">*</span>
            <input
              autoFocus
              required
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="مثال: موريم"
            />
          </label>
          <label>
            الوصف <small>اختياري</small>
            <textarea
              maxLength={500}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="وصف مختصر للقائمة"
            />
          </label>
          <fieldset className="list-icon-picker">
            <legend>أيقونة القائمة</legend>
            <div className="list-icon-grid">
              {[
                ["lists", "قائمة"],
                ["book", "كتاب"],
                ["star", "نجمة"],
                ["heart", "قلب"],
                ["flame", "نار"],
                ["sword", "سيف"],
                ["crown", "تاج"],
                ["ghost", "شبح"],
                ["moon", "قمر"],
                ["bolt", "برق"],
                ["mask", "قناع"],
                ["dragon", "تنين"],
                ["spark", "لمعة"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={iconKey === key ? "active" : ""}
                  aria-pressed={iconKey === key}
                  aria-label={label}
                  title={label}
                  onClick={() => setIconKey(key)}
                >
                  <Icon name={key} />
                </button>
              ))}
            </div>
          </fieldset>
          {error && <p className="error">{error}</p>}
          <div className="list-dialog-actions">
            <button className="secondary" type="button" onClick={onClose} disabled={busy}>إلغاء</button>
            <button className="primary" disabled={busy || !name.trim()}>
              {busy ? "جاري الحفظ…" : submitLabel}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
