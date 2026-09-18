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

export interface ReadingProgress {
  mangaId: string;
  chapter: number;
  percent: number;
  updatedAt: number;
}

export interface UserData {
  version: 2;
  favorites: string[];
  progress: Record<string, ReadingProgress>;
  completed: string[];
  lastOpened: { mangaId: string; chapter: number } | null;
}

export interface Friend {
  user: User;
  reading: { mangaId: string; chapter: number } | null;
  favorites: string[];
}
