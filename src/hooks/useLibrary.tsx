import {
  createContext,
  useContext,
  useState,
  useEffect,
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
  const refresh = async () => {
    setData(await service.getData());
    setFriends(await service.getFriends());
  };
  useEffect(() => {
    service
      .getUser()
      .then(async (user) => {
        setUser(user);
        if (user) await refresh();
      })
      .catch(() =>
        setError(
          "تعذر استخدام التخزين المحلي. فعّل تخزين المتصفح ثم أعد تحميل الصفحة.",
        ),
      )
      .finally(() => setLoading(false));
  }, []);
  const signIn = async (username: string, password: string) => {
    const user = await service.signIn(username, password);
    await refresh();
    setUser(user);
  };
  const signOut = async () => {
    await service.signOut();
    setUser(null);
    setData(null);
  };
  const favorite = async (id: string, forceAdd = false) => {
    try {
      if (data?.favorites.includes(id) && !forceAdd)
        await service.removeFavorite(id);
      else await service.addFavorite(id);
      await refresh();
    } catch {
      setError("تعذر حفظ المفضلة. تحقق من مساحة تخزين المتصفح.");
    }
  };
  const saveProgress = async (progress: ReadingProgress) => {
    try {
      await service.saveReadingProgress(progress);
      setData(await service.getData());
    } catch {
      setError("تعذر حفظ تقدم القراءة على هذا الجهاز.");
    }
  };
  return {
    user,
    data,
    friends,
    loading,
    error,
    signIn,
    signOut,
    favorite,
    saveProgress,
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
