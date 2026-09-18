import type { SourceManga } from "../types";
import {
  RECOMMENDATION_ALGORITHM_VERSION,
  RECOMMENDATION_WEIGHTS as W,
} from "./recommendationConfig";

export type TasteSignalKind =
  | "favorite"
  | "completed"
  | "reading"
  | "list"
  | "planned"
  | "history";

export interface TasteSignal {
  item: SourceManga;
  weight: number;
  kind: TasteSignalKind;
  lastReadAt?: number | null;
}

export interface RecommendationCandidate {
  item: SourceManga;
  sourceKeys: string[];
  popularity: number;
  freshness: number;
}

export interface RankedRecommendation extends RecommendationCandidate {
  score: number;
  confidence: number;
  reason: string;
  algorithmVersion: string;
}

type Vector = Map<string, number>;

function normalizedLabel(value: string) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function vectorFor(item: SourceManga): Vector {
  const vector = new Map<string, number>();
  const genres = [...new Set((item.genres ?? []).map(normalizedLabel).filter(Boolean))];
  for (const genre of genres) vector.set(`genre:${genre}`, 1);
  const type = normalizedLabel(item.type);
  if (type) vector.set(`type:${type}`, W.typeFeatureWeight);
  return normalizeVector(vector);
}

function normalizeVector(vector: Vector) {
  const norm = Math.sqrt([...vector.values()].reduce((sum, value) => sum + value * value, 0));
  if (!norm) return vector;
  return new Map([...vector.entries()].map(([key, value]) => [key, value / norm]));
}

function cosine(left: Vector, right: Vector) {
  if (!left.size || !right.size) return 0;
  let score = 0;
  for (const [key, value] of left) score += value * (right.get(key) ?? 0);
  return Math.max(0, Math.min(1, score));
}

function tasteVector(signals: TasteSignal[]) {
  const out = new Map<string, number>();
  for (const signal of signals) {
    const contribution = Math.max(0, Math.min(W.perWorkCap, signal.weight));
    if (contribution <= 0) continue;
    for (const [key, value] of vectorFor(signal.item)) {
      out.set(key, (out.get(key) ?? 0) + value * contribution);
    }
  }
  return normalizeVector(out);
}

function metadataConfidence(item: SourceManga) {
  const genreCount = [...new Set((item.genres ?? []).map(normalizedLabel).filter(Boolean))].length;
  if (genreCount >= 3) return 1;
  if (genreCount === 2) return 0.9;
  if (genreCount === 1) return 0.78;
  return item.type ? 0.55 : 0;
}

function reasonFor(candidate: SourceManga, signals: TasteSignal[]) {
  const candidateVector = vectorFor(candidate);
  const scored = signals
    .filter((signal) => signal.weight > 0)
    .map((signal) => ({
      signal,
      similarity: cosine(candidateVector, vectorFor(signal.item)),
    }))
    .sort((a, b) => {
      const scoreDiff = b.similarity * b.signal.weight - a.similarity * a.signal.weight;
      return scoreDiff || a.signal.item.key.localeCompare(b.signal.item.key);
    });

  const best = scored[0];
  if (!best || best.similarity < 0.16) {
    const labels = (candidate.genres ?? []).filter(Boolean).slice(0, 2);
    return labels.length
      ? `متوافق مع اهتماماتك في ${labels.join(" و")}`
      : "متوافق مع نمط قراءتك";
  }

  const title = best.signal.item.title;
  if (best.signal.kind === "favorite") return `مشابه لـ ${title} الموجود في مفضلتك`;
  if (best.signal.kind === "completed") return `مشابه لعمل أكملته: ${title}`;
  if (best.signal.kind === "reading" || best.signal.kind === "history") {
    return `لأنك تقرأ ${title}`;
  }
  if (best.signal.kind === "list") return `قريب من أعمال قوائمك مثل ${title}`;
  return `قريب من ${title} الذي حفظته للقراءة`;
}

function rankBase(candidate: RecommendationCandidate, taste: Vector, signals: TasteSignal[]) {
  const vector = vectorFor(candidate.item);
  const confidence = cosine(vector, taste) * metadataConfidence(candidate.item);
  let strongestSeed = 0;
  for (const signal of signals) {
    if (signal.weight <= 0) continue;
    const similarity = cosine(vector, vectorFor(signal.item));
    strongestSeed = Math.max(
      strongestSeed,
      similarity * Math.min(1, signal.weight / W.perWorkCap),
    );
  }
  const score =
    confidence * W.tasteSimilarity +
    strongestSeed * W.seedSimilarity +
    candidate.popularity * W.popularityTieBreaker +
    candidate.freshness * W.freshnessTieBreaker;
  return { score, confidence, vector };
}

function diversify(
  ranked: Array<RankedRecommendation & { vector: Vector }>,
): RankedRecommendation[] {
  const remaining = [...ranked];
  const selected: Array<RankedRecommendation & { vector: Vector }> = [];

  while (remaining.length) {
    let bestIndex = 0;
    let bestAdjusted = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < remaining.length; index += 1) {
      const current = remaining[index];
      const maxSimilarity = selected.reduce(
        (max, picked) => Math.max(max, cosine(current.vector, picked.vector)),
        0,
      );
      const adjusted = current.score - maxSimilarity * W.diversityPenalty;
      const best = remaining[bestIndex];
      if (
        adjusted > bestAdjusted ||
        (adjusted === bestAdjusted && current.item.key.localeCompare(best.item.key) < 0)
      ) {
        bestAdjusted = adjusted;
        bestIndex = index;
      }
    }
    selected.push(remaining.splice(bestIndex, 1)[0]);
  }

  return selected.map(({ vector: _vector, ...recommendation }) => recommendation);
}

export function rankRecommendations(
  candidates: RecommendationCandidate[],
  signals: TasteSignal[],
): RankedRecommendation[] {
  const taste = tasteVector(signals);
  const personalized = taste.size > 0;

  if (!personalized) {
    return [...candidates]
      .sort(
        (a, b) =>
          b.popularity - a.popularity ||
          b.freshness - a.freshness ||
          a.item.key.localeCompare(b.item.key),
      )
      .map((candidate) => ({
        ...candidate,
        score: candidate.popularity + candidate.freshness * 0.25,
        confidence: 0,
        reason: "عمل متاح للقراءة الآن",
        algorithmVersion: RECOMMENDATION_ALGORITHM_VERSION,
      }));
  }

  const ranked = candidates
    .map((candidate) => {
      const base = rankBase(candidate, taste, signals);
      return {
        ...candidate,
        score: base.score,
        confidence: base.confidence,
        vector: base.vector,
        reason: reasonFor(candidate.item, signals),
        algorithmVersion: RECOMMENDATION_ALGORITHM_VERSION,
      };
    })
    .filter((candidate) => candidate.confidence >= W.minimumConfidence)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.confidence - a.confidence ||
        a.item.key.localeCompare(b.item.key),
    );

  return diversify(ranked);
}

export function recommendationFeatureSignature(item: SourceManga) {
  return [...vectorFor(item).keys()].sort().join("|");
}
