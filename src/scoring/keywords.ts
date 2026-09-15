import type { Keyword, KeywordIntent } from "../schemas.js";

const COMMERCIAL = ["buy", "best", "vs", "for", "cheap", "top", "kit", "set"];
const INFORMATIONAL = ["how to", "what is", "review", "meaning", "guide"];

export function classifyIntent(phrase: string): KeywordIntent {
  const text = phrase.toLowerCase();
  if (INFORMATIONAL.some((marker) => text.includes(marker))) return "informational";
  if (COMMERCIAL.some((marker) => text.includes(marker))) return "commercial";
  return "niche";
}

export function toKeywords(
  phrases: string[],
  source: Keyword["source"] = "autocomplete",
): Keyword[] {
  const seen = new Set<string>();
  const items: Keyword[] = [];
  for (const raw of phrases) {
    const phrase = raw.split(/\s+/).join(" ").trim();
    const key = phrase.toLowerCase();
    if (!phrase || seen.has(key)) continue;
    seen.add(key);
    items.push({ phrase, intent: classifyIntent(phrase), source });
  }
  return items;
}
