import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Link } from "react-router-dom";
import { ProfileSectionEditor } from "../components/ProfileSectionEditor";
import { SourceCoverImage } from "../components/SourceCoverImage";
import { useLibrary } from "../hooks/useLibrary";
import { getContinueChapter } from "../services/reading";
import { sourceDisplayTitle } from "../services/sourceTitles";
import { sourceService } from "../services/sources";
import { userDataService } from "../services/userData";
import type {
  LibraryEntry,
  SourceManga,
  UserProfileSection,
  UserProfileSectionInput,
} from "../types";

const PREVIEW_LIMIT = 6;

type ContinueCard = {
  entry: LibraryEntry;
  item: SourceManga;
  resumeChapter: number;
  percent: number;
};

function WorkStrip({
  title,
  items,
  to,
  emptyText,
}: {
  title: string;
  items: SourceManga[];
  to?: string;
  emptyText: string;
}) {
  return (
    <section className="profile-module">
      <div className="profile-module-heading">
        <h2>{title}</h2>
        {to && (
          <Link to={to}>
            عرض الكل <span aria-hidden="true">↗</span>
          </Link>
        )}
      </div>
      {items.length ? (
        <div className="profile-work-strip">
          {items.map((item) => {
            const titleText = sourceDisplayTitle(item);
            return (
              <Link
                className="profile-work-card"
                to={`/source/${encodeURIComponent(item.key)}`}
                key={item.key}
              >
                <span className="profile-work-cover">
                  {item.cover ? (
                    <SourceCoverImage
                      item={item}
                      alt={`غلاف ${titleText}`}
                      loading="lazy"
                    />
                  ) : (
                    <span className="source-cover-placeholder">
                      {titleText.slice(0, 1)}
                    </span>
                  )}
                </span>
                <b dir="auto">{titleText}</b>
                <small>{sourceService.sourceLabel(item.source)}</small>
              </Link>
            );
          })}
        </div>
      ) : (
        <p className="profile-module-empty">{emptyText}</p>
      )}
    </section>
  );
}

function ContinueReading({ cards }: { cards: ContinueCard[] }) {
  if (!cards.length) return null;
  return (
    <section className="profile-module">
      <div className="profile-module-heading">
        <h2>أكمل القراءة</h2>
      </div>
      <div className="profile-continue-strip">
        {cards.map(({ entry, item, resumeChapter, percent }) => {
          const titleText = sourceDisplayTitle(item);
          return (
            <Link
              className="profile-continue-card"
              key={entry.mangaId}
              to={`/read-source/${encodeURIComponent(item.key)}/${resumeChapter}`}
            >
              <span className="profile-work-cover">
                {item.cover ? (
                  <SourceCoverImage
                    item={item}
                    alt={`غلاف ${titleText}`}
                    loading="lazy"
                  />
                ) : (
                  <span className="source-cover-placeholder">
                    {titleText.slice(0, 1)}
                  </span>
                )}
              </span>
              <span className="profile-continue-copy">
                <b dir="auto">{titleText}</b>
                <small>متابعة من الفصل {resumeChapter}</small>
                <span
                  className="profile-mini-progress"
                  role="progressbar"
                  aria-label={`تقدم الفصل في ${titleText}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(percent)}
                >
                  <span style={{ width: `${percent}%` }} />
                </span>
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function toSaveInput(sections: UserProfileSection[]): UserProfileSectionInput[] {
  return sections.map((section) => ({
    sectionType: section.sectionType,
    referenceId: section.referenceId,
    isVisible: section.isVisible,
  }));
}

export function Home({ embedded = false }: { embedded?: boolean }) {
  const { user, data } = useLibrary();
  const [sections, setSections] = useState<UserProfileSection[]>([]);
  const [persistedSections, setPersistedSections] = useState<UserProfileSection[]>([]);
  const [works, setWorks] = useState<Record<string, SourceManga>>({});
  const [continueSeries, setContinueSeries] = useState<Record<string, SourceManga>>({});
  const [loadingSections, setLoadingSections] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [savingSections, setSavingSections] = useState(false);
  const [pageError, setPageError] = useState("");

  const loadSections = useCallback(async () => {
    setLoadingSections(true);
    setPageError("");
    try {
      const next = await userDataService.getProfileSections(PREVIEW_LIMIT);
      setSections(next);
      setPersistedSections(next);
    } catch (cause) {
      setPageError(
        cause instanceof Error ? cause.message : "تعذر تحميل ترتيب صفحتك.",
      );
    } finally {
      setLoadingSections(false);
    }
  }, []);

  useEffect(() => {
    void loadSections();
  }, [loadSections]);

  const visibleSections = useMemo(
    () => sections.filter((section) => section.isVisible),
    [sections],
  );

  const continueEntries = useMemo(
    () =>
      [...(data?.library ?? [])]
        .filter(
          (entry) =>
            entry.status === "reading" &&
            entry.lastReadAt != null &&
            entry.highestReachedChapter != null &&
            sourceService.isSourceKey(entry.mangaId),
        )
        .sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0))
        .slice(0, PREVIEW_LIMIT),
    [data?.library],
  );

  const continueVisible = visibleSections.some(
    (section) => section.sectionType === "continue_reading",
  );
  const favoritesVisible = visibleSections.some(
    (section) => section.sectionType === "favorites",
  );

  const workKeys = useMemo(() => {
    const keys = new Set<string>();
    if (continueVisible) {
      continueEntries.forEach((entry) => keys.add(entry.mangaId));
    }
    if (favoritesVisible) {
      (data?.favorites ?? [])
        .filter((id) => sourceService.isSourceKey(id))
        .slice(0, PREVIEW_LIMIT)
        .forEach((id) => keys.add(id));
    }
    visibleSections
      .filter((section) => section.sectionType === "custom_list")
      .forEach((section) =>
        section.previewItems
          .filter((id) => sourceService.isSourceKey(id))
          .slice(0, PREVIEW_LIMIT)
          .forEach((id) => keys.add(id)),
      );
    return [...keys];
  }, [
    continueEntries,
    continueVisible,
    data?.favorites,
    favoritesVisible,
    visibleSections,
  ]);

  useEffect(() => {
    let active = true;
    if (!workKeys.length) {
      setWorks({});
      return;
    }
    sourceService
      .resolve(workKeys)
      .then((items) => {
        if (active) {
          setWorks(Object.fromEntries(items.map((item) => [item.key, item])));
        }
      })
      .catch(() => {
        if (active) setWorks({});
      });
    return () => {
      active = false;
    };
  }, [workKeys.join("|")]);

  useEffect(() => {
    let active = true;
    const keys = continueVisible ? continueEntries.map((entry) => entry.mangaId) : [];
    if (!keys.length) {
      setContinueSeries({});
      return;
    }
    Promise.allSettled(keys.map((key) => sourceService.getSeries(key))).then(
      (results) => {
        if (!active) return;
        const entries = results.flatMap((result, index) =>
          result.status === "fulfilled"
            ? [[keys[index], result.value] as const]
            : [],
        );
        setContinueSeries(Object.fromEntries(entries));
      },
    );
    return () => {
      active = false;
    };
  }, [continueVisible, continueEntries.map((entry) => entry.mangaId).join("|")]);

  const continueCards = useMemo<ContinueCard[]>(
    () =>
      continueEntries.flatMap((entry) => {
        const item = continueSeries[entry.mangaId] ?? works[entry.mangaId];
        const highest = entry.highestReachedChapter;
        if (!item || highest == null) return [];
        const completed =
          data?.completed.includes(`${entry.mangaId}:${highest}`) ?? false;
        const resumeChapter = getContinueChapter(
          continueSeries[entry.mangaId]?.chapters,
          highest,
          completed,
        );
        const percent =
          data?.progress[`${entry.mangaId}:${highest}`]?.percent ?? 0;
        return [{ entry, item, resumeChapter, percent }];
      }),
    [continueEntries, continueSeries, data?.completed, data?.progress, works],
  );

  const favoriteItems = useMemo(
    () =>
      (data?.favorites ?? [])
        .filter((id) => sourceService.isSourceKey(id))
        .slice(0, PREVIEW_LIMIT)
        .map((id) => works[id])
        .filter((item): item is SourceManga => Boolean(item)),
    [data?.favorites, works],
  );

  const saveSections = async () => {
    if (savingSections) return;
    const rollback = persistedSections;
    const optimistic = sections;
    setSavingSections(true);
    setPageError("");
    setEditMode(false);
    try {
      const saved = await userDataService.saveProfileSections(
        toSaveInput(optimistic),
      );
      setSections(saved);
      setPersistedSections(saved);
    } catch (cause) {
      setSections(rollback);
      setPersistedSections(rollback);
      setEditMode(true);
      setPageError(
        cause instanceof Error ? cause.message : "تعذر حفظ ترتيب الصفحة.",
      );
    } finally {
      setSavingSections(false);
    }
  };

  const cancelEdit = () => {
    if (savingSections) return;
    setSections(persistedSections);
    setPageError("");
    setEditMode(false);
  };

  const renderSection = (section: UserProfileSection) => {
    if (section.sectionType === "continue_reading") {
      return <ContinueReading key={section.key} cards={continueCards} />;
    }

    if (section.sectionType === "favorites") {
      return (
        <WorkStrip
          key={section.key}
          title="المفضلة"
          items={favoriteItems}
          to="/favorites"
          emptyText="ما أضفت أعمالًا إلى المفضلة حتى الآن."
        />
      );
    }

    const list = section.list;
    if (!list) return null;
    const items = section.previewItems
      .map((id) => works[id])
      .filter((item): item is SourceManga => Boolean(item));
    return (
      <WorkStrip
        key={section.key}
        title={list.name}
        items={items}
        to={`/lists/${encodeURIComponent(list.id)}`}
        emptyText="لا توجد أعمال في هذه القائمة حتى الآن."
      />
    );
  };

  return (
    <>
      {embedded ? (
        <div className="account-home-toolbar">
          <button
            className="secondary"
            type="button"
            onClick={() => {
              setPageError("");
              setEditMode(true);
            }}
            disabled={loadingSections || savingSections}
          >
            تعديل الصفحة
          </button>
        </div>
      ) : (
        <section className="profile-dashboard-header">
          <div className="profile-dashboard-identity">
            <span className="avatar profile-dashboard-avatar">
              {user?.name?.slice(0, 1)}
            </span>
            <div>
              <p className="eyebrow">مساحتك الشخصية</p>
              <h1>
                {user?.name}
                <span className="accent">.</span>
              </h1>
              <p className="muted">@{user?.username}</p>
            </div>
          </div>
          <div className="profile-dashboard-actions">
            <Link className="secondary" to="/profile?tab=settings">
              الإعدادات
            </Link>
            <button
              className="secondary"
              type="button"
              onClick={() => {
                setPageError("");
                setEditMode(true);
              }}
              disabled={loadingSections || savingSections}
            >
              تعديل الصفحة
            </button>
          </div>
        </section>
      )}

      {pageError && !editMode && (
        <p className="error profile-dashboard-error" role="alert">
          {pageError}
        </p>
      )}

      {editMode ? (
        <ProfileSectionEditor
          sections={sections}
          busy={savingSections}
          error={pageError}
          onChange={setSections}
          onDone={() => void saveSections()}
          onCancel={cancelEdit}
        />
      ) : loadingSections ? (
        <div className="profile-modules-loading" aria-label="جاري تحميل صفحتك">
          <span />
          <span />
          <span />
        </div>
      ) : (
        <div className="profile-modules">
          {visibleSections.map(renderSection)}
          {!visibleSections.length && (
            <div className="profile-all-hidden">
              <h2>كل الأقسام مخفية</h2>
              <p className="muted">
                استخدم “تعديل الصفحة” لإظهار الأقسام التي تريدها.
              </p>
            </div>
          )}
        </div>
      )}

      {!embedded && (
        <footer className="page-footer">مكان هادي وقصة حلوة في أي وقت.</footer>
      )}
    </>
  );
}
