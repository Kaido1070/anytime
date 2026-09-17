import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { userDataService as service } from "../services/userData";
import type { User, UserData, Friend, ReadingProgress } from "../types";

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

  const saveProgress = async (progress: ReadingProgress) => {
    const key = `${progress.mangaId}:${progress.chapter}`;
    setData((current) => {
      if (!current) return current;
      const completed =
        progress.percent >= 98 && !current.completed.includes(key)
          ? [...current.completed, key]
          : current.completed;
      return {
        ...current,
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

  const setProfilePrivate = async (value: boolean) => {
    setError("");
    const profilePrivate = await service.setProfilePrivate(value);
    setData((current) => current ? { ...current, profilePrivate } : current);
    return profilePrivate;
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
    saveProgress,
    addFriend,
    removeFriend,
    setProfilePrivate,
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
