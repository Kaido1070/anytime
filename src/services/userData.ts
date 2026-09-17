import { mockFriends, users } from "../data/mock.ts";
import type { Friend, ReadingProgress, User, UserData } from "../types";

export interface UserDataService {
  getUser(): Promise<User | null>;
  signIn(username: string, password: string): Promise<User>;
  signOut(): Promise<void>;
  getData(): Promise<UserData>;
  getFavorites(): Promise<string[]>;
  addFavorite(id: string): Promise<void>;
  removeFavorite(id: string): Promise<void>;
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

class ApiUserDataService implements UserDataService {
  private currentUser: User | null = null;

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
    return result.user;
  }

  async signIn(username: string, password: string) {
    const result = await this.request<{ user: User }>("login", {
      method: "POST",
      body: JSON.stringify({ username: username.trim().toLowerCase(), password }),
    });
    this.currentUser = result.user;
    await this.importLegacyData(result.user.id);
    return result.user;
  }

  async signOut() {
    try {
      await this.request<{ ok: boolean }>("logout", { method: "POST" });
    } finally {
      this.currentUser = null;
    }
  }

  async getData(): Promise<UserData> {
    try {
      const result = await this.request<{ data: UserData }>("data");
      this.writeSnapshot("data", result.data);
      return result.data;
    } catch (error) {
      const snapshot = this.readSnapshot<UserData>("data");
      if (snapshot && error instanceof ApiError && error.code === "NETWORK_ERROR") {
        return snapshot;
      }
      throw error;
    }
  }

  async getFavorites() {
    return (await this.getData()).favorites;
  }

  async addFavorite(id: string) {
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

  async getReadingProgress() {
    return (await this.getData()).progress;
  }

  async saveReadingProgress(progress: ReadingProgress) {
    await this.request<{ ok: boolean }>("progress", {
      method: "PUT",
      body: JSON.stringify(progress),
      keepalive: true,
    });
  }

  async getFriends() {
    try {
      const result = await this.request<{ friends: Friend[] }>("friends");
      this.writeSnapshot("friends", result.friends);
      return result.friends;
    } catch (error) {
      const snapshot = this.readSnapshot<Friend[]>("friends");
      if (snapshot && error instanceof ApiError && error.code === "NETWORK_ERROR") {
        return snapshot;
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

  private async importLegacyData(userId: string) {
    if (typeof localStorage === "undefined") return;
    const marker = `anytime:v2:migrated:${userId}`;
    if (localStorage.getItem(marker) === "1") return;
    const raw = localStorage.getItem(`anytime:v1:user:${userId}`);
    if (!raw) {
      localStorage.setItem(marker, "1");
      localStorage.removeItem("anytime:session");
      return;
    }

    try {
      const data = JSON.parse(raw) as unknown;
      await this.request("import", {
        method: "POST",
        body: JSON.stringify({ data }),
      });
      localStorage.setItem(marker, "1");
      localStorage.removeItem("anytime:session");
    } catch {
      // Keep Phase 1 data so migration can retry after the next login.
    }
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

const initialLocal = (): UserData => ({
  version: 2,
  favorites: ["returner", "solo"],
  progress: {
    "returner:143": {
      mangaId: "returner",
      chapter: 143,
      percent: 62,
      updatedAt: 1,
    },
  },
  completed: ["returner:141", "returner:142"],
  lastOpened: { mangaId: "returner", chapter: 143 },
});

class LocalFallbackService implements UserDataService {
  async getUser() {
    return (
      users.find((user) => user.id === localStorage.getItem("anytime:session")) ?? null
    );
  }

  async signIn(username: string, password: string) {
    const user = users.find(
      (item) => item.username === username.trim().toLowerCase(),
    );
    if (!user || password !== "anytime") {
      throw new Error("اسم المستخدم أو كلمة المرور غير صحيحة.");
    }
    localStorage.setItem("anytime:session", user.id);
    return user;
  }

  async signOut() {
    localStorage.removeItem("anytime:session");
  }

  private async key() {
    const user = await this.getUser();
    if (!user) throw new Error("سجل دخولك مرة ثانية.");
    return `anytime:v1:user:${user.id}`;
  }

  async getData(): Promise<UserData> {
    const raw = localStorage.getItem(await this.key());
    if (!raw) return initialLocal();
    try {
      const parsed = JSON.parse(raw) as Omit<UserData, "version"> & { version?: number };
      if (
        !Array.isArray(parsed.favorites) ||
        !Array.isArray(parsed.completed) ||
        !parsed.progress ||
        typeof parsed.progress !== "object"
      ) {
        throw new Error();
      }
      return { ...parsed, version: 2 } as UserData;
    } catch {
      return initialLocal();
    }
  }

  private async save(data: UserData) {
    localStorage.setItem(
      await this.key(),
      JSON.stringify({ ...data, version: 1 }),
    );
  }

  async getFavorites() {
    return (await this.getData()).favorites;
  }

  async addFavorite(id: string) {
    const data = await this.getData();
    data.favorites = [...new Set([...data.favorites, id])];
    await this.save(data);
  }

  async removeFavorite(id: string) {
    const data = await this.getData();
    data.favorites = data.favorites.filter((item) => item !== id);
    await this.save(data);
  }

  async getReadingProgress() {
    return (await this.getData()).progress;
  }

  async saveReadingProgress(progress: ReadingProgress) {
    const data = await this.getData();
    const key = `${progress.mangaId}:${progress.chapter}`;
    data.progress[key] = {
      ...progress,
      percent: Math.max(0, Math.min(100, progress.percent)),
    };
    data.lastOpened = { mangaId: progress.mangaId, chapter: progress.chapter };
    if (progress.percent >= 98 && !data.completed.includes(key)) data.completed.push(key);
    await this.save(data);
  }

  async getFriends() {
    const user = await this.getUser();
    return mockFriends
      .filter((friend) => friend.user.id !== user?.id)
      .map((friend) => ({ ...friend, reading: friend.reading ?? null }));
  }

  async addFriend() {
    throw new Error("إضافة الأصدقاء تتفعل تلقائيا بعد ربط قاعدة D1.");
  }

  async removeFriend() {
    throw new Error("إدارة الأصدقاء تتفعل تلقائيا بعد ربط قاعدة D1.");
  }

  async changePassword() {
    throw new Error("تغيير كلمة المرور يتفعل تلقائيا بعد ربط قاعدة D1.");
  }
}

class HybridUserDataService implements UserDataService {
  private readonly api = new ApiUserDataService();
  private readonly local = new LocalFallbackService();
  private active: UserDataService | null = null;

  private isD1Missing(error: unknown) {
    return error instanceof ApiError && error.code === "D1_NOT_CONFIGURED";
  }

  async getUser() {
    try {
      const user = await this.api.getUser();
      this.active = this.api;
      return user;
    } catch (error) {
      if (!this.isD1Missing(error)) throw error;
      this.active = this.local;
      return this.local.getUser();
    }
  }

  async signIn(username: string, password: string) {
    if (this.active === this.local) return this.local.signIn(username, password);
    try {
      const user = await this.api.signIn(username, password);
      this.active = this.api;
      return user;
    } catch (error) {
      if (!this.isD1Missing(error)) throw error;
      this.active = this.local;
      return this.local.signIn(username, password);
    }
  }

  private service() {
    return this.active ?? this.api;
  }

  signOut() {
    return this.service().signOut();
  }
  getData() {
    return this.service().getData();
  }
  getFavorites() {
    return this.service().getFavorites();
  }
  addFavorite(id: string) {
    return this.service().addFavorite(id);
  }
  removeFavorite(id: string) {
    return this.service().removeFavorite(id);
  }
  getReadingProgress() {
    return this.service().getReadingProgress();
  }
  saveReadingProgress(progress: ReadingProgress) {
    return this.service().saveReadingProgress(progress);
  }
  getFriends() {
    return this.service().getFriends();
  }
  addFriend(username: string) {
    return this.service().addFriend(username);
  }
  removeFriend(id: string) {
    return this.service().removeFriend(id);
  }
  changePassword(currentPassword: string, newPassword: string) {
    return this.service().changePassword(currentPassword, newPassword);
  }
}

export const userDataService: UserDataService = new HybridUserDataService();
