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
    genres: ["فانتازيا", "أكشن", "أكاديمية"],
    status: "Ongoing",
    description:
      "يحصل ديسير على فرصة ثانية ويعود إلى أيام الأكاديمية وهو يحمل ذكريات مستقبل لا يريد أن يتكرر. هذه المرة سيحاول إنقاذ الأشخاص الذين خسرهم من قبل.",
    latest: 150,
    chapters: Array.from({ length: 10 }, (_, i) => 150 - i),
    color: "#b9bc99",
    cover: "/covers/returner.svg",
  },
  {
    id: "eleceed",
    title: "Eleceed",
    genres: ["أكشن", "كوميديا"],
    status: "Ongoing",
    description:
      "صداقة غير متوقعة تدخل طالبا طيب القلب إلى عالم خفي مليء بالقدرات الخارقة.",
    latest: 318,
    chapters: [318, 317, 316, 315, 314],
    color: "#92b3bd",
    cover: "/covers/eleceed.svg",
  },
  {
    id: "solo",
    title: "Solo Leveling",
    genres: ["أكشن", "فانتازيا"],
    status: "Completed",
    description:
      "صياد يبدأ من أضعف نقطة ثم يكتشف طريقا يغير حياته بالكامل.",
    latest: 200,
    chapters: [200, 199, 198, 197, 196],
    color: "#a4a2cf",
    cover: "/covers/solo.svg",
  },
  {
    id: "horizon",
    title: "The Horizon",
    genres: ["مغامرة", "دراما"],
    status: "Completed",
    description:
      "شخصان يواصلان رحلة طويلة في عالم هادئ وغريب ويبحثان عن شيء بسيط يتمسكان به.",
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
