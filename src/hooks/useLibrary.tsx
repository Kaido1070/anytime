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
    const [nextData, nextFriends] = await Promise.all([
      service.getData(),
      service.getFriends(),
    ]);
    setData(nextData);
    setFriends(nextFriends);
  }, []);

  useEffect(() => {
    service
      .getUser()
      .then(async (currentUser) => {
        setUser(currentUser);
        if (currentUser) await refresh();
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
    if (!user) return;
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
    await refresh();
  };

  const signOut = async () => {
    setError("");
    await service.signOut();
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
        cause instanceof Error ? cause.message : "تعذر إضافة العمل إلى المكتبة.",
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
        cause instanceof Error ? cause.message : "تعذر تحديث حالة العمل.",
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
        cause instanceof Error ? cause.message : "تعذر حذف العمل من المكتبة.",
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
    await service.addFriend(username);
    setFriends(await service.getFriends());
  };

  const removeFriend = async (id: string) => {
    setError("");
    await service.removeFriend(id);
    setFriends(await service.getFriends());
  };

  const changePassword = async (currentPassword: string, newPassword: string) => {
    setError("");
    await service.changePassword(currentPassword, newPassword);
  };

  return {
    user,
    data,
    friends,
    loading,
    error,
    refresh,
    signIn,
    signOut,
    favorite,
    addToLibrary,
    setLibraryStatus,
    removeFromLibrary,
    recordChapterOpen,
    saveProgress,
    addFriend,
    removeFriend,
    changePassword,
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
