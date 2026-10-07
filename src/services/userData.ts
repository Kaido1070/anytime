import type {
  ActivityFeed,
  AdminUserDetail,
  AdminUserSummary,
  AvatarSeries,
  Friend,
  FriendRelationship,
  FriendRequests,
  FriendSearchResult,
  LibraryStatus,
  PersonalizationState,
  ProfileVisibility,
  ReadChapterPair,
  ReadingHistoryEntry,
  ReadingProgress,
  ReadingStats,
  User,
  UserData,
  UserListDetail,
  UserListSummary,
  UserProfileSection,
  UserProfileSectionInput,
  UserProfileView,
  WorkSnapshot,
} from "../types";

export interface AccountScope {
  key: string;
  signal: AbortSignal;
  isCurrent(): boolean;
  assertCurrent(): void;
}

export interface UserDataService {
  captureAccountScope(): AccountScope | null;
  getUser(): Promise<User | null>;
  signIn(username: string, password: string): Promise<User>;
  register(username: string, password: string, inviteCode: string): Promise<void>;
  signOut(allDevices?: boolean): Promise<void>;
  generateRecoveryCode(currentPassword: string): Promise<string>;
  setSecurityQuestion(currentPassword: string, question: string, answer: string): Promise<void>;
  getSecurityQuestion(username: string): Promise<string>;
  recoverWithSecurityAnswer(username: string, answer: string, newPassword: string): Promise<void>;
  recoverPassword(username: string, recoveryCode: string, newPassword: string): Promise<void>;
  getData(): Promise<UserData>;
  getCachedData(): UserData | null;
  cacheData(data: UserData): void;
  getCachedOverview(): { profile: UserProfileView; sections: UserProfileSection[] } | null;
  getCachedWorkSnapshots(keys: string[]): WorkSnapshot[];
  getFavorites(): Promise<string[]>;
  addFavorite(id: string): Promise<void>;
  removeFavorite(id: string): Promise<void>;
  addToLibrary(id: string, status?: LibraryStatus): Promise<void>;
  setLibraryStatus(id: string, status: LibraryStatus): Promise<void>;
  removeFromLibrary(id: string): Promise<void>;
  getLists(): Promise<UserListSummary[]>;
  getList(id: string): Promise<UserListDetail>;
  getListMembership(mangaId: string): Promise<string[]>;
  createList(name: string, description?: string, iconKey?: string): Promise<UserListSummary>;
  updateList(id: string, name: string, description?: string, iconKey?: string): Promise<UserListSummary>;
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
  getAdminUsers(options?: { query?: string; visibility?: string; status?: string; sort?: string; limit?: number; offset?: number }): Promise<{ users: AdminUserSummary[]; total: number; hasMore: boolean }>;
  getAdminSecurityQuestion(id: string): Promise<{ question: string | null; recoveryLocked: boolean; failedAnswers: number }>;
  adminResetPassword(id: string, currentPassword: string, newPassword: string): Promise<void>;
  adminUnlockRecovery(id: string, currentPassword: string): Promise<void>;
  getAdminUser(id: string, historyLimit?: number, historyOffset?: number): Promise<AdminUserDetail>;
  getAvatarLibrary(): Promise<AvatarSeries[]>;
  setAvatar(avatarId: string): Promise<User>;
  setDisplayName(name: string): Promise<User>;
  setProfileVisibility(visibility: ProfileVisibility): Promise<User>;
  recordChapterOpen(mangaId: string, chapter: number): Promise<{ readAt: number }>;
  markChapterUnread(mangaId: string, chapter: number): Promise<void>;
  markWorkUnread(mangaId: string): Promise<void>;
  markChaptersRead(mangaId: string, chapters: number[]): Promise<number>;
  getReadingHistory(limit?: number): Promise<ReadingHistoryEntry[]>;
  getReadingStats(): Promise<ReadingStats>;
  getPersonalizationState(): Promise<PersonalizationState>;
  getReadChapterPairs(chapters: ReadChapterPair[]): Promise<ReadChapterPair[]>;
  getReadingProgress(): Promise<Record<string, ReadingProgress>>;
  saveReadingProgress(progress: ReadingProgress): Promise<void>;
  getWorkSnapshots(keys: string[]): Promise<WorkSnapshot[]>;
  saveWorkSnapshot(input: {
    mangaId: string;
    title: string;
    source?: string | null;
    sourceUrl?: string | null;
    coverUrl?: string | null;
    chapter?: number | null;
    chapterMetadata?: WorkSnapshot["chapterMetadata"];
  }): Promise<{ needsCover: boolean }>;
  saveWorkSnapshotCover(mangaId: string, blob: Blob): Promise<void>;
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

const isLiveKey = (value?: string | null) => Boolean(value && /^(mt|tx|aq|sz|xs|ml|az):/.test(value));
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

export const PERSONALIZATION_CHANGE_EVENT = "wany:personalization-change";

function emitPersonalizationChange() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(PERSONALIZATION_CHANGE_EVENT));
  }
}

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
    return item ? isLiveKey(item.mangaId) : /^(mt|tx|aq|sz|xs|ml|az):/.test(key);
  });
  const lastOpened = data.lastOpened && isLiveKey(data.lastOpened.mangaId) ? data.lastOpened : null;
  return { ...data, version: 3, favorites, library, progress, completed, lastOpened };
}

function normalizeUser(user: User): User {
  return {
    ...user,
    profileVisibility: user.profileVisibility === "public" ? "public" : "private",
    avatarId: isAvatarId(user.avatarId) ? user.avatarId : null,
    ...(user.role === "admin" ? { role: "admin" as const } : user.role === "user" ? { role: "user" as const } : {}),
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
  private generation = 0;
  private accountController = new AbortController();
  private authQueue: Promise<void> = Promise.resolve();
  private storageListenerReady = false;
  private pendingReads = new Map<string, Promise<unknown>>();

  captureAccountScope(): AccountScope | null {
    if (!this.currentUser) return null;
    const generation = this.generation;
    return {
      key: `${this.currentUser.id}:${generation}`,
      signal: this.accountController.signal,
      isCurrent: () => this.generation === generation,
      assertCurrent: () => this.assertGeneration(generation),
    };
  }

  private assertGeneration(generation: number) {
    if (this.generation !== generation) throw new ApiError("تغير الحساب؛ تم تجاهل العملية السابقة.", 409, "ACCOUNT_CHANGED");
  }

  private queueAuth<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.authQueue.then(operation);
    this.authQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  private replaceAccount(user: User | null, preserveOwnCache = false, notifyOtherTabs = false) {
    this.accountController.abort();
    this.accountController = new AbortController();
    this.generation++;
    this.pendingReads.clear();
    this.clearPersonalCache(preserveOwnCache ? user?.id : undefined);
    this.currentUser = user;
    this.cleaned = false;
    if (typeof window !== "undefined" && !this.storageListenerReady) {
      window.addEventListener("storage", event => {
        if (event.key !== "wany:account-change") return;
        this.replaceAccount(null);
        window.location.reload();
      });
      this.storageListenerReady = true;
    }
    if (notifyOtherTabs) {
      try { localStorage.setItem("wany:account-change", crypto.randomUUID()); } catch { /* Storage may be disabled. */ }
    }
  }

  private clearPersonalCache(preserveUserId?: string) {
    // Remove historical snapshots as well: a v2 snapshot may already contain
    // data written under the wrong account by the retired implementation.
    try {
      if (typeof localStorage !== "undefined") {
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const key = localStorage.key(i);
          const privateKey = key && (key.startsWith("anytime:v1:") || key.startsWith("anytime:v2:migrated:") || key === "anytime:session" || /^anytime:v[23]:(?:data|friends|profile|sections|works):/.test(key));
          const keep = preserveUserId && ["data", "friends", "profile", "sections", "works"].some(kind => key === `anytime:v3:${kind}:${preserveUserId}`);
          if (privateKey && !keep) localStorage.removeItem(key!);
        }
      }
      if (typeof sessionStorage !== "undefined") {
        for (let i = sessionStorage.length - 1; i >= 0; i--) {
          const key = sessionStorage.key(i);
          if (key?.startsWith("wany:fyp:") && !(preserveUserId && key.startsWith(`wany:fyp:${preserveUserId}:`))) sessionStorage.removeItem(key);
        }
      }
    } catch {
      // Some browsers disable storage; requests still enforce account scope.
    }
  }

  private request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if ((init.method ?? "GET").toUpperCase() !== "GET") {
      // A mutation must never join a read that began before that mutation.
      this.pendingReads.clear();
      return this.requestOnce<T>(path, init);
    }
    const key = `${this.generation}:${path}`;
    const existing = this.pendingReads.get(key);
    if (existing) return existing as Promise<T>;
    const pending = this.requestOnce<T>(path, init).finally(() => {
      if (this.pendingReads.get(key) === pending) this.pendingReads.delete(key);
    });
    this.pendingReads.set(key, pending);
    return pending;
  }

  private async requestOnce<T>(path: string, init: RequestInit = {}): Promise<T> {
    const generation = this.generation;
    let response: Response;
    try {
      response = await fetch(`/api/${path}`, {
        ...init,
        signal: init.signal ?? this.accountController.signal,
        credentials: "include",
        cache: "no-store",
        headers: {
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...init.headers,
        },
      });
    } catch {
      this.assertGeneration(generation);
      throw new ApiError(
        "تعذر الاتصال بخدمة المزامنة. تحقق من الإنترنت وحاول مرة ثانية.",
        0,
        "NETWORK_ERROR",
      );
    }

    const payload = (await response.json().catch(() => ({}))) as T & ApiErrorPayload;
    this.assertGeneration(generation);
    if (!response.ok) {
      throw new ApiError(
        payload.message || "تعذر مزامنة بياناتك الآن.",
        response.status,
        payload.error,
      );
    }
    return payload;
  }

  getUser() {
    return this.queueAuth(async () => {
      const result = await this.request<{ user: User | null }>("session");
      const user = result.user ? normalizeUser(result.user) : null;
      if (!user || user.id !== this.currentUser?.id) this.replaceAccount(user, this.currentUser === null);
      else this.currentUser = user;
      return this.currentUser;
    });
  }

  signIn(username: string, password: string) {
    return this.queueAuth(async () => {
      const normalizedUsername = username.normalize("NFKC").trim().toLowerCase();
      const endpoint = "login";
      const result = await this.request<{ user: User }>(endpoint, {
        method: "POST",
        body: JSON.stringify({ username: normalizedUsername, password }),
      });
      const user = normalizeUser(result.user);
      this.replaceAccount(user, false, true);
      return user;
    });
  }

  async register(username: string, password: string, inviteCode: string) {
    await this.request<{ ok: boolean }>("register", {
      method: "POST",
      body: JSON.stringify({ username: username.normalize("NFKC").trim().toLowerCase(), password, inviteCode: inviteCode.trim() }),
    });
  }

  signOut(allDevices = false) {
    return this.queueAuth(async () => {
      await this.request<{ ok: boolean }>(allDevices ? "logout-all" : "logout", { method: "POST" });
      this.replaceAccount(null, false, true);
    });
  }

  async recoverPassword(username: string, recoveryCode: string, newPassword: string) {
    const normalizedUsername = username
      .normalize("NFKC")
      .trim()
      .toLowerCase();
    await this.request<{ ok: boolean }>("recover-password", {
      method: "POST",
      body: JSON.stringify({ username: normalizedUsername, recoveryCode: recoveryCode.trim(), newPassword }),
    });
  }

  getCachedData(): UserData | null {
    const cached = this.readSnapshot<UserData>("data");
    return cached ? normalizeData(cached) : null;
  }

  cacheData(data: UserData) { this.writeSnapshot("data", normalizeData(data)); }

  getCachedOverview() {
    const profile = this.readSnapshot<UserProfileView>("profile");
    const sections = this.readSnapshot<UserProfileSection[]>("sections");
    return profile && sections ? { profile, sections } : null;
  }

  getCachedWorkSnapshots(keys: string[]) {
    const cached = this.readSnapshot<Record<string, WorkSnapshot>>("works") ?? {};
    return keys.flatMap((key) => cached[key] ? [cached[key]] : []);
  }

  async getData(): Promise<UserData> {
    const generation = this.generation;
    await this.cleanupDemoData();
    this.assertGeneration(generation);
    try {
      const result = await this.request<{ data: UserData }>("data");
      this.assertGeneration(generation);
      const data = normalizeData(result.data);
      this.writeSnapshot("data", data);
      return data;
    } catch (error) {
      this.assertGeneration(generation);
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
    if (!isLiveKey(id)) throw new Error("هذه القصة ليست من مصدر مدعوم.");
    await this.request<{ ok: boolean }>("favorites", {
      method: "POST",
      body: JSON.stringify({ mangaId: id }),
    });
    emitPersonalizationChange();
  }

  async removeFavorite(id: string) {
    await this.request<{ ok: boolean }>(`favorites/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    emitPersonalizationChange();
  }

  async addToLibrary(id: string, status: LibraryStatus = "planned") {
    if (!isLiveKey(id)) throw new Error("هذه القصة ليست من مصدر مدعوم.");
    await this.request<{ ok: boolean }>("library", {
      method: "POST",
      body: JSON.stringify({ mangaId: id, status }),
    });
    emitPersonalizationChange();
  }

  async setLibraryStatus(id: string, status: LibraryStatus) {
    if (!isLiveKey(id)) throw new Error("هذه القصة ليست من مصدر مدعوم.");
    await this.request<{ ok: boolean }>("library", {
      method: "PUT",
      body: JSON.stringify({ mangaId: id, status }),
    });
    emitPersonalizationChange();
  }

  async removeFromLibrary(id: string) {
    await this.request<{ ok: boolean }>(`library/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    emitPersonalizationChange();
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
    if (!isLiveKey(mangaId)) throw new Error("هذه القصة ليست من مصدر مدعوم.");
    const result = await this.request<{ listIds: string[] }>(
      `lists/membership/${encodeURIComponent(mangaId)}`,
    );
    return (result.listIds ?? []).filter((id) => isListId(id));
  }

  async createList(name: string, description = "", iconKey = "lists") {
    const result = await this.request<{ list: UserListSummary }>("lists", {
      method: "POST",
      body: JSON.stringify({ name, description, iconKey }),
    });
    return result.list;
  }

  async updateList(id: string, name: string, description = "", iconKey = "lists") {
    if (!isListId(id)) throw new Error("معرّف القائمة غير صالح.");
    const result = await this.request<{ list: UserListSummary }>(
      `lists/${encodeURIComponent(id)}`,
      {
        method: "PUT",
        body: JSON.stringify({ name, description, iconKey }),
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
    emitPersonalizationChange();
  }

  async removeWorkFromList(listId: string, mangaId: string) {
    if (!isListId(listId) || !isLiveKey(mangaId)) {
      throw new Error("بيانات القائمة غير صالحة.");
    }
    await this.request<{ ok: boolean }>(
      `lists/${encodeURIComponent(listId)}/items/${encodeURIComponent(mangaId)}`,
      { method: "DELETE" },
    );
    emitPersonalizationChange();
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
    const sections = normalizeProfileSections(result.sections);
    this.writeSnapshot("sections", sections);
    return sections;
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
    const profile = normalizeUserProfile(result.profile);
    if (id === this.currentUser?.id) this.writeSnapshot("profile", profile);
    return profile;
  }

  async getAdminUsers(options: { query?: string; visibility?: string; status?: string; sort?: string; limit?: number; offset?: number } = {}) {
    const params = new URLSearchParams();
    const query = options.query?.trim().replace(/\s+/g, " ").slice(0, 64);
    if (query) params.set("q", query);
    if (options.visibility === "public" || options.visibility === "private") params.set("visibility", options.visibility);
    if (options.status === "reading") params.set("status", "reading");
    if (options.sort === "username" || options.sort === "works" || options.sort === "chapters") params.set("sort", options.sort);
    params.set("limit", String(Math.max(1, Math.min(100, Math.trunc(options.limit ?? 50)))));
    params.set("offset", String(Math.max(0, Math.trunc(options.offset ?? 0))));
    const result = await this.request<{ users: AdminUserSummary[]; total: number; hasMore: boolean }>(`admin/users?${params.toString()}`);
    return {
      users: (result.users ?? []).map((item) => ({
        ...item,
        user: normalizeUser(item.user),
        worksCount: Number(item.worksCount ?? 0),
        chaptersReadCount: Number(item.chaptersReadCount ?? 0),
        listsCount: Number(item.listsCount ?? 0),
        friendsCount: Number(item.friendsCount ?? 0),
      })),
      total: Number(result.total ?? 0),
      hasMore: Boolean(result.hasMore),
    };
  }

  async getAdminSecurityQuestion(id: string) {
    const result = await this.request<{ question: string | null; recoveryLocked: boolean; failedAnswers: number }>(`admin/users/${encodeURIComponent(id)}/security-question`);
    return result;
  }

  async adminResetPassword(id: string, currentPassword: string, newPassword: string) {
    await this.request(`admin/users/${encodeURIComponent(id)}/reset-password`, { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) });
  }

  async adminUnlockRecovery(id: string, currentPassword: string) {
    await this.request(`admin/users/${encodeURIComponent(id)}/unlock-recovery`, { method: "POST", body: JSON.stringify({ currentPassword }) });
  }

  async getAdminUser(id: string, historyLimit = 50, historyOffset = 0) {
    if (!isListId(id)) throw new Error("معرّف المستخدم غير صالح.");
    const limit = Math.max(1, Math.min(100, Math.trunc(historyLimit)));
    const offset = Math.max(0, Math.trunc(historyOffset));
    const result = await this.request<{ detail: AdminUserDetail }>(`admin/users/${encodeURIComponent(id)}?historyLimit=${limit}&historyOffset=${offset}`);
    const detail = result.detail;
    return {
      ...detail,
      user: normalizeUser(detail.user),
      library: (detail.library ?? []).filter((item) => isLiveKey(item.mangaId)),
      readingHistory: (detail.readingHistory ?? []).filter((item) => isLiveKey(item.mangaId)),
      lists: (detail.lists ?? []).map((list) => ({ ...list, items: (list.items ?? []).filter((item) => isLiveKey(item.mangaId)) })),
      favorites: (detail.favorites ?? []).filter((mangaId) => isLiveKey(mangaId)),
      friends: (detail.friends ?? []).map(normalizeUser),
      activity: detail.activity ?? [],
    };
  }

  async getAvatarLibrary() {
    const result = await this.request<{ series: AvatarSeries[] }>("avatars");
    return normalizeAvatarSeries(result.series);
  }

  async setAvatar(avatarId: string) {
    const generation = this.generation;
    if (!isAvatarId(avatarId)) throw new Error("الصورة الشخصية غير صالحة.");
    const result = await this.request<{ user: User }>("profile/avatar", {
      method: "PUT",
      body: JSON.stringify({ avatarId }),
    });
    this.assertGeneration(generation);
    this.currentUser = normalizeUser(result.user);
    return this.currentUser;
  }

  async setDisplayName(name: string) {
    const generation = this.generation;
    const normalized = name.trim();
    if (!normalized || normalized.length > 50 || /[\u0000-\u001f\u007f]/.test(normalized)) {
      throw new Error("اسم العرض مطلوب ويجب ألا يتجاوز 50 حرفًا.");
    }
    const result = await this.request<{ user: User }>("profile/name", {
      method: "PUT",
      body: JSON.stringify({ name: normalized }),
    });
    this.assertGeneration(generation);
    this.currentUser = normalizeUser(result.user);
    return this.currentUser;
  }

  async setProfileVisibility(visibility: ProfileVisibility) {
    const generation = this.generation;
    const normalized: ProfileVisibility = visibility === "public" ? "public" : "private";
    const result = await this.request<{ user: User }>("profile/visibility", {
      method: "PUT",
      body: JSON.stringify({ visibility: normalized }),
    });
    this.assertGeneration(generation);
    this.currentUser = normalizeUser(result.user);
    return this.currentUser;
  }

  async recordChapterOpen(mangaId: string, chapter: number) {
    if (!isLiveKey(mangaId) || !Number.isFinite(chapter) || chapter < 0) {
      throw new Error("بيانات الفصل غير صالحة.");
    }
    const result = await this.request<{ ok: boolean; readAt: number }>("reading/open", {
      method: "POST",
      body: JSON.stringify({ mangaId, chapter }),
      keepalive: true,
    });
    emitPersonalizationChange();
    return result;
  }

  async markChapterUnread(mangaId: string, chapter: number) {
    if (!isLiveKey(mangaId) || !Number.isFinite(chapter) || chapter < 0) {
      throw new Error("بيانات الفصل غير صالحة.");
    }
    await this.request<{ ok: boolean }>("reading/unread", {
      method: "POST",
      body: JSON.stringify({ mangaId, chapter }),
    });
    emitPersonalizationChange();
  }

  async markWorkUnread(mangaId: string) {
    if (!isLiveKey(mangaId)) throw new Error("بيانات القصة غير صالحة.");
    await this.request<{ ok: boolean }>("reading/unread-work", {
      method: "POST",
      body: JSON.stringify({ mangaId }),
    });
    emitPersonalizationChange();
  }

  async markChaptersRead(mangaId: string, chapters: number[]) {
    if (!isLiveKey(mangaId)) throw new Error("بيانات القصة غير صالحة.");
    const normalized = [...new Set(chapters.map(Number).filter((chapter) => Number.isFinite(chapter) && chapter >= 0))].slice(0, 1000);
    if (!normalized.length) return 0;
    const result = await this.request<{ ok: boolean; processed: number }>("reading/read-bulk", {
      method: "POST",
      body: JSON.stringify({ mangaId, chapters: normalized }),
    });
    return Number(result.processed ?? normalized.length);
  }

  async getReadingHistory(limit = 100) {
    const normalizedLimit = Math.max(1, Math.min(200, Math.trunc(limit)));
    const result = await this.request<{ history: ReadingHistoryEntry[] }>(
      `reading/history?limit=${normalizedLimit}`,
    );
    return result.history.filter((item) => isLiveKey(item.mangaId));
  }

  async getReadingStats() {
    const result = await this.request<{ stats: ReadingStats }>("reading/stats");
    return result.stats;
  }

  async getPersonalizationState() {
    const result = await this.request<PersonalizationState>("personalization-state");
    return {
      followed: (result.followed ?? []).filter((item) => isLiveKey(item.mangaId)),
      readingWorks: (result.readingWorks ?? []).filter((item) => isLiveKey(item.mangaId)),
    };
  }

  async getReadChapterPairs(chapters: ReadChapterPair[]) {
    const normalized = chapters.filter(
      (item) => isLiveKey(item.mangaId) && Number.isFinite(item.chapter) && item.chapter >= 0,
    );
    if (!normalized.length) return [];

    const chunks: ReadChapterPair[][] = [];
    for (let index = 0; index < normalized.length; index += 40) {
      chunks.push(normalized.slice(index, index + 40));
    }
    const results = await Promise.all(
      chunks.map((chunk) =>
        this.request<{ read: ReadChapterPair[] }>("personalization-state", {
          method: "POST",
          body: JSON.stringify({ chapters: chunk }),
        }),
      ),
    );
    const unique = new Map<string, ReadChapterPair>();
    for (const result of results) {
      for (const item of result.read ?? []) {
        if (!isLiveKey(item.mangaId) || !Number.isFinite(item.chapter)) continue;
        unique.set(`${item.mangaId}:${item.chapter}`, item);
      }
    }
    return [...unique.values()];
  }

  async getWorkSnapshots(keys: string[]) {
    const normalized = [...new Set(keys.filter((key) => isLiveKey(key)))].slice(0, 100);
    if (!normalized.length) return [];
    const result = await this.request<{ snapshots: WorkSnapshot[] }>(
      `work-snapshots?keys=${encodeURIComponent(normalized.join(","))}`,
    );
    const snapshots = (result.snapshots ?? []).filter((snapshot) => isLiveKey(snapshot.mangaId));
    const cached = this.readSnapshot<Record<string, WorkSnapshot>>("works") ?? {};
    for (const snapshot of snapshots) {
      snapshot.chapterMetadata = cached[snapshot.mangaId]?.chapterMetadata;
      cached[snapshot.mangaId] = snapshot;
    }
    this.writeSnapshot("works", cached);
    return snapshots;
  }

  async saveWorkSnapshot(input: {
    mangaId: string;
    title: string;
    source?: string | null;
    sourceUrl?: string | null;
    coverUrl?: string | null;
    chapter?: number | null;
    chapterMetadata?: WorkSnapshot["chapterMetadata"];
  }) {
    if (!isLiveKey(input.mangaId)) throw new Error("هذه القصة ليست من مصدر مدعوم.");
    const { chapterMetadata, ...serverInput } = input;
    const result = await this.request<{ ok: boolean; needsCover: boolean }>("work-snapshots", {
      method: "POST",
      body: JSON.stringify(serverInput),
    });
    const cached = this.readSnapshot<Record<string, WorkSnapshot>>("works") ?? {};
    const previous = cached[input.mangaId];
    const chapter = input.chapter ?? previous?.lastReadChapter ?? null;
    cached[input.mangaId] = {
      mangaId: input.mangaId,
      chapterMetadata: input.chapterMetadata ?? previous?.chapterMetadata,
      title: input.title,
      source: (input.source ?? previous?.source ?? null) as WorkSnapshot["source"],
      sourceUrl: input.sourceUrl ?? previous?.sourceUrl ?? null,
      originalCoverUrl: input.coverUrl ?? previous?.originalCoverUrl ?? null,
      coverUrl: !result.needsCover ? previous?.coverUrl ?? input.coverUrl ?? null : input.coverUrl ?? null,
      lastReadChapter: chapter,
      highestReachedChapter: chapter == null ? previous?.highestReachedChapter ?? null : Math.max(chapter, previous?.highestReachedChapter ?? chapter),
      lastReadAt: input.chapter != null ? Date.now() : previous?.lastReadAt ?? null,
      updatedAt: Date.now(),
    };
    this.writeSnapshot("works", cached);
    return result;
  }

  async saveWorkSnapshotCover(mangaId: string, blob: Blob) {
    if (!isLiveKey(mangaId)) throw new Error("هذه القصة ليست من مصدر مدعوم.");
    const generation = this.generation;
    let response: Response;
    try {
      response = await fetch(
        `/api/work-snapshots/cover?key=${encodeURIComponent(mangaId)}`,
        {
          method: "PUT",
          signal: this.accountController.signal,
          credentials: "include",
          cache: "no-store",
          headers: {
            "Content-Type": blob.type || "image/jpeg",
          },
          body: blob,
        },
      );
    } catch {
      this.assertGeneration(generation);
      throw new ApiError(
        "تعذر حفظ نسخة الغلاف الاحتياطية.",
        0,
        "NETWORK_ERROR",
      );
    }
    const payload = (await response.json().catch(() => ({}))) as ApiErrorPayload;
    this.assertGeneration(generation);
    if (!response.ok) {
      throw new ApiError(
        payload.message || "تعذر حفظ نسخة الغلاف الاحتياطية.",
        response.status,
        payload.error,
      );
    }
  }

  async getReadingProgress() {
    return (await this.getData()).progress;
  }

  async saveReadingProgress(progress: ReadingProgress) {
    if (!isLiveKey(progress.mangaId)) throw new Error("هذه القصة ليست من مصدر مدعوم.");
    await this.request<{ ok: boolean }>("progress", {
      method: "PUT",
      body: JSON.stringify(progress),
      keepalive: true,
    });
    emitPersonalizationChange();
  }

  async getFriends() {
    const generation = this.generation;
    await this.cleanupDemoData();
    this.assertGeneration(generation);
    try {
      const result = await this.request<{ friends: Friend[]; total: number; hasMore: boolean }>(
        "friends?limit=100",
      );
      this.assertGeneration(generation);
      const friends = normalizeFriends(result.friends ?? []);
      this.writeSnapshot("friends", friends);
      return friends;
    } catch (error) {
      this.assertGeneration(generation);
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

  async generateRecoveryCode(currentPassword: string) {
    const result = await this.request<{ recoveryCode: string }>("recovery-code", {
      method: "POST", body: JSON.stringify({ currentPassword }),
    });
    return result.recoveryCode;
  }

  async setSecurityQuestion(currentPassword: string, question: string, answer: string) {
    await this.request("security-question", { method: "POST", body: JSON.stringify({ currentPassword, question, answer }) });
  }

  async getSecurityQuestion(username: string) {
    const result = await this.request<{ question: string }>("recover-password", { method: "POST", body: JSON.stringify({ action: "question", username }) });
    return result.question;
  }

  async recoverWithSecurityAnswer(username: string, answer: string, newPassword: string) {
    await this.request("recover-password", { method: "POST", body: JSON.stringify({ method: "security-question", username, answer, newPassword }) });
  }

  private async cleanupDemoData() {
    if (this.cleaned || !this.currentUser || this.currentUser.role === "admin") return;
    const generation = this.generation;
    try {
      await this.request<{ ok: boolean }>("cleanup-demo", { method: "POST" });
      this.assertGeneration(generation);
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

  private snapshotKey(kind: "data" | "friends" | "profile" | "sections" | "works") {
    return this.currentUser ? `anytime:v3:${kind}:${this.currentUser.id}` : null;
  }

  private writeSnapshot(kind: "data" | "friends" | "profile" | "sections" | "works", value: unknown) {
    if (typeof localStorage === "undefined") return;
    const key = this.snapshotKey(kind);
    if (!key) return;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Snapshots are optional; D1 remains authoritative.
    }
  }

  private readSnapshot<T>(kind: "data" | "friends" | "profile" | "sections" | "works"): T | null {
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
