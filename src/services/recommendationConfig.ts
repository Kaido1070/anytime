export const RECOMMENDATION_ALGORITHM_VERSION = "10.5.1";
export const RECOMMENDATION_CACHE_TTL_MS = 30 * 60 * 1000;

export const RECOMMENDATION_WEIGHTS = {
  favorite: 6,
  completed: 5,
  reading: 3,
  list: 2.5,
  planned: 1,
  paused: -1,
  shallowRead: 0.5,
  deepReadMax: 3,
  recentSevenDays: 1.5,
  recentThirtyDays: 1,
  recentNinetyDays: 0.5,
  perWorkCap: 9,
  tasteSimilarity: 7,
  seedSimilarity: 3,
  popularityTieBreaker: 0.25,
  freshnessTieBreaker: 0.15,
  typeFeatureWeight: 0.45,
  minimumConfidence: 0.14,
  diversityPenalty: 1.1,
} as const;

export const FYP_INITIAL_COUNT = 20;
export const FYP_LOAD_MORE_COUNT = 12;
