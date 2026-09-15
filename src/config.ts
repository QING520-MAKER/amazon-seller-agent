import "dotenv/config";

export interface Settings {
  amazonMarketplace: string;
  autocompleteTimeoutMs: number;
  autocompleteDelayMs: number;
  openaiApiKey: string;
  openaiBaseUrl: string;
  openaiModel: string;
}

export function loadSettings(): Settings {
  return {
    amazonMarketplace: process.env.AMAZON_MARKETPLACE ?? "us",
    autocompleteTimeoutMs: Number(process.env.AUTOCOMPLETE_TIMEOUT_MS ?? 15000),
    autocompleteDelayMs: Number(process.env.AUTOCOMPLETE_DELAY_MS ?? 200),
    openaiApiKey: process.env.OPENAI_API_KEY ?? "",
    openaiBaseUrl: process.env.OPENAI_BASE_URL ?? "",
    openaiModel: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  };
}

export function llmEnabled(settings: Settings = loadSettings()): boolean {
  return settings.openaiApiKey.trim().length > 0;
}
