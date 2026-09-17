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
}
const initial = (): UserData => ({
  version: 1,
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
class LocalUserDataService implements UserDataService {
  async getUser() {
    return (
      users.find(
        (user) => user.id === localStorage.getItem("anytime:session"),
      ) ?? null
    );
  }
  async signIn(username: string, password: string) {
    const user = users.find(
      (item) => item.username === username.trim().toLowerCase(),
    );
    if (!user || password !== "anytime")
      throw new Error("Use Mahdi, Kaido, or Ahmed with password anytime.");
    localStorage.setItem("anytime:session", user.id);
    return user;
  }
  async signOut() {
    localStorage.removeItem("anytime:session");
  }
  private async key() {
    const user = await this.getUser();
    if (!user) throw new Error("Please sign in again.");
    return `anytime:v1:user:${user.id}`;
  }
  async getData(): Promise<UserData> {
    const raw = localStorage.getItem(await this.key());
    if (!raw) return initial();
    try {
      const data = JSON.parse(raw) as UserData;
      if (
        data.version !== 1 ||
        !Array.isArray(data.favorites) ||
        !Array.isArray(data.completed) ||
        !data.progress ||
        typeof data.progress !== "object"
      )
        throw new Error();
      return data;
    } catch {
      return initial();
    }
  }
  private async save(data: UserData) {
    localStorage.setItem(await this.key(), JSON.stringify(data));
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
    if (progress.percent >= 98 && !data.completed.includes(key))
      data.completed.push(key);
    await this.save(data);
  }
  async getFriends() {
    const user = await this.getUser();
    return mockFriends.filter((friend) => friend.user.id !== user?.id);
  }
}
export const userDataService: UserDataService = new LocalUserDataService();
