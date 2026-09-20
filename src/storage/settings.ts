import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const STORAGE_LIMITS = {
  fileBytes: 20 * 1024 * 1024,
  multipartBytes: 21 * 1024 * 1024,
  jsonBytes: 8 * 1024 * 1024,
  pixels: 40_000_000,
  edge: 12_000,
  concurrentUploads: 2,
} as const;
export interface StorageSettings { dataDir: string }

/** No filesystem effects; source and compiled modules resolve to the same application root. */
export function loadStorageSettings(env: NodeJS.ProcessEnv = process.env): StorageSettings {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const configured = env.ASA_DATA_DIR?.trim();
  const dataDir = resolve(root, configured || "data");
  if (dataDir.startsWith("\\\\")) throw new Error("ASA_DATA_DIR 必须位于本机磁盘，不能使用网络共享。");
  return { dataDir };
}
