import type {
  Friend,
  LibraryStatus,
  ReadingHistoryEntry,
  ReadingProgress,
  User,
  UserData,
} from "../types";

export interface UserDataService {
  getUser(): Promise<User | null>;
  signIn(username: string, password: string): Promise<User>;
  signOut(): Promise<void>;
  getData(): Promise<UserData>;
  getFavorites(): Promise<string[]>;
  addFavorite(id: string): Promise<void>;
  removeFavorite(id: string): Promise<void>;
  addToLibrary(id: string, status?: LibraryStatus): Promise<void>;
  setLibraryStatus(id: string, status: LibraryStatus): Promise<void>;
  removeFromLibrary(id: string): Promise<void>;
  recordChapterOpen(mangaId: string, chapter: number): Promise<{ readAt: number }>;
  markChapterUnread(mangaId: string, chapter: number): Promise<void>;
  getReadingHistory(limit?: number): Promise<ReadingHistoryEntry[]>;
  getReadingProgress(): Promise<Record<string, ReadingProgress>>;
  saveReadingProgress(progress: ReadingProgress): Promise<void>;
  getFriends(): Promise<Friend[]>;
  addFriend(username: string): Promise<void>;
  removeFriend(id: string): Promise<void>;
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
}

type ApiErrorPayload = {
  error?: string;
  message?: string;
};

class ApiError extends Error {
  code?: string;
  status: number;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

const isLiveKey = (value?: string | null) => Boolean(value && /^(mt|tx|aq|sz|xs|ml):/.test(value));

function normalizeData(data: UserData): UserData {
  const favorites = (data.favorites ?? []).filter((id) => isLiveKey(id));
  const library = (data.library ?? []).filter((item) => isLiveKey(item.mangaId));
  const progress = Object.fromEntries(
    Object.entries(data.progress ?? {}).filter(([, item]) => isLiveKey(item.mangaId)),
  );
  const completed = (data.completed ?? []).filter((key) => {
    const item = progress[key];
    return item ? isLiveKey(item.mangaId) : /^(mt|tx|aq|sz|xs|ml):/.test(key);
  });
  const lastOpened = data.lastOpened && isLiveKey(data.lastOpened.mangaId) ? data.lastOpened : null;
  return { ...data, version: 3, favorites, library, progress, completed, lastOpened };
}

function normalizeFriends(friends: Friend[]): Friend[] {
  return friends.map((friend) => ({
    ...friend,
    reading: friend.reading && isLiveKey(friend.reading.mangaId) ? friend.reading : null,
    favorites: friend.favorites.filter((id) => isLiveKey(id)),
  }));
}

class ApiUserDataService implements UserDataService {
  private currentUser: User | null = null;
  private cleaned = false;

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`/api/${path}`, {
        ...init,
        credentials: "include",
        cache: "no-store",
        headers: {
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...init.headers,
        },
      });
    } catch {
      throw new ApiError(
        "تعذر الاتصال بخدمة المزامنة. تحقق من الإنترنت وحاول مرة ثانية.",
        0,
        "NETWORK_ERROR",
      );
    }

    const payload = (await response.json().catch(() => ({}))) as T & ApiErrorPayload;
    if (!response.ok) {
      throw new ApiError(
        payload.message || "تعذر مزامنة بياناتك الآن.",
        response.status,
        payload.error,
      );
    }
    return payload;
  }

  async getUser() {
    const result = await this.request<{ user: User | null }>("session");
    this.currentUser = result.user;
    this.cleaned = false;
    return result.user;
  }

  async signIn(username: string, password: string) {
    const result = await this.request<{ user: User }>("login", {
      method: "POST",
      body: JSON.stringify({ username: username.trim().toLowerCase(), password }),
    });
    this.currentUser = result.user;
    this.cleaned = false;
    await this.cleanupDemoData();
    return result.user;
  }

  async signOut() {
    try {
      await this.request<{ ok: boolean }>("logout", { method: "POST" });
    } finally {
      this.currentUser = null;
      this.cleaned = false;
    }
  }

  async getData(): Promise<UserData> {
    await this.cleanupDemoData();
    try {
      const result = await this.request<{ data: UserData }>("data");
      const data = normalizeData(result.data);
      this.writeSnapshot("data", data);
      return data;
    } catch (error) {
      const snapshot = this.readSnapshot<UserData>("data");
      if (snapshot && error instanceof ApiError && error.code === "NETWORK_ERROR") {
        return normalizeData(snapshot);
      }
      throw error;
    }
  }

  async getFavorites() {
    return (await this.getData()).favorites;
  }

  async addFavorite(id: string) {
    if (!isLiveKey(id)) throw new Error("هذا العمل ليس من مصدر مدعوم.");
    await this.request<{ ok: boolean }>("favorites", {
      method: "POST",
      body: JSON.stringify({ mangaId: id }),
    });
  }

  async removeFavorite(id: string) {
    await this.request<{ ok: boolean }>(`favorites/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  async addToLibrary(id: string, status: LibraryStatus = "planned") {
    if (!isLiveKey(id)) throw new Error("هذا العمل ليس من مصدر مدعوم.");
    await this.request<{ ok: boolean }>("library", {
      method: "POST",
      body: JSON.stringify({ mangaId: id, status }),
    });
  }

  async setLibraryStatus(id: string, status: LibraryStatus) {
    if (!isLiveKey(id)) throw new Error("هذا العمل ليس من مصدر مدعوم.");
    await this.request<{ ok: boolean }>("library", {
      method: "PUT",
      body: JSON.stringify({ mangaId: id, status }),
    });
  }

  async removeFromLibrary(id: string) {
    await this.request<{ ok: boolean }>(`library/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  async recordChapterOpen(mangaId: string, chapter: number) {
    if (!isLiveKey(mangaId) || !Number.isFinite(chapter) || chapter < 0) {
      throw new Error("بيانات الفصل غير صالحة.");
    }
    return await this.request<{ ok: boolean; readAt: number }>("reading/open", {
      method: "POST",
      body: JSON.stringify({ mangaId, chapter }),
      keepalive: true,
    });
  }

  async markChapterUnread(mangaId: string, chapter: number) {
    if (!isLiveKey(mangaId) || !Number.isFinite(chapter) || chapter < 0) {
      throw new Error("بيانات الفصل غير صالحة.");
    }
    await this.request<{ ok: boolean }>("reading/unread", {
      method: "POST",
      body: JSON.stringify({ mangaId, chapter }),
    });
  }

  async getReadingHistory(limit = 100) {
    const normalizedLimit = Math.max(1, Math.min(200, Math.trunc(limit)));
    const result = await this.request<{ history: ReadingHistoryEntry[] }>(
      `reading/history?limit=${normalizedLimit}`,
    );
    return result.history.filter((item) => isLiveKey(item.mangaId));
  }

  async getReadingProgress() {
    return (await this.getData()).progress;
  }

  async saveReadingProgress(progress: ReadingProgress) {
    if (!isLiveKey(progress.mangaId)) throw new Error("هذا العمل ليس من مصدر مدعوم.");
    await this.request<{ ok: boolean }>("progress", {
      method: "PUT",
      body: JSON.stringify(progress),
      keepalive: true,
    });
  }

  async getFriends() {
    await this.cleanupDemoData();
    try {
      const result = await this.request<{ friends: Friend[] }>("friends");
      const friends = normalizeFriends(result.friends);
      this.writeSnapshot("friends", friends);
      return friends;
    } catch (error) {
      const snapshot = this.readSnapshot<Friend[]>("friends");
      if (snapshot && error instanceof ApiError && error.code === "NETWORK_ERROR") {
        return normalizeFriends(snapshot);
      }
      throw error;
    }
  }

  async addFriend(username: string) {
    await this.request("friends", {
      method: "POST",
      body: JSON.stringify({ username: username.trim().toLowerCase() }),
    });
  }

  async removeFriend(id: string) {
    await this.request(`friends/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  async changePassword(currentPassword: string, newPassword: string) {
    await this.request("change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  }

  private async cleanupDemoData() {
    if (this.cleaned || !this.currentUser) return;
    try {
      await this.request<{ ok: boolean }>("cleanup-demo", { method: "POST" });
      this.cleaned = true;
      this.clearLegacyLocalData();
    } catch (error) {
      if (error instanceof ApiError && error.code === "NETWORK_ERROR") return;
      throw error;
    }
  }

  private clearLegacyLocalData() {
    if (typeof localStorage === "undefined") return;
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key?.startsWith("anytime:v1:") || key?.startsWith("anytime:v2:migrated:")) {
        localStorage.removeItem(key);
      }
    }
    localStorage.removeItem("anytime:session");
  }

  private snapshotKey(kind: "data" | "friends") {
    return this.currentUser ? `anytime:v2:${kind}:${this.currentUser.id}` : null;
  }

  private writeSnapshot(kind: "data" | "friends", value: unknown) {
    if (typeof localStorage === "undefined") return;
    const key = this.snapshotKey(kind);
    if (!key) return;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Snapshots are optional; D1 remains authoritative.
    }
  }

  private readSnapshot<T>(kind: "data" | "friends"): T | null {
    if (typeof localStorage === "undefined") return null;
    const key = this.snapshotKey(kind);
    if (!key) return null;
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }
}

export const userDataService: UserDataService = new ApiUserDataService();
