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
      throw new Error("تعذر الاتصال بخدمة المزامنة. تحقق من الإنترنت وحاول مرة ثانية.");
    }

    const payload = (await response.json().catch(() => ({}))) as T & ApiErrorPayload;
    if (!response.ok) {
      if (response.status === 503 && payload.error === "D1_NOT_CONFIGURED") {
        throw new Error("قاعدة بيانات Anytime غير مربوطة بالموقع بعد.");
      }
      throw new Error(payload.message || "تعذر مزامنة بياناتك الآن.");
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
      if (snapshot) return snapshot;
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
      if (snapshot) return snapshot;
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
      // Keep the Phase 1 data so the migration can retry on the next login.
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
      // Snapshots are optional; server state remains authoritative.
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
