import { Lists } from "../pages/Lists";

export function ProfileListsManager({
  onClose,
}: {
  onClose: () => void;
}) {
  return (
    <section className="profile-content-editor" aria-labelledby="profile-lists-manager-title">
      <div className="profile-content-editor-heading">
        <div>
          <p className="eyebrow">القوائم</p>
          <h2 id="profile-lists-manager-title">إدارة القوائم</h2>
        </div>
        <button className="secondary" type="button" onClick={onClose}>
          إغلاق
        </button>
      </div>

      <p className="muted profile-content-editor-hint">
        أنشئ قائمة جديدة أو افتح أي قائمة لتعديل اسمها ووصفها وترتيب القصص أو حذفها.
      </p>

      <Lists embedded />
    </section>
  );
}
