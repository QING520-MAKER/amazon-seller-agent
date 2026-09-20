import { createAdaptorServer } from "@hono/node-server";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "./routes.js";
import { openCatalog, type CatalogService } from "../catalog/service.js";
import type { StorageSettings } from "../storage/settings.js";

const unavailable = () => Response.json({ error: { code: "STORAGE_UNAVAILABLE", message: "服务正在启动或关闭，请保留输入并稍后重试。" } }, { status: 503 });
export async function startCatalogServer(settings: StorageSettings, options: {
  initialize?: typeof openCatalog;
  invoke?: NonNullable<Parameters<typeof createApp>[0]>["invoke"];
} = {}) {
  let app: ReturnType<typeof createApp> | undefined;
  let catalog: CatalogService | undefined;
  let state: "starting" | "ready" | "draining" | "closed" = "starting";
  const pending = new Set<Promise<unknown>>();
  const server = createAdaptorServer({ hostname: "127.0.0.1", fetch: (request) => {
    if (state !== "ready" || !app) return unavailable();
    const operation = Promise.resolve().then(() => app!.fetch(request));
    pending.add(operation);
    void operation.finally(() => pending.delete(operation)).catch(() => {});
    return operation;
  } }) as Server;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(8787, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {
    state = "draining";
    await Promise.allSettled([...pending]);
    let failed: unknown;
    try { catalog?.close(); } catch (error) { failed = error; }
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    state = "closed";
    if (failed) throw failed;
  })();
  try {
    const result = await (options.initialize ?? openCatalog)(settings);
    catalog = result.catalog;
    app = createApp({ catalog, invoke: options.invoke });
    state = "ready";
    return { server, catalog, close, recoveryRecords: result.recoveryRecords, port: (server.address() as AddressInfo).port };
  } catch (error) { await close(); throw error; }
}
