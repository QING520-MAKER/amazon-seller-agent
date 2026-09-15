export interface Marketplace {
  code: string;
  domain: string;
  marketplaceId: string;
  language: string;
  currency: string;
}

export const MARKETPLACES: Record<string, Marketplace> = {
  us: { code: "us", domain: "amazon.com", marketplaceId: "ATVPDKIKX0DER", language: "en", currency: "USD" },
  uk: { code: "uk", domain: "amazon.co.uk", marketplaceId: "A1F83G8C2ARO7P", language: "en", currency: "GBP" },
  de: { code: "de", domain: "amazon.de", marketplaceId: "A1PA6795UKMFR9", language: "de", currency: "EUR" },
  fr: { code: "fr", domain: "amazon.fr", marketplaceId: "A13V1IB3VIYZZH", language: "fr", currency: "EUR" },
  it: { code: "it", domain: "amazon.it", marketplaceId: "APJ6JRA9NG5V4", language: "it", currency: "EUR" },
  es: { code: "es", domain: "amazon.es", marketplaceId: "A1RKKUPIHCS9HS", language: "es", currency: "EUR" },
  jp: { code: "jp", domain: "amazon.co.jp", marketplaceId: "A1VC38T7YXB528", language: "ja", currency: "JPY" },
  ca: { code: "ca", domain: "amazon.ca", marketplaceId: "A2EUQ1WTGCTBG2", language: "en", currency: "CAD" },
  au: { code: "au", domain: "amazon.com.au", marketplaceId: "A39IBJ37TRP1C6", language: "en", currency: "AUD" },
  in: { code: "in", domain: "amazon.in", marketplaceId: "A21TJRUUN4KGV", language: "en", currency: "INR" },
  mx: { code: "mx", domain: "amazon.com.mx", marketplaceId: "A1AM78C64UM0Y8", language: "es", currency: "MXN" },
  br: { code: "br", domain: "amazon.com.br", marketplaceId: "A2Q3Y263D00KWC", language: "pt", currency: "BRL" },
};

export function getMarketplace(code: string): Marketplace {
  const key = code.trim().toLowerCase();
  const market = MARKETPLACES[key];
  if (!market) {
    throw new Error(`Unknown marketplace ${code}. Supported: ${Object.keys(MARKETPLACES).sort().join(", ")}`);
  }
  return market;
}
