export interface User {
  id: string;
  name: string;
  username: string;
}
export interface Manga {
  id: string;
  title: string;
  alternative?: string;
  genres: string[];
  status: string;
  description: string;
  latest: number;
  chapters: number[];
  color: string;
  cover: string;
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
