import type { Manga, User, Friend } from "../types";

export const users: User[] = [
  { id: "mahdi", username: "has", name: "Has" },
  { id: "kaido", username: "yas", name: "Yas" },
  { id: "ahmed", username: "mah", name: "Mah" },
];

export const manga: Manga[] = [
  {
    id: "returner",
    title: "A Returner's Magic Should Be Special",
    alternative: "Gwihwanjaui Mabeobeun Teukbyeolhaeya Hamnida",
    genres: ["Fantasy", "Action", "Academy"],
    status: "Ongoing",
    description:
      "Desir is given a second chance and returns to his academy days carrying memories of a future he refuses to let repeat. This time, he will try to save the people he lost before.",
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
      "An unexpected friendship draws a kind-hearted student into a hidden world filled with extraordinary abilities.",
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
      "A hunter starts from the weakest point and discovers a path that changes his life completely.",
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
      "Two people continue a long journey through a quiet, strange world while searching for something simple to hold on to.",
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
