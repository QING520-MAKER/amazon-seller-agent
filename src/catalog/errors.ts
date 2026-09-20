import type { ApiFailure } from "../schemas.js";

export class CatalogError extends Error {
  constructor(
    public readonly status: 400 | 403 | 404 | 409 | 413 | 415 | 422 | 500 | 503 | 507,
    public readonly code: string,
    message: string,
    public readonly details?: ApiFailure["error"]["details"],
    public readonly issues?: ApiFailure["error"]["issues"],
  ) { super(message); }
}

export function storageError(error: unknown): CatalogError {
  if (error instanceof CatalogError) return error;
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (code === "ENOSPC" || code === "SQLITE_FULL") return new CatalogError(507, "INSUFFICIENT_STORAGE", "存储空间不足，请清理空间后重试。");
  if (code.startsWith("SQLITE_BUSY") || code.startsWith("SQLITE_LOCKED")) return new CatalogError(503, "STORAGE_BUSY", "存储正在忙碌，请保留输入并稍后重试。");
  if (["EACCES", "EPERM", "EROFS", "EIO"].includes(code) || code.startsWith("SQLITE_READONLY") || code.startsWith("SQLITE_IOERR") || code === "SQLITE_CANTOPEN") {
    return new CatalogError(503, "STORAGE_UNAVAILABLE", "无法访问本地存储，请检查目录权限和磁盘状态。");
  }
  return new CatalogError(500, "INTERNAL_ERROR", "本地服务未能完成操作，请保留输入并检查服务日志。");
}
