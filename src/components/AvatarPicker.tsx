import { useEffect, useMemo, useState } from "react";
import { userDataService } from "../services/userData";
import type { Avatar, AvatarSeries } from "../types";

function AvatarChoiceImage({ avatar }: { avatar: Avatar }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [avatar.id, avatar.imageUrl]);

  return (
    <span className="avatar-picker-image">
      {avatar.imageUrl && !failed ? (
        <img
          src={avatar.imageUrl}
          alt={`صورة ${avatar.characterName}`}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <span role="img" aria-label={`صورة بديلة لـ ${avatar.characterName}`}>
          {avatar.characterName.slice(0, 1)}
        </span>
      )}
    </span>
  );
}

export function AvatarPicker({
  currentAvatarId,
  onSave,
  onClose,
}: {
  currentAvatarId: string | null;
  onSave: (avatarId: string) => Promise<void>;
  onClose: () => void;
}) {
  const [series, setSeries] = useState<AvatarSeries[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(currentAvatarId);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    userDataService
      .getAvatarLibrary()
      .then((next) => {
        if (active) setSeries(next);
      })
      .catch((cause) => {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : "تعذر تحميل مكتبة الصور الشخصية.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [busy, onClose]);

  const selected = useMemo(
    () =>
      series
        .flatMap((group) => group.avatars)
        .find((avatar) => avatar.id === selectedId) ?? null,
    [series, selectedId],
  );

  async function save() {
    if (!selectedId || busy) return;
    const previousId = currentAvatarId;
    setBusy(true);
    setError("");
    try {
      await onSave(selectedId);
      onClose();
    } catch (cause) {
      setSelectedId(previousId);
      setError(
        cause instanceof Error ? cause.message : "تعذر حفظ الصورة الشخصية.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="avatar-picker-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        className="avatar-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="avatar-picker-title"
      >
        <header className="avatar-picker-header">
          <div>
            <p className="eyebrow">مكتبة Wany</p>
            <h2 id="avatar-picker-title">اختيار الصورة الشخصية</h2>
          </div>
          <button
            className="avatar-picker-close"
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="إغلاق"
          >
            ×
          </button>
        </header>

        <div className="avatar-picker-preview">
          <div>
            <span className="muted">الصورة المختارة</span>
            <b>{selected?.characterName ?? "اختر شخصية"}</b>
            <small className="avatar-picker-preview-hint">
              {selected ? "جاهزة للحفظ" : "اضغط على أي صورة لاختيارها"}
            </small>
          </div>
          {selected ? (
            <AvatarChoiceImage avatar={selected} />
          ) : (
            <span className="avatar-picker-preview-empty">؟</span>
          )}
        </div>


        <div className="avatar-picker-content">
          {loading ? (
            <div
              className="avatar-picker-loading"
              aria-label="جاري تحميل الصور"
            >
              <span />
              <span />
              <span />
            </div>
          ) : series.length ? (
            series.map((group) => (
              <section
                className="avatar-series"
                key={group.id}
                aria-labelledby={`avatar-series-${group.id}`}
              >
                <div className="avatar-series-heading">
                  <h3 id={`avatar-series-${group.id}`}>{group.name}</h3>
                  <span>{group.avatars.length}</span>
                </div>
                <div className="avatar-row" role="list">
                  {group.avatars.map((avatar) => {
                    const selectedState = avatar.id === selectedId;
                    const currentState = avatar.id === currentAvatarId;
                    return (
                      <button
                        className={`avatar-option ${selectedState ? "selected" : ""}`}
                        type="button"
                        role="listitem"
                        key={avatar.id}
                        aria-pressed={selectedState}
                        aria-label={`اختيار ${avatar.characterName} من ${group.name}`}
                        title={avatar.characterName}
                        onClick={() => {
                          setError("");
                          setSelectedId(avatar.id);
                        }}
                      >
                        <span className="avatar-option-visual">
                          <AvatarChoiceImage avatar={avatar} />
                          {selectedState && (
                            <span
                              className="avatar-option-check"
                              aria-hidden="true"
                            >
                              ✓
                            </span>
                          )}
                        </span>
                        <span className="avatar-option-name">
                          {avatar.characterName}
                        </span>
                        {currentState && <small>محدد حاليًا</small>}
                      </button>
                    );
                  })}
                </div>
              </section>
            ))
          ) : (
            <div className="avatar-picker-empty">
              <b>لا توجد نتيجة</b>
              <span className="muted">جرّب اسم قصة أو شخصية أخرى.</span>
            </div>
          )}
        </div>

        <footer className="avatar-picker-footer">
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div>
            <button
              className="secondary"
              type="button"
              onClick={onClose}
              disabled={busy}
            >
              إلغاء
            </button>
            <button
              className="primary"
              type="button"
              disabled={!selectedId || selectedId === currentAvatarId || busy}
              onClick={() => void save()}
            >
              {busy ? "جاري الحفظ…" : "حفظ الصورة"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
