export interface User {
  id: string;
  name: string;
  username: string;
}

export type SourceName = "mangatime" | "teamx" | "3asq" | "starzmanga" | "xsano" | "mangalik";

export interface SourceChapter {
  number: number;
  title: string;
  publishedAt?: string | null;
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
}

export type UserProfileSectionType = "continue_reading" | "favorites" | "custom_list";

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
