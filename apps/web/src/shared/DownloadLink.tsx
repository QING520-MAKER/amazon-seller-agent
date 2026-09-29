import type { ReactNode } from "react";

/** A user-initiated attachment request keeps browser download handling native. */
export function DownloadLink({ href, disabled = false, children }: { href: string; disabled?: boolean; children: ReactNode }) {
  return <a role="link" className="studio-download" href={disabled ? undefined : href} download target="_blank" rel="noopener noreferrer"
    aria-disabled={disabled || undefined} tabIndex={disabled ? -1 : undefined}
    onClick={event => { if (disabled) event.preventDefault(); }}>{children}</a>;
}

export const contentDownloadUrl = (productId: string, versionId: string, draft: boolean) =>
  `/api/products/${encodeURIComponent(productId)}/content/${encodeURIComponent(versionId)}/export${draft ? "?draft=1" : ""}`;
export const imageDownloadUrl = (productId: string, imageId: string) =>
  `/api/products/${encodeURIComponent(productId)}/images/${encodeURIComponent(imageId)}/content?download=1`;
export const packageDownloadUrl = (productId: string, packageId: string) =>
  `/api/products/${encodeURIComponent(productId)}/packages/${encodeURIComponent(packageId)}/download`;
