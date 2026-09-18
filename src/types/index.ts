export type ProfileVisibility = "public" | "private";
export type UserRole = "user" | "admin";
export type ProfileAccess = "owner" | "public" | "private";
export type FriendRelationship = "none" | "pending_sent" | "pending_received" | "friends";

export interface User {
  id: string;
  name: string;
  username: string;
  profileVisibility: ProfileVisibility;
  avatarId: string | null;
  role?: UserRole;
}

export interface Avatar {
  id: string;
  seriesId: string;
  characterName: string;
  imageUrl: string | null;
  position: number;
}

export interface AvatarSeries {
  id: string;
  workId: string | null;
  name: string;
  slug: string;
  position: number;
  avatars: Avatar[];
}

export type SourceName = "mangatime" | "teamx" | "3asq" | "starzmanga" | "xsano" | "mangalik";

export interface SourceChapter {
  number: number;
  title: string;
  publishedAt?: string | null;
  firstSeenAt?: number | null;
  baselineObserved?: boolean;
  synthetic?: boolean;
  url?: string;
}

export interface SourceManga {
  key: string;
  source: SourceName;
  sourceId: string;
  slug: string;
  type: string;
  url: string;
  title: string;
  cover: string;
  description?: string;
  status?: string;
  genres: string[];
  latest?: number | null;
  chapters?: SourceChapter[];
}

export interface SourceListResponse {
  items: SourceManga[];
  hasMore: boolean;
  page: number;
}

export interface SourcePageMeta {
  url: string;
  width?: number;
  height?: number;
}

export interface SourceChapterPayload {
  item: SourceManga;
  number: number;
  title: string;
  pages: string[];
  pageMeta?: SourcePageMeta[];
  previous: number | null;
  next: number | null;
}

export type LibraryStatus = "reading" | "completed" | "paused" | "planned";

export interface LibraryEntry {
  mangaId: string;
  status: LibraryStatus;
  addedAt: number;
  updatedAt: number;
  lastReadAt: number | null;
  lastReadChapter: number | null;
  highestReachedChapter: number | null;
}

export interface ReadingHistoryEntry {
  id: number;
  mangaId: string;
  chapter: number;
  readAt: number;
}

export interface FollowedWorkState {
  mangaId: string;
  trackingStartedAt: number;
}

export interface ReadingWorkState {
  mangaId: string;
  readCount: number;
  lastReadAt: number | null;
  highestChapter: number | null;
}

export interface PersonalizationState {
  followed: FollowedWorkState[];
  readingWorks: ReadingWorkState[];
}

export interface ReadChapterPair {
  mangaId: string;
  chapter: number;
}

export interface UserListSummary {
  id: string;
  name: string;
  description: string | null;
  position: number;
  itemCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface UserListItem {
  mangaId: string;
  position: number;
  addedAt: number;
}

export interface UserListDetail extends UserListSummary {
  items: UserListItem[];
  owner?: User;
  canManage?: boolean;
}

export type UserProfileSectionType =
  | "continue_reading"
  | "favorites"
  | "my_activity"
  | "friends_activity"
  | "custom_list";

export interface UserProfileSection {
  key: string;
  sectionType: UserProfileSectionType;
  referenceId: string | null;
  position: number;
  isVisible: boolean;
  list: UserListSummary | null;
  previewItems: string[];
}

export interface UserProfileSectionInput {
  sectionType: UserProfileSectionType;
  referenceId: string | null;
  isVisible: boolean;
}

export interface ReadingProgress {
  mangaId: string;
  chapter: number;
  percent: number;
  updatedAt: number;
}

export interface UserData {
  version: 3;
  favorites: string[];
  library: LibraryEntry[];
  progress: Record<string, ReadingProgress>;
  completed: string[];
  lastOpened: { mangaId: string; chapter: number } | null;
}

export interface Friend {
  user: User;
  reading: { mangaId: string; chapter: number } | null;
  favorites: string[];
}

export interface FriendRequest {
  user: User;
  createdAt: number;
}

export interface FriendRequests {
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
  incomingCount: number;
  outgoingCount: number;
}

export interface FriendSearchResult {
  user: User;
  relationship: FriendRelationship;
}

export type ActivityEventType =
  | "started_work"
  | "progress_reached"
  | "completed_work"
  | "favorited_work"
  | "added_to_list"
  | "created_list";

export interface ActivityEvent {
  id: number;
  type: ActivityEventType;
  user: User;
  mangaId: string | null;
  list: { id: string; name: string } | null;
  chapterNumber: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface ActivityFeed {
  events: ActivityEvent[];
  total: number;
  hasMore: boolean;
}

export interface ProfileLibraryItem {
  mangaId: string;
  status: LibraryStatus;
  highestReachedChapter: number | null;
  lastReadChapter?: number | null;
  lastReadAt?: number | null;
}

export interface ProfileListPreview extends UserListSummary {
  previewItems: string[];
  sectionPosition: number;
}

export interface ProfileSectionView {
  key: string;
  type: "favorites" | "library" | "list";
  referenceId: string | null;
  position: number;
}

export interface ProfileStats {
  works: number;
  chaptersRead: number;
  completed: number;
  reading: number;
  lists: number;
  friends: number;
}

export interface UserProfileView {
  user: User;
  access: ProfileAccess;
  favorites: string[];
  favoriteCount: number;
  relationship: FriendRelationship;
  library?: ProfileLibraryItem[];
  lists?: ProfileListPreview[];
  sections?: ProfileSectionView[];
  friends?: User[];
  stats?: ProfileStats;
  pendingFriendRequests?: number;
  activity?: ActivityEvent[];
}


export interface AdminLastRead {
  mangaId: string;
  lastReadChapter: number | null;
  highestReachedChapter: number | null;
  lastReadAt: number | null;
}

export interface AdminUserSummary {
  user: User;
  worksCount: number;
  listsCount: number;
  friendsCount: number;
  lastActivityAt: number | null;
  lastRead: AdminLastRead | null;
}

export interface AdminUserList extends UserListSummary {
  items: UserListItem[];
}

export interface AdminUserDetail {
  user: User;
  createdAt: number;
  lastActivityAt: number | null;
  stats: {
    works: number;
    lists: number;
    friends: number;
  };
  library: LibraryEntry[];
  readingHistory: ReadingHistoryEntry[];
  readingHistoryTotal: number;
  readingHistoryHasMore: boolean;
  lists: AdminUserList[];
  favorites: string[];
  friends: User[];
  activity: ActivityEvent[];
}
