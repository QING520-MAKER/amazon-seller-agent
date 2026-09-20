import { afterEach, describe, expect, it, vi } from "vitest";
import { request as httpRequest } from "node:http";
import { mkdir, mkdtemp, stat, writeFile, readFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { startCatalogServer } from "../src/http/lifecycle.js";
import { openCatalog } from "../src/catalog/service.js";
import { CreateProductSchema } from "../src/schemas.js";
import { png } from "./fixtures/catalog-images.js";

const servers = new Set<Awaited<ReturnType<typeof startCatalogServer>>>();
const children = new Set<ChildProcess>();
const cwd = fileURLToPath(new URL("../", import.meta.url));
function deferred() { let resolve!: () => void; return { promise: new Promise<void>(r => { resolve = r; }), resolve }; }
async function dir() { await mkdir("E:\\CodexTemp", { recursive: true }); return mkdtemp("E:\\CodexTemp\\asa-lifecycle-"); }
let supervisorBuild: Promise<string> | undefined;
async function supervisor(dataDir: string) {
  // Compile this checkout, not a potentially stale dist. Use the actual production supervisor.
  const output = await (supervisorBuild ??= (async () => {
    const build = await dir();
    await promisify(execFile)(process.execPath, [join(cwd, "node_modules/typescript/bin/tsc"), "-p", join(cwd, "tsconfig.json"), "--outDir", build], { cwd, windowsHide: true });
    await writeFile(join(build, "package.json"), JSON.stringify({ type: "module" }));
    await symlink(join(cwd, "node_modules"), join(build, "node_modules"), "junction");
    return build;
  })());
  const child = spawn(process.execPath, [join(output, "serve.js")], { cwd, windowsHide: true,
    env: { ...process.env, ASA_DATA_DIR: dataDir, OPENAI_API_KEY: "", LANGCHAIN_TRACING_V2: "false", LANGSMITH_TRACING: "false" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  children.add(child);
  let outputText = "";
  for (const stream of [child.stdout!, child.stderr!]) stream.on("data", chunk => { outputText += String(chunk); });
  const exited = once(child, "exit");
  return { child, output: () => outputText, async exitCode() {
    let timer: ReturnType<typeof setTimeout>;
    try { return (await Promise.race([exited, new Promise<[number]>(resolve => { timer = setTimeout(() => resolve([-1]), 4000); })]))[0]; }
    finally { clearTimeout(timer!); }
  } };
}
function http(path: string, method = "GET", bytes?: Buffer, headers: Record<string, string> = {}) {
  let request!: ReturnType<typeof httpRequest>;
  const response = new Promise<{ status: number; bytes: Buffer }>((resolve, reject) => {
    request = httpRequest("http://127.0.0.1:8787" + path, { method, headers, agent: false }, response => {
      const chunks: Buffer[] = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode!, bytes: Buffer.concat(chunks) }));
    });
    request.on("error", reject);
    // Without Content-Length Node sends chunked uploads, exercising the real adapter.
    if (bytes) request.write(bytes);
    request.end();
  });
  return { response, abort: () => request.destroy(new Error("test client disconnected")) };
}
async function multipart() {
  const form = new FormData(); form.append("file", new File([await png()], "合成.png"));
  const request = new Request("http://localhost/", { method: "POST", body: form });
  return { bytes: Buffer.from(await request.arrayBuffer()), headers: { "content-type": request.headers.get("content-type")! } };
}
async function child(dataDir: string, fault = "") {
  const process = spawn(globalThis.process.execPath, ["--import", "tsx", "tests/fixtures/catalog-child.ts", fault], {
    cwd, env: { ...globalThis.process.env, ASA_DATA_DIR: dataDir, OPENAI_API_KEY: "", LANGCHAIN_TRACING_V2: "false", LANGSMITH_TRACING: "false" },
    windowsHide: true, stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  children.add(process);
  let stderr = "";
  process.stderr!.on("data", chunk => { stderr += String(chunk); });
  const exited = once(process, "exit");
  const ready = new Promise<{ type: string; recoveryRecords?: number; code?: string }>((resolve, reject) => {
    process.on("message", value => resolve(value as { type: string }));
    process.once("error", reject);
    process.once("exit", () => reject(new Error("child exited before ready: " + stderr)));
  });
  return { process, exited, ready };
}
async function stopChild(c: Awaited<ReturnType<typeof child>>) {
  c.process.send({ type: "shutdown" });
  expect((await c.exited)[0]).toBe(0);
  children.delete(c.process);
}
afterEach(async () => {
  for (const server of servers) await server.close();
  servers.clear();
  for (const process of children) {
    if (process.exitCode === null && process.signalCode === null) { const exited = once(process, "exit"); process.kill(); await exited; }
  }
  children.clear();
});
describe.sequential("fixed-port startup and process durability", () => {
  it.each(["occupied port", "ordinary file"])("compiled supervisor exits nonzero after startup fails on %s", async failure => {
    const dataDir = join(await dir(), "child-data");
    if (failure === "occupied port") {
      const running = await startCatalogServer({ dataDir: await dir() }); servers.add(running);
    } else await writeFile(dataDir, "keep existing file");
    const process = await supervisor(dataDir);
    await vi.waitFor(() => expect(process.output()).toContain("API startup failed:"), { timeout: 10000 });
    expect(await process.exitCode()).toBe(1);
    if (failure === "occupied port") {
      expect(process.output()).toContain("EADDRINUSE");
      await expect(stat(dataDir)).rejects.toMatchObject({ code: "ENOENT" });
    } else expect(await readFile(dataDir, "utf8")).toBe("keep existing file");
  }, 30000);
  it("compiled supervisor still exits zero after normal startup and console stop", async () => {
    const process = await supervisor(await dir());
    await vi.waitFor(() => expect(process.output()).toContain("API ready:"), { timeout: 10000 });
    process.child.stdin!.write("stop\n");
    expect(await process.exitCode()).toBe(0);
    expect(process.output()).toContain("Storage closed; safe to back up");
  }, 30000);
  it("retains a shutdown request sent before the real server finishes initialization", async () => {
    const process = spawn(globalThis.process.execPath, ["--import", "tsx", "src/server.ts"], {
      cwd, env: { ...globalThis.process.env, ASA_DATA_DIR: await dir() },
      windowsHide: true, stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    children.add(process);
    const messages: unknown[] = [];
    process.on("message", message => messages.push(message));
    const exited = once(process, "exit");
    process.send({ type: "shutdown" });
    expect((await exited)[0]).toBe(0);
    expect(messages).toContainEqual({ type: "closed" });
    children.delete(process);
  }, 20000);
  it("serves 503 while starting, rejects a second instance before touching storage, and retains the port while draining", async () => {
    const settings = { dataDir: await dir() }, entered = deferred(), initialized = deferred(), copied = deferred(), commit = deferred();
    const starting = startCatalogServer(settings, { initialize: async settings => {
      entered.resolve(); await initialized.promise;
      return openCatalog(settings, { point: async point => { if (point === "file-copied") { copied.resolve(); await commit.promise; } } });
    } });
    await entered.promise;
    expect((await http("/api/health").response).status).toBe(503);
    const initialize = vi.fn(openCatalog);
    const secondDir = join(await dir(), "must-not-exist");
    await expect(startCatalogServer({ dataDir: secondDir }, { initialize })).rejects.toMatchObject({ code: "EADDRINUSE" });
    expect(initialize).not.toHaveBeenCalled();
    await expect(stat(secondDir)).rejects.toMatchObject({ code: "ENOENT" });
    initialized.resolve();
    const server = await starting; servers.add(server);
    const product = server.catalog.repository.create(CreateProductSchema.parse({ sku: "A", brief: { name: "N" } }));
    const data = await multipart();
    const uploading = http("/api/products/" + product.product.id + "/assets", "POST", data.bytes, data.headers);
    await copied.promise;
    const closing = server.close();
    expect((await http("/api/health").response).status).toBe(503);
    await expect(startCatalogServer({ dataDir: secondDir }, { initialize })).rejects.toMatchObject({ code: "EADDRINUSE" });
    expect(server.catalog.repository.db.open).toBe(true);
    commit.resolve();
    expect((await uploading.response).status).toBe(201);
    await closing; servers.delete(server);
    const restarted = await startCatalogServer(settings); servers.add(restarted);
    expect(restarted.catalog.repository.assets(product.product.id, "active", { limit: 20, offset: 0 }).total).toBe(1);
    expect((await http("/api/health").response).status).toBe(200);
  }, 20000);
  it("waits for disconnected clients' persistence and counts a real chunked body", async () => {
    const copied = deferred(), commit = deferred(), settings = { dataDir: await dir() };
    const server = await startCatalogServer(settings, { initialize: settings => openCatalog(settings, {
      point: async point => { if (point === "file-copied") { copied.resolve(); await commit.promise; } },
    }) }); servers.add(server);
    const product = server.catalog.repository.create(CreateProductSchema.parse({ sku: "A", brief: { name: "N" } }));
    const data = await multipart();
    const upload = http("/api/products/" + product.product.id + "/assets", "POST", data.bytes, data.headers);
    const disconnected = upload.response.catch(() => undefined);
    await copied.promise; upload.abort(); await disconnected;
    let closed = false;
    const closing = server.close().then(() => { closed = true; });
    expect((await http("/api/health").response).status).toBe(503);
    expect(closed).toBe(false);
    commit.resolve(); await closing; servers.delete(server);
    const reopened = await openCatalog(settings);
    expect(reopened.catalog.repository.assets(product.product.id, "active", { limit: 20, offset: 0 }).total).toBe(1);
    reopened.catalog.close();
  }, 20000);
  it.each(["temporary-written", "file-copied", "after-register"])("recovers after a separate process exits at %s, preserving committed bytes", async point => {
    const dataDir = await dir();
    const first = await child(dataDir, point);
    expect((await first.ready).type).toBe("ready");
    const created = await http("/api/products", "POST", Buffer.from(JSON.stringify({ sku: "A", brief: { name: "重启商品" } })), { "content-type": "application/json" }).response;
    expect(created.status).toBe(201);
    const productId = JSON.parse(created.bytes.toString()).product.id as string;
    const data = await multipart();
    await http("/api/products/" + productId + "/assets", "POST", data.bytes, data.headers).response.catch(() => {});
    expect((await first.exited)[0]).toBe(77); children.delete(first.process);
    const second = await child(dataDir);
    const ready = await second.ready;
    expect(ready.type).toBe("ready");
    const assets = JSON.parse((await http("/api/products/" + productId + "/assets").response).bytes.toString());
    expect(assets.total).toBe(point === "after-register" ? 1 : 0);
    if (point === "after-register") {
      const content = await http("/api/products/" + productId + "/assets/" + assets.items[0].id + "/content").response;
      expect(content.status).toBe(200); expect(content.bytes).toEqual(await png());
    } else expect(ready.recoveryRecords).toBeGreaterThan(0);
    await stopChild(second);
    const third = await child(dataDir); expect((await third.ready).type).toBe("ready"); await stopChild(third);
  }, 30000);
});
