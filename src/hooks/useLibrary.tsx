import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
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
    setData(await service.getData());
  }, []);

  const refreshFriends = useCallback(async () => {
    const nextFriends = await service.getFriends();
    setFriends(nextFriends);
    return nextFriends;
  }, []);

  useEffect(() => {
    service
      .getUser()
      .then(async (currentUser) => {
        setUser(currentUser);
        if (currentUser && currentUser.role !== "admin") await refresh();
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

  const signIn = async (username: string, password: string) => {
    setError("");
    const nextUser = await service.signIn(username, password);
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
    try {
      setError("");
      if (data?.favorites.includes(id) && !forceAdd)
        await service.removeFavorite(id);
      else await service.addFavorite(id);
      setData(await service.getData());
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "تعذر مزامنة المفضلة الآن.",
      );
    }
  };

  const addToLibrary = async (id: string, status: LibraryStatus = "planned") => {
    try {
      setError("");
      await service.addToLibrary(id, status);
      setData(await service.getData());
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "تعذر إضافة القصة إلى المكتبة.",
      );
    }
  };

  const setLibraryStatus = async (id: string, status: LibraryStatus) => {
    try {
      setError("");
      await service.setLibraryStatus(id, status);
      setData(await service.getData());
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "تعذر تحديث حالة القصة.",
      );
    }
  };

  const removeFromLibrary = async (id: string) => {
    try {
      setError("");
      await service.removeFromLibrary(id);
      setData(await service.getData());
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "تعذر حذف القصة من المكتبة.",
      );
    }
  };

  const recordChapterOpen = useCallback(async (mangaId: string, chapter: number) => {
    const readAt = Date.now();
    setData((current) => {
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
    try {
      setError("");
      await service.markChapterUnread(mangaId, chapter);
      setData(await service.getData());
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "تعذر تعليم الفصل كغير مقروء.",
      );
      throw cause;
    }
  }, []);

  const markWorkUnread = useCallback(async (mangaId: string) => {
    try {
      setError("");

      // "لم تتم قراءتها" means the work should disappear from the account's
      // reading state completely, not just lose chapter completion marks.
      // Clear reading/history state first, then remove the library row as an
      // explicit second guard so it cannot resurface after the next refresh.
      await service.markWorkUnread(mangaId);
      await service.removeFromLibrary(mangaId).catch(() => undefined);

      setData((current) => {
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
      setError(cause instanceof Error ? cause.message : "تعذر إلغاء تتبع العمل.");
      throw cause;
    }
  }, []);

  const markChaptersRead = useCallback(async (mangaId: string, chapters: number[]) => {
    if (!chapters.length) return 0;
    try {
      setError("");
      const processed = await service.markChaptersRead(mangaId, chapters);
      const now = Date.now();
      const highest = Math.max(...chapters);
      setData((current) => {
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
    const key = `${progress.mangaId}:${progress.chapter}`;
    setData((current) => {
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
    setError("");
    const relationship = await service.acceptFriendRequest(id);
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
    setError("");
    await service.removeFriend(id);
    await refreshFriends();
  };

  const setAvatar = async (avatarId: string) => {
    setError("");
    const updatedUser = await service.setAvatar(avatarId);
    setUser(updatedUser);
    return updatedUser;
  };

  const setDisplayName = async (name: string) => {
    setError("");
    const updatedUser = await service.setDisplayName(name);
    setUser(updatedUser);
    return updatedUser;
  };

  const setProfileVisibility = async (visibility: ProfileVisibility) => {
    setError("");
    const updatedUser = await service.setProfileVisibility(visibility);
    setUser(updatedUser);
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
