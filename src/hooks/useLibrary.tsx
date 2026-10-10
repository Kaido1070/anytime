import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { reconcileAccountIdentity } from "../services/accountIdentity.ts";
import { mergeLibraryRead } from "../services/reading";
import { userDataService as service } from "../services/userData";
import type {
  Friend,
  LibraryStatus,
  ProfileVisibility,
  ReadingProgress,
  User,
  UserData,
} from "../types";

function useLibraryState() {
  const [user, setUser] = useState<User | null>(null);
  const [data, setData] = useState<UserData | null>(null);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const scope = service.captureAccountScope();
    const next = await service.getData();
    setData(current => scope?.isCurrent() ? next : current);
  }, []);

  // Revalidate identity after returning from settings; the backend owns badge grants.
  const refreshUser = useCallback(async () => {
    const scope = service.captureAccountScope();
    if (!scope) return null;
    const freshUser = await service.getUser();
    if (!scope.isCurrent()) return null;
    setUser(current => {
      if (!freshUser) return null;
      return reconcileAccountIdentity(current, freshUser);
    });
    return freshUser;
  }, []);

  const refreshFriends = useCallback(async () => {
    const scope = service.captureAccountScope();
    const nextFriends = await service.getFriends();
    scope?.assertCurrent();
    setFriends(current => scope?.isCurrent() ? nextFriends : current);
    return nextFriends;
  }, []);

  useEffect(() => {
    service
      .getUser()
      .then(async (currentUser) => {
        setUser(currentUser);
        if (currentUser && currentUser.role !== "admin") {
          const cached = service.getCachedData();
          if (cached) {
            setData(cached);
            setLoading(false);
          }
          await refresh();
        }
      })
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "تعذر الاتصال بخدمة مزامنة Anytime.",
        ),
      )
      .finally(() => setLoading(false));
  }, [refresh]);

  useEffect(() => {
    if (!user || user.role === "admin") return;
    const sync = () => {
      if (document.visibilityState === "visible") {
        void refresh().catch(() => undefined);
      }
    };
    const focus = () => void refresh().catch(() => undefined);
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("focus", focus);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("focus", focus);
    };
  }, [user, refresh]);

  useEffect(() => {
    if (user && data) service.cacheData(data);
  }, [user, data]);

  const signIn = async (
    username: string,
    password: string,
    onAuthenticated?: (user: User) => void,
  ) => {
    setError("");
    const nextUser = await service.signIn(username, password);
    // Redirect before mounting the authenticated route. Otherwise opening a
    // shared chapter while logged out briefly mounts that chapter for the new
    // account and can record an unwanted chapter-open event.
    onAuthenticated?.(nextUser);
    setUser(nextUser);
    setData(null);
    setFriends([]);
    if (nextUser.role !== "admin") {
      try {
        await refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "تم تسجيل الدخول، لكن تعذر تحديث المكتبة الآن.");
      }
    }
  };

  const signOut = async (allDevices = false) => {
    setError("");
    await service.signOut(allDevices);
    setUser(null);
    setData(null);
    setFriends([]);
  };

  const favorite = async (id: string, forceAdd = false) => {
    const scope = service.captureAccountScope();
    try {
      setError("");
      if (data?.favorites.includes(id) && !forceAdd)
        await service.removeFavorite(id);
      else await service.addFavorite(id);
      scope?.assertCurrent();
      const next = await service.getData();
      setData(current => scope?.isCurrent() ? next : current);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "تعذر مزامنة المفضلة الآن.",
      );
    }
  };

  const addToLibrary = async (id: string, status: LibraryStatus = "planned") => {
    const scope = service.captureAccountScope();
    try {
      setError("");
      await service.addToLibrary(id, status);
      scope?.assertCurrent();
      const next = await service.getData();
      setData(current => scope?.isCurrent() ? next : current);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "تعذر إضافة القصة إلى المكتبة.",
      );
    }
  };

  const setLibraryStatus = async (id: string, status: LibraryStatus) => {
    const scope = service.captureAccountScope();
    try {
      setError("");
      await service.setLibraryStatus(id, status);
      scope?.assertCurrent();
      const next = await service.getData();
      setData(current => scope?.isCurrent() ? next : current);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "تعذر تحديث حالة القصة.",
      );
    }
  };

  const removeFromLibrary = async (id: string) => {
    const scope = service.captureAccountScope();
    try {
      setError("");
      await service.removeFromLibrary(id);
      scope?.assertCurrent();
      const next = await service.getData();
      setData(current => scope?.isCurrent() ? next : current);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "تعذر حذف القصة من المكتبة.",
      );
    }
  };

  const recordChapterOpen = useCallback(async (mangaId: string, chapter: number) => {
    const scope = service.captureAccountScope();
    const readAt = Date.now();
    setData((current) => {
      if (!scope?.isCurrent()) return current;
      if (!current) return current;
      const existing = current.library.find((item) => item.mangaId === mangaId);
      const next = mergeLibraryRead(existing, mangaId, chapter, readAt);
      return {
        ...current,
        library: [next, ...current.library.filter((item) => item.mangaId !== mangaId)],
        lastOpened: { mangaId, chapter },
      };
    });
    try {
      await service.recordChapterOpen(mangaId, chapter);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "تعذر تسجيل فتح الفصل.",
      );
    }
  }, []);

  const markChapterUnread = useCallback(async (mangaId: string, chapter: number) => {
    const scope = service.captureAccountScope();
    try {
      setError("");
      await service.markChapterUnread(mangaId, chapter);
      scope?.assertCurrent();
      const next = await service.getData();
      setData(current => scope?.isCurrent() ? next : current);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "تعذر تعليم الفصل كغير مقروء.",
      );
      throw cause;
    }
  }, []);

  const markWorkUnread = useCallback(async (mangaId: string) => {
    const scope = service.captureAccountScope();
    try {
      setError("");

      // "لم تتم قراءتها" means the work should disappear from the account's
      // reading state completely, not just lose chapter completion marks.
      // Clear reading/history state first, then remove the library row as an
      // explicit second guard so it cannot resurface after the next refresh.
      await service.markWorkUnread(mangaId);
      scope?.assertCurrent();
      await service.removeFromLibrary(mangaId).catch(() => undefined);
      scope?.assertCurrent();

      setData((current) => {
      if (!scope?.isCurrent()) return current;
        if (!current) return current;
        const progress = Object.fromEntries(
          Object.entries(current.progress).filter(([key]) => !key.startsWith(`${mangaId}:`)),
        );
        return {
          ...current,
          library: current.library.filter((item) => item.mangaId !== mangaId),
          completed: current.completed.filter((key) => !key.startsWith(`${mangaId}:`)),
          progress,
          lastOpened: current.lastOpened?.mangaId === mangaId ? null : current.lastOpened,
        };
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر إلغاء تتبع القصة.");
      throw cause;
    }
  }, []);

  const markChaptersRead = useCallback(async (mangaId: string, chapters: number[]) => {
    const scope = service.captureAccountScope();
    if (!chapters.length) return 0;
    try {
      setError("");
      const processed = await service.markChaptersRead(mangaId, chapters);
      const now = Date.now();
      const highest = Math.max(...chapters);
      setData((current) => {
      if (!scope?.isCurrent()) return current;
        if (!current) return current;
        const completed = new Set(current.completed);
        const progress = { ...current.progress };
        for (const chapter of chapters) {
          const key = `${mangaId}:${chapter}`;
          completed.add(key);
          progress[key] = { mangaId, chapter, percent: 100, updatedAt: now };
        }
        const existing = current.library.find((item) => item.mangaId === mangaId);
        const libraryEntry = existing
          ? {
              ...existing,
              status: existing.status === "planned" ? "reading" as const : existing.status,
              updatedAt: Math.max(existing.updatedAt, now),
              highestReachedChapter:
                existing.highestReachedChapter == null
                  ? highest
                  : Math.max(existing.highestReachedChapter, highest),
            }
          : {
              mangaId,
              status: "reading" as const,
              addedAt: now,
              updatedAt: now,
              lastReadAt: null,
              lastReadChapter: null,
              highestReachedChapter: highest,
            };
        return {
          ...current,
          library: [libraryEntry, ...current.library.filter((item) => item.mangaId !== mangaId)],
          completed: [...completed],
          progress,
        };
      });
      return processed;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تعليم الفصول كمقروءة.");
      throw cause;
    }
  }, []);

  const saveProgress = async (progress: ReadingProgress) => {
    const scope = service.captureAccountScope();
    const key = `${progress.mangaId}:${progress.chapter}`;
    setData((current) => {
      if (!scope?.isCurrent()) return current;
      if (!current) return current;
      const completed =
        progress.percent >= 98 && !current.completed.includes(key)
          ? [...current.completed, key]
          : current.completed;
      const existing = current.library.find((item) => item.mangaId === progress.mangaId);
      const libraryEntry = mergeLibraryRead(
        existing,
        progress.mangaId,
        progress.chapter,
        progress.updatedAt,
      );
      return {
        ...current,
        library: [
          libraryEntry,
          ...current.library.filter((item) => item.mangaId !== progress.mangaId),
        ],
        progress: {
          ...current.progress,
          [key]: {
            ...progress,
            percent: Math.max(0, Math.min(100, progress.percent)),
          },
        },
        completed,
        lastOpened: { mangaId: progress.mangaId, chapter: progress.chapter },
      };
    });
    try {
      await service.saveReadingProgress(progress);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "تعذر مزامنة تقدم القراءة الآن.",
      );
    }
  };

  const addFriend = async (username: string) => {
    setError("");
    return await service.addFriend(username);
  };

  const sendFriendRequest = async (id: string) => {
    setError("");
    return await service.sendFriendRequest(id);
  };

  const acceptFriendRequest = async (id: string) => {
    const scope = service.captureAccountScope();
    setError("");
    const relationship = await service.acceptFriendRequest(id);
    scope?.assertCurrent();
    await refreshFriends();
    return relationship;
  };

  const rejectFriendRequest = async (id: string) => {
    setError("");
    return await service.rejectFriendRequest(id);
  };

  const cancelFriendRequest = async (id: string) => {
    setError("");
    return await service.cancelFriendRequest(id);
  };

  const removeFriend = async (id: string) => {
    const scope = service.captureAccountScope();
    setError("");
    await service.removeFriend(id);
    scope?.assertCurrent();
    await refreshFriends();
  };

  const setAvatar = async (avatarId: string) => {
    const scope = service.captureAccountScope();
    setError("");
    const updatedUser = await service.setAvatar(avatarId);
    scope?.assertCurrent();
    setUser(current => scope?.isCurrent() ? updatedUser : current);
    return updatedUser;
  };

  const setDisplayName = async (name: string) => {
    const scope = service.captureAccountScope();
    setError("");
    const updatedUser = await service.setDisplayName(name);
    scope?.assertCurrent();
    setUser(current => scope?.isCurrent() ? updatedUser : current);
    return updatedUser;
  };

  const setProfileVisibility = async (visibility: ProfileVisibility) => {
    const scope = service.captureAccountScope();
    setError("");
    const updatedUser = await service.setProfileVisibility(visibility);
    scope?.assertCurrent();
    setUser(current => scope?.isCurrent() ? updatedUser : current);
  };

  const changePassword = async (currentPassword: string, newPassword: string) => {
    setError("");
    await service.changePassword(currentPassword, newPassword);
  };

  const generateRecoveryCode = (currentPassword: string) => service.generateRecoveryCode(currentPassword);
  const setSecurityQuestion = (currentPassword: string, question: string, answer: string) => service.setSecurityQuestion(currentPassword, question, answer);

  return {
    user,
    data,
    friends,
    loading,
    error,
    refresh,
    refreshUser,
    refreshFriends,
    signIn,
    signOut,
    favorite,
    addToLibrary,
    setLibraryStatus,
    removeFromLibrary,
    recordChapterOpen,
    markChapterUnread,
    markWorkUnread,
    markChaptersRead,
    saveProgress,
    addFriend,
    sendFriendRequest,
    acceptFriendRequest,
    rejectFriendRequest,
    cancelFriendRequest,
    removeFriend,
    setAvatar,
    setDisplayName,
    setProfileVisibility,
    changePassword,
    generateRecoveryCode,
    setSecurityQuestion,
  };
}

const Context = createContext<ReturnType<typeof useLibraryState> | null>(null);

export function LibraryProvider({ children }: { children: ReactNode }) {
  return (
    <Context.Provider value={useLibraryState()}>{children}</Context.Provider>
  );
}

export function useLibrary() {
  const value = useContext(Context);
  if (!value) throw new Error("Library provider missing");
  return value;
}
