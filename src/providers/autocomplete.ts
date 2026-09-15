import type { Settings } from "../config.js";
import { getMarketplace, type Marketplace } from "../marketplace.js";
import { z } from "zod";

const CompletionResponseSchema = z.object({
  suggestions: z.array(z.object({ value: z.string() })),
});

export const PREFIXES = ["", "best ", "cheap ", "top "] as const;

export class AutocompleteClient {
  private nextRequestAt = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly settings: Settings) {}

  private request(url: URL): Promise<string[]> {
    // Serialize requests across calls made on this client, including concurrent calls.
    const result = this.queue.then(async () => {
      const waitMs = this.nextRequestAt - Date.now();
      if (waitMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
      try {
        const response = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
            Accept: "application/json",
          },
          credentials: "omit",
          redirect: "error",
          signal: AbortSignal.timeout(this.settings.autocompleteTimeoutMs),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return CompletionResponseSchema.parse(await response.json()).suggestions.map((item) => item.value);
      } catch (error) {
        throw new Error(`Amazon autocomplete failed for ${JSON.stringify(url.searchParams.get("prefix"))}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      } finally {
        this.nextRequestAt = Date.now() + this.settings.autocompleteDelayMs;
      }
    });
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  /**
   * Public Amazon completion API only:
   * https://completion.{domain}/api/2017/suggestions
   *
   * Default: seed + prefixes. deep=true also expands `{keyword} a`..`z`.
   * Rate-limit with settings.autocompleteDelayMs. Do not scrape product HTML.
   */
  async suggestions(
    keyword: string,
    marketplace: Marketplace,
    options: { deep?: boolean } = {},
  ): Promise<string[]> {
    const seed = keyword.replace(/\s+/g, " ").trim();
    if (!seed) throw new Error("Autocomplete keyword must not be blank");
    const market = getMarketplace(marketplace.code);
    if (!Number.isInteger(this.settings.autocompleteTimeoutMs) || this.settings.autocompleteTimeoutMs <= 0) {
      throw new Error("autocompleteTimeoutMs must be a positive integer");
    }
    if (!Number.isFinite(this.settings.autocompleteDelayMs) || this.settings.autocompleteDelayMs < 0) {
      throw new Error("autocompleteDelayMs must be a non-negative number");
    }
    const queries = PREFIXES.map((prefix) => `${prefix}${seed}`);
    if (options.deep) {
      for (const letter of "abcdefghijklmnopqrstuvwxyz") queries.push(`${seed} ${letter}`);
    }
    const seen = new Set<string>();
    const phrases: string[] = [];
    for (const query of queries) {
      const url = new URL(`https://completion.${market.domain}/api/2017/suggestions`);
      url.search = new URLSearchParams({ mid: market.marketplaceId, alias: "aps", prefix: query }).toString();
      for (const raw of await this.request(url)) {
        const phrase = raw.replace(/\s+/g, " ").trim();
        const key = phrase.toLowerCase();
        if (!phrase || seen.has(key)) continue;
        seen.add(key);
        phrases.push(phrase);
      }
    }
    return phrases;
  }
}
