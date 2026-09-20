import { useEffect, useRef, useState } from "react";
import { CatalogApiError, errorMessage, listAssets, uploadAsset } from "./api.js";
import type { OriginalAsset } from "../../../../src/schemas.js";

export interface UploadItem {
  id: string; productId: string; file: File;
  state: "queued" | "uploading" | "saved" | "exists" | "error" | "uncertain";
  message: string; reconcile?: boolean;
}
export function useUploads() {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [versions, setVersions] = useState<Record<string, number>>({});
  const current = useRef<UploadItem[]>([]);
  const running = useRef(false);
  const controller = useRef<AbortController | undefined>(undefined);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; }, []);
  const change = (id: string, patch: Partial<UploadItem>) => {
    current.current = current.current.map(item => item.id === id ? { ...item, ...patch } : item);
    if (alive.current) setItems(current.current);
  };
  async function reconcile(item: UploadItem, signal: AbortSignal): Promise<OriginalAsset | undefined> {
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", await item.file.arrayBuffer()))].map(b => b.toString(16).padStart(2, "0")).join("");
    for (const state of ["active", "archived"] as const) {
      for (let offset = 0;; offset += 20) {
        const page = await listAssets(item.productId, state, offset, signal);
        const existing = page.items.find(asset => asset.sha256 === hash);
        if (existing) return existing;
        if (offset + page.limit >= page.total) break;
      }
    }
  }
  async function run() {
    if (running.current) return;
    running.current = true;
    try {
      for (;;) {
        const item = current.current.find(entry => entry.state === "queued");
        if (!item || !alive.current) break;
        controller.current = new AbortController();
        change(item.id, { state: "uploading", message: item.reconcile ? "正在核对服务器记录…" : "正在上传 / 校验…" });
        let reconciled = !item.reconcile;
        try {
          const existing = item.reconcile ? await reconcile(item, controller.current.signal) : undefined;
          reconciled = true;
          const result = existing ? { asset: existing, reused: true } : await uploadAsset(item.productId, item.file, controller.current.signal);
          change(item.id, { state: result.reused ? "exists" : "saved", reconcile: false,
            message: result.asset.archivedAt ? "原图已存在且已移除，请在“已移除”中恢复。" : result.reused ? "原图已存在。" : "原图已保存。" });
          if (alive.current) setVersions(v => ({ ...v, [item.productId]: (v[item.productId] ?? 0) + 1 }));
        } catch (error) {
          const uncertain = !reconciled || (error instanceof CatalogApiError && error.uncertain);
          change(item.id, { state: uncertain ? "uncertain" : "error", reconcile: uncertain,
            message: uncertain ? "保存结果待确认。重新核对后可安全重试。" : errorMessage(error) });
        }
      }
    } finally { running.current = false; controller.current = undefined; }
  }
  function add(productId: string, files: File[]) {
    const added: UploadItem[] = files.map(file => ({ id: crypto.randomUUID(), productId, file,
      state: file.size > 20 * 1024 * 1024 || file.size === 0 ? "error" : "queued",
      message: file.size === 0 ? "文件为空。" : file.size > 20 * 1024 * 1024 ? "单张原图不能超过 20 MiB。" : "等待上传…" }));
    current.current = [...current.current, ...added];
    setItems(current.current);
    void run();
  }
  function retry(id: string) { change(id, { state: "queued", message: "等待重试…" }); void run(); }
  return { items, versions, add, retry, stopWaiting: () => controller.current?.abort() };
}
export type Uploads = ReturnType<typeof useUploads>;
