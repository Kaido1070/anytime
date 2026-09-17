import type { Manga, User, Friend } from "../types";
export const users: User[] = ["Mahdi", "Kaido", "Ahmed"].map((name) => ({
  id: name.toLowerCase(),
  username: name.toLowerCase(),
  name,
}));
export const manga: Manga[] = [
  {
    id: "returner",
    title: "A Returner's Magic Should Be Special",
    alternative: "Gwihwanjaui Mabeobeun Teukbyeolhaeya Hamnida",
    genres: ["Fantasy", "Action", "Academy"],
    status: "Ongoing",
    description:
      "A second chance. A familiar world. Desir returns to his academy days with memories of a future he refuses to repeat. This time, he will save the people he once lost.",
    latest: 150,
    chapters: Array.from({ length: 10 }, (_, i) => 150 - i),
    color: "#b9bc99",
    cover: "/covers/returner.svg",
  },
  {
    id: "eleceed",
    title: "Eleceed",
    genres: ["Action", "Comedy"],
    status: "Ongoing",
    description:
      "An unlikely friendship brings a kindhearted student into a hidden world of extraordinary abilities.",
    latest: 318,
    chapters: [318, 317, 316, 315, 314],
    color: "#92b3bd",
    cover: "/covers/eleceed.svg",
  },
  {
    id: "solo",
    title: "Solo Leveling",
    genres: ["Action", "Fantasy"],
    status: "Completed",
    description:
      "One hunter discovers that the weakest beginning can lead to an extraordinary journey.",
    latest: 200,
    chapters: [200, 199, 198, 197, 196],
    color: "#a4a2cf",
    cover: "/covers/solo.svg",
  },
  {
    id: "horizon",
    title: "The Horizon",
    genres: ["Adventure", "Drama"],
    status: "Completed",
    description:
      "Two travelers find a little hope on a long road through a quiet, unfamiliar world.",
    latest: 21,
    chapters: [21, 20, 19, 18, 17],
    color: "#c9a482",
    cover: "/covers/horizon.svg",
  },
];
export const findManga = (id: string) => manga.find((item) => item.id === id);
export const mockFriends: Friend[] = [
  {
    user: users[1],
    reading: { mangaId: "eleceed", chapter: 315 },
    favorites: ["eleceed", "horizon"],
  },
  {
    user: users[2],
    reading: { mangaId: "solo", chapter: 197 },
    favorites: ["solo", "returner"],
  },
  {
    user: users[0],
    reading: { mangaId: "returner", chapter: 143 },
    favorites: ["returner", "solo"],
  },
];
