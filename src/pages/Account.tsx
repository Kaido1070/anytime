import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ActivityFeed } from "../components/ActivityFeed";
import { AvatarPicker } from "../components/AvatarPicker";
import {
  ProfileActivitySection,
  ProfileIdentityHeader,
  ProfileListsSection,
  ProfileOverviewSkeleton,
  ProfileReadingSection,
  ProfileStatsSection,
  type ProfileReadingIssue,
  type ProfileAchievementSummaryItem,
} from "../components/ProfileOverview";
import { Icon } from "../components/UI";
import { ProfileListsManager } from "../components/ProfileListsManager";
import { SectionErrorBoundary } from "../components/SectionErrorBoundary";
import { ReadingStatsDashboard } from "../components/ReadingStatsDashboard";
import { useLibrary } from "../hooks/useLibrary";
import { sourceDisplayTitle } from "../services/sourceTitles";
import type { SourceName } from "../types";
import { sourceService } from "../services/sources";
import { saveWorkSnapshot, snapshotToSourceManga } from "../services/workSnapshots";
import { PERSONALIZATION_CHANGE_EVENT, userDataService } from "../services/userData";
import type {
  ActivityEvent,
  ProfileLibraryItem,
  SourceManga,
  UserProfileSection,
  UserProfileSectionInput,
  UserProfileView,
  ReadingStats,
} from "../types";
import { Profile } from "./Profile";

type ContentGroupId = "lists" | "reading" | "activity";

function sourceFromKey(key: string): SourceName | null {
  const prefix = key.split(":", 1)[0];
  if (prefix === "mt") return "mangatime";
  if (prefix === "tx") return "teamx";
  if (prefix === "aq") return "3asq";
  if (prefix === "sz") return "starzmanga";
  if (prefix === "xs") return "xsano";
  if (prefix === "ml") return "mangalik";
  return null;
}

type ContentGroup = {
  id: ContentGroupId;
  label: string;
  visible: boolean;
  position: number;
};

const PROFILE_PREVIEW_LIMIT = 4;

function groupIdForSection(section: UserProfileSection): ContentGroupId | null {
  if (section.sectionType === "favorites" || section.sectionType === "custom_list") {
    return "lists";
  }
  if (section.sectionType === "continue_reading") return "reading";
  if (section.sectionType === "my_activity") return "activity";
  return null;
}

function buildContentGroups(sections: UserProfileSection[]): ContentGroup[] {
  const definitions: Array<{ id: ContentGroupId; label: string; fallback: number }> = [
    { id: "reading", label: "أقرأ الآن", fallback: 1024 },
    { id: "lists", label: "القوائم", fallback: 2048 },
    { id: "activity", label: "آخر النشاط", fallback: 3072 },
  ];

  return definitions
    .map((definition) => {
      const rows = sections.filter((section) => groupIdForSection(section) === definition.id);
      return {
        id: definition.id,
        label: definition.label,
        visible: rows.length ? rows.some((section) => section.isVisible) : true,
        position: rows.length
          ? Math.min(...rows.map((section) => Number(section.position)))
          : definition.fallback,
      };
    })
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

function sectionsForSave(
  sections: UserProfileSection[],
  groups: ContentGroup[],
): UserProfileSectionInput[] {
  const buckets = new Map<ContentGroupId, UserProfileSection[]>();
  for (const group of groups) buckets.set(group.id, []);
  const passthrough: UserProfileSection[] = [];

  for (const section of sections) {
    const id = groupIdForSection(section);
    if (!id) {
      passthrough.push(section);
      continue;
    }
    buckets.get(id)?.push(section);
  }

  const ordered: UserProfileSectionInput[] = [];
  for (const group of groups) {
    const rows = [...(buckets.get(group.id) ?? [])].sort(
      (a, b) => a.position - b.position || a.key.localeCompare(b.key),
    );
    for (const row of rows) {
      ordered.push({
        sectionType: row.sectionType,
        referenceId: row.referenceId,
        isVisible: group.visible,
      });
    }
  }

  for (const row of passthrough.sort(
    (a, b) => a.position - b.position || a.key.localeCompare(b.key),
  )) {
    ordered.push({
      sectionType: row.sectionType,
      referenceId: row.referenceId,
      isVisible: row.isVisible,
    });
  }

  return ordered;
}

async function resolveWorks(keys: string[]) {
  const unique = [...new Set(keys)].filter(sourceService.isSourceKey);
  const chunks: string[][] = [];
  for (let index = 0; index < unique.length; index += 60) {
    chunks.push(unique.slice(index, index + 60));
  }
  const settled = await Promise.allSettled(chunks.map((chunk) => sourceService.resolve(chunk)));
  return {
    works: Object.fromEntries(
      settled
        .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
        .map((item) => [item.key, item]),
    ),
    partialFailure: settled.some((result) => result.status === "rejected"),
  };
}

async function loadCachedSeries(keys: string[]) {
  const unique = [...new Set(keys)].filter(sourceService.isSourceKey);
  if (!unique.length) return {} as Record<string, SourceManga>;

  const [snapshots, resolved] = await Promise.all([
    userDataService.getWorkSnapshots(unique).catch(() => []),
    // resolve() is D1-backed metadata only and does not contact upstream sites.
    // Prefer it over an archived snapshot when available so transient source
    // failures do not downgrade every account card to "archived".
    sourceService.resolve(unique).catch(() => []),
  ]);

  const mapped: Record<string, SourceManga> = Object.fromEntries(
    snapshots.map((snapshot) => [
      snapshot.mangaId,
      snapshotToSourceManga(snapshot),
    ]),
  );

  for (const item of resolved) {
    mapped[item.key] = item;
    void saveWorkSnapshot(item);
  }

  return mapped;
}

function ProfileContentEditor({
  groups,
  busy,
  error,
  onChange,
  onSave,
  onCancel,
}: {
  groups: ContentGroup[];
  busy: boolean;
  error: string;
  onChange: (groups: ContentGroup[]) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= groups.length) return;
    const next = [...groups];
    const [moving] = next.splice(index, 1);
    next.splice(target, 0, moving);
    onChange(next);
  };

  return (
    <section className="profile-content-editor" aria-labelledby="profile-customize-title">
      <div className="profile-content-editor-heading">
        <div>
          <p className="eyebrow">تخصيص الحساب</p>
          <h2 id="profile-customize-title">ترتيب أقسام المحتوى</h2>
        </div>
        <div>
          <button className="secondary" type="button" onClick={onCancel} disabled={busy}>
            إلغاء
          </button>
          <button className="primary" type="button" onClick={onSave} disabled={busy}>
            {busy ? "جاري الحفظ…" : "حفظ"}
          </button>
        </div>
      </div>
      <p className="muted profile-content-editor-hint">
        الهوية والإحصائيات ثابتة. يمكنك ترتيب أقسام المحتوى أو إخفاءها فقط.
      </p>
      <div className="profile-content-editor-list">
        {groups.map((group, index) => (
          <div className="profile-content-editor-row" key={group.id}>
            <span className="profile-content-drag" aria-hidden="true">☰</span>
            <b>{group.label}</b>
            <div className="profile-content-move">
              <button
                type="button"
                disabled={busy || index === 0}
                aria-label={`تحريك ${group.label} للأعلى`}
                onClick={() => move(index, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                disabled={busy || index === groups.length - 1}
                aria-label={`تحريك ${group.label} للأسفل`}
                onClick={() => move(index, 1)}
              >
                ↓
              </button>
            </div>
            <button
              className="profile-content-visibility"
              type="button"
              aria-pressed={group.visible}
              onClick={() =>
                onChange(
                  groups.map((entry) =>
                    entry.id === group.id ? { ...entry, visible: !entry.visible } : entry,
                  ),
                )
              }
              disabled={busy}
            >
              {group.visible ? "ظاهر" : "مخفي"}
            </button>
          </div>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function ProfileListsEditor({
  sections,
  lists,
  busy,
  error,
  onSave,
  onCancel,
}: {
  sections: UserProfileSection[];
  lists: UserProfileView["lists"];
  busy: boolean;
  error: string;
  onSave: (sections: UserProfileSection[]) => void;
  onCancel: () => void;
}) {
  const initial = sections
    .filter((section) => groupIdForSection(section) === "lists")
    .sort((a, b) => a.position - b.position || a.key.localeCompare(b.key));
  const [items, setItems] = useState(initial);

  useEffect(() => {
    setItems(initial);
  }, [sections]);

  const labelFor = (section: UserProfileSection) => {
    if (section.sectionType === "favorites") return "المفضلة";
    return lists?.find((list) => list.id === section.referenceId)?.name ?? "قائمة";
  };

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    const [moving] = next.splice(index, 1);
    next.splice(target, 0, moving);
    setItems(next);
  };

  return (
    <section className="profile-content-editor" aria-labelledby="profile-lists-customize-title">
      <div className="profile-content-editor-heading">
        <div>
          <p className="eyebrow">القوائم</p>
          <h2 id="profile-lists-customize-title">ترتيب القوائم</h2>
        </div>
        <div>
          <button className="secondary" type="button" onClick={onCancel} disabled={busy}>
            إلغاء
          </button>
          <button className="primary" type="button" onClick={() => onSave(items)} disabled={busy}>
            {busy ? "جاري الحفظ…" : "حفظ"}
          </button>
        </div>
      </div>
      <p className="muted profile-content-editor-hint">
        هذا التعديل خاص بالقوائم فقط ولا يغيّر ترتيب أقرأ الآن أو النشاط.
      </p>
      <div className="profile-content-editor-list">
        {items.map((section, index) => (
          <div className="profile-content-editor-row" key={section.key}>
            <span className="profile-content-drag" aria-hidden="true">☰</span>
            <b dir="auto">{labelFor(section)}</b>
            <div className="profile-content-move">
              <button
                type="button"
                disabled={busy || index === 0}
                aria-label={`تحريك ${labelFor(section)} للأعلى`}
                onClick={() => move(index, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                disabled={busy || index === items.length - 1}
                aria-label={`تحريك ${labelFor(section)} للأسفل`}
                onClick={() => move(index, 1)}
              >
                ↓
              </button>
            </div>
            <button
              className="profile-content-visibility"
              type="button"
              aria-pressed={section.isVisible}
              onClick={() =>
                setItems((current) =>
                  current.map((entry) =>
                    entry.key === section.key
                      ? { ...entry, isVisible: !entry.isVisible }
                      : entry,
                  ),
                )
              }
              disabled={busy}
            >
              {section.isVisible ? "ظاهر" : "مخفي"}
            </button>
          </div>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function FullActivityView() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async (offset = 0) => {
    const feed = await userDataService.getMyActivity(20, offset);
    setEvents((current) => (offset ? [...current, ...feed.events] : feed.events));
    setHasMore(feed.hasMore);
  }, []);

  useEffect(() => {
    setLoading(true);
    setError("");
    load()
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : "تعذر تحميل النشاط."),
      )
      .finally(() => setLoading(false));
  }, [load]);

  return (
    <section className="profile-subview">
      <div className="profile-subview-heading">
        <div>
          <p className="eyebrow">حسابي</p>
          <h2>النشاط</h2>
        </div>
        <Link className="secondary" to="/profile">العودة</Link>
      </div>
      {loading ? (
        <div className="profile-overview-skeleton"><span className="section" /></div>
      ) : error && !events.length ? (
        <div className="profile-section-error">
          <span>{error}</span>
          <button className="secondary" type="button" onClick={() => void load()}>إعادة المحاولة</button>
        </div>
      ) : (
        <>
          <ActivityFeed
            title="كل النشاط"
            events={events}
            emptyText="لا يوجد نشاط حتى الآن."
          />
          {hasMore && (
            <button
              className="secondary profile-load-more"
              type="button"
              disabled={loadingMore}
              onClick={() => {
                setLoadingMore(true);
                load(events.length)
                  .catch((cause) =>
                    setError(cause instanceof Error ? cause.message : "تعذر تحميل المزيد."),
                  )
                  .finally(() => setLoadingMore(false));
              }}
            >
              {loadingMore ? "جاري التحميل…" : "تحميل المزيد"}
            </button>
          )}
          {error && events.length > 0 && <p className="error">{error}</p>}
        </>
      )}
    </section>
  );
}

function FullReadingView({
  entries,
  completed,
}: {
  entries: ProfileLibraryItem[];
  completed: Set<string>;
}) {
  const [series, setSeries] = useState<Record<string, SourceManga>>({});
  const [loading, setLoading] = useState(true);
  const reading = useMemo(
    () =>
      entries
        .filter((entry) => entry.status === "reading")
        .sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0)),
    [entries],
  );
  const signature = reading.map((entry) => entry.mangaId).join("|");

  useEffect(() => {
    let active = true;
    setLoading(true);

    void (async () => {
      const keys = reading.map((entry) => entry.mangaId);
      const cached = await loadCachedSeries(keys);
      if (!active) return;

      // Render cached metadata immediately. Live source refresh is best-effort
      // and must not blank a user's reading list.
      setSeries((current) => ({ ...cached, ...current }));
      setLoading(false);

      const results = await Promise.allSettled(
        reading.map((entry) => sourceService.getSeries(entry.mangaId)),
      );
      if (!active) return;

      const refreshed = new Map<string, SourceManga>();
      results.forEach((result, index) => {
        if (result.status !== "fulfilled") return;
        const entry = reading[index];
        refreshed.set(entry.mangaId, result.value);
        void saveWorkSnapshot(
          result.value,
          entry.lastReadChapter ?? entry.highestReachedChapter,
        );
      });
      setSeries((current) => {
        const next = { ...cached, ...current };
        for (const [key, item] of refreshed) next[key] = item;
        return next;
      });
    })().catch(() => {
      if (active) setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [signature]);

  return (
    <section className="profile-subview">
      <div className="profile-subview-heading">
        <div>
          <p className="eyebrow">المكتبة</p>
          <h2>أقرأ الآن</h2>
        </div>
        <Link className="secondary" to="/profile">العودة</Link>
      </div>
      {loading ? (
        <ProfileOverviewSkeleton />
      ) : (
        <ProfileReadingSection
          entries={reading}
          series={series}
          own
          completed={completed}
        />
      )}
    </section>
  );
}

export function Account() {
  const { user, data, markWorkUnread, setAvatar, setDisplayName } = useLibrary();
  const [searchParams] = useSearchParams();
  const tab = searchParams.get("tab");
  const settingsOpen = tab === "settings";
  const activityOpen = tab === "activity";
  const readingOpen = tab === "reading";
  const statsOpen = tab === "stats";

  const [profile, setProfile] = useState<UserProfileView | null>(null);
  const [readingStatsSummary, setReadingStatsSummary] = useState<ReadingStats | null>(null);
  const [sections, setSections] = useState<UserProfileSection[]>([]);
  const [groups, setGroups] = useState<ContentGroup[]>([]);
  const [works, setWorks] = useState<Record<string, SourceManga>>({});
  const [series, setSeries] = useState<Record<string, SourceManga>>({});
  const [worksError, setWorksError] = useState("");
  const [readingError, setReadingError] = useState("");
  const [readingIssues, setReadingIssues] = useState<ProfileReadingIssue[]>([]);
  const [worksRetry, setWorksRetry] = useState(0);
  const [readingRetry, setReadingRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [customizingLists, setCustomizingLists] = useState(false);
  const [error, setError] = useState("");
  const [settingsAvatarOpen, setSettingsAvatarOpen] = useState(false);

  const loadOverview = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError("");

    // Reading achievements are supplemental. Load them independently so a
    // statistics endpoint issue can never block the profile page itself.
    void userDataService
      .getReadingStats()
      .then((stats) => setReadingStatsSummary(stats))
      .catch(() => undefined);

    try {
      const [nextProfile, nextSections] = await Promise.all([
        userDataService.getUserProfile(user.id, PROFILE_PREVIEW_LIMIT),
        userDataService.getProfileSections(PROFILE_PREVIEW_LIMIT),
      ]);
      setProfile(nextProfile);
      setSections(nextSections);
      setGroups(buildContentGroups(nextSections));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تحميل ملخص الحساب.");
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (!settingsOpen && !activityOpen && !readingOpen && !statsOpen) void loadOverview();
  }, [loadOverview, settingsOpen, activityOpen, readingOpen, statsOpen]);

  useEffect(() => {
    if (settingsOpen || activityOpen || readingOpen || statsOpen) return;
    const refreshProfile = () => void loadOverview();
    window.addEventListener(PERSONALIZATION_CHANGE_EVENT, refreshProfile);
    return () => window.removeEventListener(PERSONALIZATION_CHANGE_EVENT, refreshProfile);
  }, [activityOpen, loadOverview, readingOpen, settingsOpen, statsOpen]);

  const sourceKeys = useMemo(() => {
    if (!profile) return [];
    return [
      ...profile.favorites,
      ...(profile.lists ?? []).flatMap((list) => list.previewItems),
    ];
  }, [profile]);

  useEffect(() => {
    let active = true;
    setWorksError("");
    if (!sourceKeys.length) {
      setWorks({});
      return;
    }
    resolveWorks(sourceKeys)
      .then((next) => {
        if (!active) return;
        for (const work of Object.values(next.works)) void saveWorkSnapshot(work);
        setWorks(next.works);
        setWorksError(
          next.partialFailure ? "تعذر تحميل بعض أغلفة القوائم. يمكنك المحاولة مرة أخرى." : "",
        );
      })
      .catch(() => {
        if (!active) return;
        setWorks({});
        setWorksError("تعذر تحميل أغلفة القوائم. يمكنك المحاولة مرة أخرى.");
      });
    return () => {
      active = false;
    };
  }, [sourceKeys.join("|"), worksRetry]);

  const readingEntries = useMemo(() => {
    const latestOpenedId = data?.lastOpened?.mangaId ?? null;
    // This is the signed-in user's own page, so the local synced library is
    // authoritative. Using profile.library here can briefly resurrect a work
    // that was just removed while the profile summary is still refreshing.
    return (data?.library ?? [])
      .filter((entry) => entry.status === "reading")
      .map((entry) => ({
        mangaId: entry.mangaId,
        status: entry.status,
        highestReachedChapter: entry.highestReachedChapter,
        lastReadChapter: entry.lastReadChapter,
        lastReadAt: entry.lastReadAt,
      }))
      .sort((a, b) => {
        if (a.mangaId === latestOpenedId && b.mangaId !== latestOpenedId) return -1;
        if (b.mangaId === latestOpenedId && a.mangaId !== latestOpenedId) return 1;
        return (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0);
      });
  }, [data?.lastOpened?.mangaId, data?.library]);
  const readingSignature = readingEntries.map((entry) => entry.mangaId).join("|");

  useEffect(() => {
    let active = true;
    setReadingError("");
    setReadingIssues([]);

    if (!readingEntries.length) {
      setSeries({});
      return;
    }

    void (async () => {
      const keys = readingEntries.map((entry) => entry.mangaId);
      const cached = await loadCachedSeries(keys);
      if (!active) return;

      // Snapshot/D1 metadata is the display source. Upstream sites only refresh
      // it in the background, so a temporary outage does not become a profile
      // outage.
      setSeries((current) => ({ ...cached, ...current }));

      const results = await Promise.allSettled(
        readingEntries.map((entry) => sourceService.getSeries(entry.mangaId)),
      );
      if (!active) return;

      const refreshed = new Map<string, SourceManga>();
      const issues: ProfileReadingIssue[] = [];
      results.forEach((result, index) => {
        const entry = readingEntries[index];
        if (result.status === "fulfilled") {
          refreshed.set(entry.mangaId, result.value);
          void saveWorkSnapshot(
            result.value,
            entry.lastReadChapter ?? entry.highestReachedChapter,
          );
          return;
        }

        const fallback = cached[entry.mangaId];
        const sourcePart = entry.mangaId.split(":").slice(1).join(":");
        const fallbackTitle =
          sourcePart && !/^\d+$/.test(sourcePart)
            ? decodeURIComponent(sourcePart).replace(/[-_]+/g, " ")
            : entry.mangaId;
        const chapter =
          entry.lastReadChapter ?? entry.highestReachedChapter ?? null;
        const source = fallback?.source ?? sourceFromKey(entry.mangaId);
        issues.push({
          mangaId: entry.mangaId,
          title: fallback ? sourceDisplayTitle(fallback) : fallbackTitle,
          sourceLabel: source ? sourceService.sourceLabel(source) : "مصدر غير معروف",
          chapter,
          to:
            chapter != null
              ? `/read-source/${encodeURIComponent(entry.mangaId)}/${chapter}`
              : `/source/${encodeURIComponent(entry.mangaId)}`,
        });
      });

      setSeries((current) => {
        const next = { ...cached, ...current };
        for (const [key, item] of refreshed) next[key] = item;
        return next;
      });

      const unresolved = keys.filter(
        (key) => !cached[key] && !refreshed.has(key),
      );
      setReadingIssues(issues);
      setReadingError(
        unresolved.length && !issues.length
          ? `تعذر تجهيز ${unresolved.length} من القصص مؤقتًا.`
          : "",
      );
    })().catch(() => {
      if (active) {
        setReadingError("تعذر تجهيز بيانات القراءة مؤقتًا. يمكنك المحاولة مرة أخرى.");
      }
    });

    return () => {
      active = false;
    };
  }, [readingSignature, readingRetry]);

  const completed = useMemo(() => new Set(data?.completed ?? []), [data?.completed]);

  if (settingsOpen) {
    return (
      <>
        <ProfileIdentityHeader
          user={user}
          editableIdentity
          onEditAvatar={() => setSettingsAvatarOpen(true)}
          onSaveDisplayName={async (name) => {
            await setDisplayName(name);
          }}
          actions={
            <Link className="profile-icon-action" to="/profile" aria-label="العودة إلى الحساب">
              <Icon name="back" />
            </Link>
          }
        />
        <Profile embedded hideIdentityEditor />
        {settingsAvatarOpen && (
          <AvatarPicker
            currentAvatarId={user?.avatarId ?? null}
            onSave={async (avatarId) => {
              await setAvatar(avatarId);
            }}
            onClose={() => setSettingsAvatarOpen(false)}
          />
        )}
      </>
    );
  }

  if (activityOpen) {
    return (
      <>
        <ProfileIdentityHeader user={user} />
        <FullActivityView />
      </>
    );
  }

  if (readingOpen) {
    return (
      <>
        <ProfileIdentityHeader user={user} />
        <FullReadingView
          entries={(data?.library ?? []).map((entry) => ({
            mangaId: entry.mangaId,
            status: entry.status,
            highestReachedChapter: entry.highestReachedChapter,
            lastReadChapter: entry.lastReadChapter,
            lastReadAt: entry.lastReadAt,
          }))}
          completed={completed}
        />
      </>
    );
  }

  if (statsOpen) {
    return (
      <>
        <ProfileIdentityHeader user={user} />
        <section className="profile-subview reading-stats-subview">
          <div className="reading-stats-back-row">
            <Link className="secondary" to="/profile">العودة إلى الحساب</Link>
          </div>
          <ReadingStatsDashboard />
        </section>
      </>
    );
  }

  const achievementSummary: ProfileAchievementSummaryItem[] = (() => {
    if (!readingStatsSummary) return [];

    const highestAchievement = (
      value: number,
      levels: ReadonlyArray<readonly [number, string]>,
      kind: ProfileAchievementSummaryItem["kind"],
      category: string,
    ): ProfileAchievementSummaryItem => {
      let achievement = "لم يُفتح بعد";
      let tierIndex = 0;

      levels.forEach(([threshold, name], index) => {
        if (value >= threshold) {
          achievement = name;
          tierIndex = index;
        }
      });

      return { category, achievement, tierIndex, kind };
    };

    return [
      highestAchievement(
        readingStatsSummary.organicCompletedChapters,
        [
          [10, "البداية"],
          [25, "قارئ منتظم"],
          [50, "خمسون فصلًا"],
          [100, "مئة فصل"],
          [250, "قارئ متمرس"],
          [500, "قارئ مخضرم"],
          [1000, "ألف فصل"],
          [2500, "قارئ استثنائي"],
          [5000, "أسطورة Wany"],
        ],
        "chapters",
        "إنجاز الفصول",
      ),
      highestAchievement(
        readingStatsSummary.storiesRead,
        [
          [1, "العمل الأول"],
          [5, "خمسة أعمال"],
          [10, "عشرة أعمال"],
          [25, "قارئ متنوع"],
          [50, "خمسون عملًا"],
          [100, "مئة عمل"],
        ],
        "stories",
        "إنجاز الأعمال",
      ),
      highestAchievement(
        readingStatsSummary.bestStreak,
        [
          [3, "ثلاثة أيام متتالية"],
          [7, "أسبوع متواصل"],
          [14, "أسبوعان متواصلان"],
          [30, "شهر متواصل"],
        ],
        "streak",
        "إنجاز الاستمرارية",
      ),
    ];
  })();

  const stats = profile?.stats;
  const orderedGroups = groups.filter((group) => group.visible);

  return (
    <>
      <ProfileIdentityHeader
        user={user}
        friends={profile?.stats?.friends}
        achievements={achievementSummary}
        pendingFriendRequests={profile?.pendingFriendRequests ?? 0}
        actions={
          <Link
            className="profile-icon-action"
            to="/profile?tab=settings"
            aria-label="إعدادات الحساب"
            title="الإعدادات"
          >
            <Icon name="settings" />
          </Link>
        }
      />

      {loading ? (
        <ProfileOverviewSkeleton />
      ) : error && !profile ? (
        <div className="profile-section-error" role="alert">
          <span>{error}</span>
          <button className="secondary" type="button" onClick={() => void loadOverview()}>
            إعادة المحاولة
          </button>
        </div>
      ) : profile && stats ? (
        <>
          <ProfileStatsSection stats={stats} viewAllTo="/profile?tab=stats" />

          {customizingLists ? (
            <SectionErrorBoundary
              fallbackTitle="تعذر فتح إدارة القوائم."
              onReset={() => setCustomizingLists(false)}
            >
              <ProfileListsManager
                onClose={() => {
                  setError("");
                  setCustomizingLists(false);
                  void loadOverview();
                }}
              />
            </SectionErrorBoundary>
          ) : (
            <div className="profile-content-sections">
              {orderedGroups.map((group) => {
                if (group.id === "lists") {
                  return (
                    <ProfileListsSection
                      key={group.id}
                      favorites={profile.favorites}
                      favoriteCount={profile.favoriteCount}
                      lists={profile.lists ?? []}
                      works={works}
                      error={worksError}
                      onRetry={() => setWorksRetry((value) => value + 1)}
                      onCustomize={() => setCustomizingLists(true)}
                    />
                  );
                }
                if (group.id === "reading") {
                  return (
                    <ProfileReadingSection
                      key={group.id}
                      entries={readingEntries}
                      series={series}
                      own
                      completed={completed}
                      viewAllTo="/profile?tab=reading"
                      error={readingError}
                      issues={readingIssues}
                      onRetry={() => setReadingRetry((value) => value + 1)}
                      onRemoveIssue={(mangaId) => void markWorkUnread(mangaId)}
                    />
                  );
                }
                return (
                  <ProfileActivitySection
                    key={group.id}
                    events={profile.activity ?? []}
                    viewAllTo="/profile?tab=activity"
                  />
                );
              })}
            </div>
          )}

          {error && profile && !customizingLists && (
            <div className="profile-section-error compact" role="alert">
              <span>{error}</span>
              <button className="secondary" type="button" onClick={() => void loadOverview()}>
                إعادة المحاولة
              </button>
            </div>
          )}
        </>
      ) : null}
    </>
  );
}
