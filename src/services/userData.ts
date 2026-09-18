import type {
  ActivityFeed,
  AvatarSeries,
  Friend,
  FriendRelationship,
  FriendRequests,
  FriendSearchResult,
  LibraryStatus,
  ProfileVisibility,
  ReadingHistoryEntry,
  ReadingProgress,
  User,
  UserData,
  UserListDetail,
  UserListSummary,
  UserProfileSection,
  UserProfileSectionInput,
  UserProfileView,
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
  getLists(): Promise<UserListSummary[]>;
  getList(id: string): Promise<UserListDetail>;
  getListMembership(mangaId: string): Promise<string[]>;
  createList(name: string, description?: string): Promise<UserListSummary>;
  updateList(id: string, name: string, description?: string): Promise<UserListSummary>;
  deleteList(id: string): Promise<void>;
  addWorkToList(listId: string, mangaId: string): Promise<void>;
  removeWorkFromList(listId: string, mangaId: string): Promise<void>;
  reorderListItem(
    listId: string,
    mangaId: string,
    beforeId?: string | null,
    afterId?: string | null,
  ): Promise<void>;
  getProfileSections(previewLimit?: number): Promise<UserProfileSection[]>;
  getMyActivity(limit?: number, offset?: number): Promise<ActivityFeed>;
  getFriendsActivity(limit?: number, offset?: number): Promise<ActivityFeed>;
  saveProfileSections(sections: UserProfileSectionInput[]): Promise<UserProfileSection[]>;
  getUserProfile(id: string, previewLimit?: number): Promise<UserProfileView>;
  getAvatarLibrary(): Promise<AvatarSeries[]>;
  setAvatar(avatarId: string): Promise<User>;
  setDisplayName(name: string): Promise<User>;
  setProfileVisibility(visibility: ProfileVisibility): Promise<User>;
  recordChapterOpen(mangaId: string, chapter: number): Promise<{ readAt: number }>;
  markChapterUnread(mangaId: string, chapter: number): Promise<void>;
  getReadingHistory(limit?: number): Promise<ReadingHistoryEntry[]>;
  getReadingProgress(): Promise<Record<string, ReadingProgress>>;
  saveReadingProgress(progress: ReadingProgress): Promise<void>;
  getFriends(): Promise<Friend[]>;
  getFriendRequests(): Promise<FriendRequests>;
  searchUsers(query: string): Promise<FriendSearchResult[]>;
  getFriendRelationship(id: string): Promise<FriendRelationship>;
  sendFriendRequest(id: string): Promise<FriendRelationship>;
  addFriend(username: string): Promise<FriendRelationship>;
  acceptFriendRequest(id: string): Promise<FriendRelationship>;
  rejectFriendRequest(id: string): Promise<FriendRelationship>;
  cancelFriendRequest(id: string): Promise<FriendRelationship>;
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
const isListId = (value?: string | null) =>
  Boolean(value && /^[a-zA-Z0-9_-]{1,128}$/.test(value));
const isAvatarId = (value?: string | null) =>
  Boolean(value && /^[a-zA-Z0-9:_-]{1,128}$/.test(value));
const isProfileSectionType = (value?: string | null) =>
  value === "continue_reading" ||
  value === "favorites" ||
  value === "my_activity" ||
  value === "friends_activity" ||
  value === "custom_list";

function normalizeProfileSections(sections: UserProfileSection[]): UserProfileSection[] {
  return (sections ?? []).flatMap((section) => {
    if (!isProfileSectionType(section.sectionType)) return [];
    if (section.sectionType === "custom_list" && !isListId(section.referenceId)) return [];
    return [{
      ...section,
      referenceId: section.sectionType === "custom_list" ? section.referenceId : null,
      previewItems: (section.previewItems ?? []).filter((id) => isLiveKey(id)),
    }];
  });
}

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

function normalizeUser(user: User): User {
  return {
    ...user,
    profileVisibility: user.profileVisibility === "public" ? "public" : "private",
    avatarId: isAvatarId(user.avatarId) ? user.avatarId : null,
  };
}

function normalizeAvatarSeries(series: AvatarSeries[]): AvatarSeries[] {
  return (series ?? []).slice(0, 10).map((group) => ({
    ...group,
    workId: group.workId ?? null,
    position: Number(group.position),
    avatars: (group.avatars ?? []).slice(0, 15).map((avatar) => ({
      ...avatar,
      seriesId: group.id,
      imageUrl: typeof avatar.imageUrl === "string" ? avatar.imageUrl : null,
      position: Number(avatar.position),
    })),
  }));
}

function normalizeFriends(friends: Friend[]): Friend[] {
  return friends.map((friend) => ({
    ...friend,
    user: normalizeUser(friend.user),
    reading: friend.reading && isLiveKey(friend.reading.mangaId) ? friend.reading : null,
    favorites: friend.favorites.filter((id) => isLiveKey(id)),
  }));
}

function normalizeRelationship(value: unknown): FriendRelationship {
  return value === "pending_sent" ||
    value === "pending_received" ||
    value === "friends"
    ? value
    : "none";
}

function normalizeFriendRequests(value: FriendRequests): FriendRequests {
  return {
    incoming: (value.incoming ?? []).map((request) => ({
      user: normalizeUser(request.user),
      createdAt: Number(request.createdAt),
    })),
    outgoing: (value.outgoing ?? []).map((request) => ({
      user: normalizeUser(request.user),
      createdAt: Number(request.createdAt),
    })),
    incomingCount: Number(value.incomingCount ?? 0),
    outgoingCount: Number(value.outgoingCount ?? 0),
  };
}

function normalizeUserProfile(profile: UserProfileView): UserProfileView {
  return {
    ...profile,
    user: normalizeUser(profile.user),
    favorites: (profile.favorites ?? []).filter((id) => isLiveKey(id)),
    library: profile.library?.filter((item) => isLiveKey(item.mangaId)),
    lists: profile.lists?.map((list) => ({
      ...list,
      previewItems: (list.previewItems ?? []).filter((id) => isLiveKey(id)),
    })),
    friends: profile.friends?.map(normalizeUser),
    activity: profile.activity?.map((event) => ({
      ...event,
      user: normalizeUser(event.user),
      mangaId: event.mangaId && isLiveKey(event.mangaId) ? event.mangaId : null,
      list: event.list ?? null,
      chapterNumber: event.chapterNumber == null ? null : Number(event.chapterNumber),
      createdAt: Number(event.createdAt),
      updatedAt: Number(event.updatedAt),
    })),
    relationship: normalizeRelationship(profile.relationship),
  };
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
    this.currentUser = result.user ? normalizeUser(result.user) : null;
    this.cleaned = false;
    return this.currentUser;
  }

  async signIn(username: string, password: string) {
    const result = await this.request<{ user: User }>("login", {
      method: "POST",
      body: JSON.stringify({ username: username.trim().toLowerCase(), password }),
    });
    this.currentUser = normalizeUser(result.user);
    this.cleaned = false;
    await this.cleanupDemoData();
    return this.currentUser;
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

  async getLists() {
    const result = await this.request<{ lists: UserListSummary[] }>("lists");
    return result.lists ?? [];
  }

  async getList(id: string) {
    if (!isListId(id)) throw new Error("معرّف القائمة غير صالح.");
    const result = await this.request<{
      list: UserListSummary;
      items: UserListDetail["items"];
    }>(`lists/${encodeURIComponent(id)}`);
    return {
      ...result.list,
      items: (result.items ?? []).filter((item) => isLiveKey(item.mangaId)),
    };
  }

  async getListMembership(mangaId: string) {
    if (!isLiveKey(mangaId)) throw new Error("هذا العمل ليس من مصدر مدعوم.");
    const result = await this.request<{ listIds: string[] }>(
      `lists/membership/${encodeURIComponent(mangaId)}`,
    );
    return (result.listIds ?? []).filter((id) => isListId(id));
  }

  async createList(name: string, description = "") {
    const result = await this.request<{ list: UserListSummary }>("lists", {
      method: "POST",
      body: JSON.stringify({ name, description }),
    });
    return result.list;
  }

  async updateList(id: string, name: string, description = "") {
    if (!isListId(id)) throw new Error("معرّف القائمة غير صالح.");
    const result = await this.request<{ list: UserListSummary }>(
      `lists/${encodeURIComponent(id)}`,
      {
        method: "PUT",
        body: JSON.stringify({ name, description }),
      },
    );
    return result.list;
  }

  async deleteList(id: string) {
    if (!isListId(id)) throw new Error("معرّف القائمة غير صالح.");
    await this.request<{ ok: boolean }>(`lists/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  }

  async addWorkToList(listId: string, mangaId: string) {
    if (!isListId(listId) || !isLiveKey(mangaId)) {
      throw new Error("بيانات القائمة غير صالحة.");
    }
    await this.request<{ ok: boolean }>(`lists/${encodeURIComponent(listId)}/items`, {
      method: "POST",
      body: JSON.stringify({ mangaId }),
    });
  }

  async removeWorkFromList(listId: string, mangaId: string) {
    if (!isListId(listId) || !isLiveKey(mangaId)) {
      throw new Error("بيانات القائمة غير صالحة.");
    }
    await this.request<{ ok: boolean }>(
      `lists/${encodeURIComponent(listId)}/items/${encodeURIComponent(mangaId)}`,
      { method: "DELETE" },
    );
  }

  async reorderListItem(
    listId: string,
    mangaId: string,
    beforeId: string | null = null,
    afterId: string | null = null,
  ) {
    if (
      !isListId(listId) ||
      !isLiveKey(mangaId) ||
      (beforeId != null && !isLiveKey(beforeId)) ||
      (afterId != null && !isLiveKey(afterId))
    ) {
      throw new Error("بيانات الترتيب غير صالحة.");
    }
    await this.request<{ ok: boolean }>(`lists/${encodeURIComponent(listId)}/reorder`, {
      method: "PUT",
      body: JSON.stringify({ mangaId, beforeId, afterId }),
    });
  }

  async getProfileSections(previewLimit = 8) {
    const limit = Math.max(1, Math.min(10, Math.trunc(previewLimit)));
    const result = await this.request<{ sections: UserProfileSection[] }>(
      `profile/sections?limit=${limit}`,
    );
    return normalizeProfileSections(result.sections);
  }

  async getMyActivity(limit = 12, offset = 0) {
    const safeLimit = Math.max(1, Math.min(20, Math.trunc(limit)));
    const safeOffset = Math.max(0, Math.trunc(offset));
    return await this.request<ActivityFeed>(
      `activity/me?limit=${safeLimit}&offset=${safeOffset}`,
    );
  }

  async getFriendsActivity(limit = 12, offset = 0) {
    const safeLimit = Math.max(1, Math.min(20, Math.trunc(limit)));
    const safeOffset = Math.max(0, Math.trunc(offset));
    return await this.request<ActivityFeed>(
      `activity/friends?limit=${safeLimit}&offset=${safeOffset}`,
    );
  }

  async saveProfileSections(sections: UserProfileSectionInput[]) {
    if (!Array.isArray(sections) || sections.length > 100) {
      throw new Error("ترتيب الأقسام غير صالح.");
    }
    const normalized = sections.map((section) => ({
      sectionType: section.sectionType,
      referenceId: section.sectionType === "custom_list" ? section.referenceId : null,
      isVisible: Boolean(section.isVisible),
    }));
    if (
      normalized.some(
        (section) =>
          !isProfileSectionType(section.sectionType) ||
          (section.sectionType === "custom_list" && !isListId(section.referenceId)),
      )
    ) {
      throw new Error("ترتيب الأقسام غير صالح.");
    }
    const result = await this.request<{ sections: UserProfileSection[] }>("profile/sections", {
      method: "PUT",
      body: JSON.stringify({ sections: normalized }),
    });
    return normalizeProfileSections(result.sections);
  }

  async getUserProfile(id: string, previewLimit = 8) {
    if (!isListId(id)) throw new Error("معرّف المستخدم غير صالح.");
    const limit = Math.max(1, Math.min(10, Math.trunc(previewLimit)));
    const result = await this.request<{ profile: UserProfileView }>(
      `profiles/${encodeURIComponent(id)}?limit=${limit}`,
    );
    return normalizeUserProfile(result.profile);
  }

  async getAvatarLibrary() {
    const result = await this.request<{ series: AvatarSeries[] }>("avatars");
    return normalizeAvatarSeries(result.series);
  }

  async setAvatar(avatarId: string) {
    if (!isAvatarId(avatarId)) throw new Error("الصورة الشخصية غير صالحة.");
    const result = await this.request<{ user: User }>("profile/avatar", {
      method: "PUT",
      body: JSON.stringify({ avatarId }),
    });
    this.currentUser = normalizeUser(result.user);
    return this.currentUser;
  }

  async setDisplayName(name: string) {
    const normalized = name.trim();
    if (!normalized || normalized.length > 50 || /[\u0000-\u001f\u007f]/.test(normalized)) {
      throw new Error("اسم العرض مطلوب ويجب ألا يتجاوز 50 حرفًا.");
    }
    const result = await this.request<{ user: User }>("profile/name", {
      method: "PUT",
      body: JSON.stringify({ name: normalized }),
    });
    this.currentUser = normalizeUser(result.user);
    return this.currentUser;
  }

  async setProfileVisibility(visibility: ProfileVisibility) {
    const normalized: ProfileVisibility = visibility === "public" ? "public" : "private";
    const result = await this.request<{ user: User }>("profile/visibility", {
      method: "PUT",
      body: JSON.stringify({ visibility: normalized }),
    });
    this.currentUser = normalizeUser(result.user);
    return this.currentUser;
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
      const result = await this.request<{ friends: Friend[]; total: number; hasMore: boolean }>(
        "friends?limit=100",
      );
      const friends = normalizeFriends(result.friends ?? []);
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

  async getFriendRequests() {
    const result = await this.request<FriendRequests>("friends/requests");
    return normalizeFriendRequests(result);
  }

  async searchUsers(query: string) {
    const normalized = query.trim().replace(/\s+/g, " ").slice(0, 64);
    if (!normalized) return [];
    const result = await this.request<{ results: FriendSearchResult[] }>(
      `friends/search?q=${encodeURIComponent(normalized)}`,
    );
    return (result.results ?? []).map((item) => ({
      user: normalizeUser(item.user),
      relationship: normalizeRelationship(item.relationship),
    }));
  }

  async getFriendRelationship(id: string) {
    if (!isListId(id)) throw new Error("معرّف المستخدم غير صالح.");
    const result = await this.request<{ relationship: FriendRelationship }>(
      `friends/relationship/${encodeURIComponent(id)}`,
    );
    return normalizeRelationship(result.relationship);
  }

  async sendFriendRequest(id: string) {
    if (!isListId(id)) throw new Error("معرّف المستخدم غير صالح.");
    const result = await this.request<{ relationship: FriendRelationship }>("friends", {
      method: "POST",
      body: JSON.stringify({ userId: id }),
    });
    return normalizeRelationship(result.relationship);
  }

  async addFriend(username: string) {
    const result = await this.request<{ relationship: FriendRelationship }>("friends", {
      method: "POST",
      body: JSON.stringify({ username: username.trim().toLowerCase() }),
    });
    return normalizeRelationship(result.relationship);
  }

  async acceptFriendRequest(id: string) {
    if (!isListId(id)) throw new Error("معرّف المستخدم غير صالح.");
    const result = await this.request<{ relationship: FriendRelationship }>(
      `friends/requests/${encodeURIComponent(id)}/accept`,
      { method: "POST" },
    );
    return normalizeRelationship(result.relationship);
  }

  async rejectFriendRequest(id: string) {
    if (!isListId(id)) throw new Error("معرّف المستخدم غير صالح.");
    const result = await this.request<{ relationship: FriendRelationship }>(
      `friends/requests/${encodeURIComponent(id)}/reject`,
      { method: "POST" },
    );
    return normalizeRelationship(result.relationship);
  }

  async cancelFriendRequest(id: string) {
    if (!isListId(id)) throw new Error("معرّف المستخدم غير صالح.");
    const result = await this.request<{ relationship: FriendRelationship }>(
      `friends/requests/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    );
    return normalizeRelationship(result.relationship);
  }

  async removeFriend(id: string) {
    if (!isListId(id)) throw new Error("معرّف المستخدم غير صالح.");
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
