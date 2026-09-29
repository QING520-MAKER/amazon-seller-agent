import { createHash } from "node:crypto";
import { createReadStream, constants } from "node:fs";
import { copyFile, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import Database from "better-sqlite3";
import { z } from "zod";
import { CURRENT_SCHEMA_VERSION } from "./migrations.js";

const entrySchema = z.object({ path: z.string().min(1), size: z.number().int().nonnegative(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const manifestSchema = z.object({
  format: z.literal("asa-local-backup"), version: z.literal(1), createdAt: z.string().datetime(),
  schemaVersion: z.number().int().min(1).max(CURRENT_SCHEMA_VERSION),
  directories: z.array(z.string()).max(100_000), files: z.array(entrySchema).min(1).max(100_000),
}).strict();
type Manifest = z.infer<typeof manifestSchema>;
type FileEntry = z.infer<typeof entrySchema>;
export class BackupError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
const reject = (code: string, message: string): never => { throw new BackupError(code, message); };

/** The application always binds this port before opening storage. Hold it until done. */
export async function acquireOfflineGuard(): Promise<() => Promise<void>> {
  const server = createServer(socket => socket.destroy());
  await new Promise<void>((done, fail) => {
    server.once("error", () => fail(new BackupError("SERVICE_RUNNING", "请先正常停止 API 服务，再备份或恢复。")));
    server.listen(8787, "127.0.0.1", () => { server.removeAllListeners("error"); done(); });
  });
  return () => new Promise<void>((done, fail) => server.close(error => error ? fail(error) : done()));
}
export interface BackupOptions { guard?: typeof acquireOfflineGuard }
async function guarded<T>(options: BackupOptions, operation: () => Promise<T>) {
  const release = await (options.guard ?? acquireOfflineGuard)();
  try { return await operation(); } finally { await release(); }
}
async function exists(path: string) {
  try { return await lstat(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}
async function noLinkedAncestors(path: string) {
  let current = resolve(path);
  while (true) {
    const info = await exists(current);
    if (info?.isSymbolicLink()) reject("LINK_NOT_ALLOWED", "数据路径不能包含符号链接或目录联接。");
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
function inside(parent: string, child: string) {
  const remainder = relative(parent, child);
  return remainder === "" || (!remainder.startsWith(`..${sep}`) && remainder !== ".." && !isAbsolute(remainder));
}
async function paths(source: string, destination?: string) {
  const sourcePath = resolve(source);
  if (sourcePath.startsWith("\\\\")) reject("LOCAL_PATH_REQUIRED", "请使用本机磁盘目录。");
  await noLinkedAncestors(sourcePath);
  if (!(await lstat(sourcePath)).isDirectory()) reject("INVALID_SOURCE", "源路径必须是目录。");
  const root = await realpath(sourcePath);
  if (!destination) return { source: root, destination: undefined };
  const target = resolve(destination);
  if (target.startsWith("\\\\") || target === parse(target).root) reject("INVALID_DESTINATION", "请选择本机磁盘上的新目录。");
  await noLinkedAncestors(target);
  if (await exists(target)) reject("DESTINATION_EXISTS", "目标目录已存在，请选择一个不存在的新目录。");
  // The parent must already exist; do not create an arbitrary chain on failure.
  const parent = await realpath(dirname(target));
  const resolvedTarget = join(parent, relative(dirname(target), target));
  if (inside(root, resolvedTarget) || inside(resolvedTarget, root)) reject("NESTED_PATHS", "源目录和目标目录不能相同或相互包含。");
  return { source: root, destination: resolvedTarget };
}
function validateRelative(path: string) {
  if (!path || path.includes("\\") || path.includes(":") || path.startsWith("/") || path.split("/").some(part =>
    !part || part === "." || part === ".." || /[\u0000-\u001f<>"|?*]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    reject("INVALID_MANIFEST_PATH", "备份清单包含无效路径。");
  }
}
async function digest(path: string): Promise<{ size: number; sha256: string }> {
  const hash = createHash("sha256"); let size = 0;
  for await (const chunk of createReadStream(path)) { size += chunk.length; hash.update(chunk); }
  return { size, sha256: hash.digest("hex") };
}
async function inventory(root: string) {
  const files: FileEntry[] = [], directories: string[] = [];
  async function walk(directory: string, prefix: string) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      validateRelative(path);
      const full = join(directory, item.name), info = await lstat(full);
      if (info.isSymbolicLink()) reject("LINK_NOT_ALLOWED", "数据目录内包含链接，未复制任何链接目标。");
      if (info.isDirectory()) { directories.push(path); await walk(full, path); }
      else if (info.isFile()) files.push({ path, ...await digest(full) });
      else reject("UNSUPPORTED_FILE", "数据目录含不支持的文件类型。");
      if (files.length + directories.length > 100_000) reject("BACKUP_LIMIT", "目录项目过多，超过当前备份工具上限。");
    }
  }
  await walk(root, "");
  files.sort((a, b) => a.path.localeCompare(b.path)); directories.sort();
  return { files, directories };
}
function sameInventory(a: Pick<Manifest, "files" | "directories">, b: Pick<Manifest, "files" | "directories">) {
  const normalize = (value: typeof a) => JSON.stringify({ directories: [...value.directories].sort(),
    files: [...value.files].sort((x, y) => x.path.localeCompare(y.path)).map(file => [file.path, file.size, file.sha256]) });
  if (normalize(a) !== normalize(b)) reject("BACKUP_MISMATCH", "文件集合、大小或 SHA-256 不一致；请保留原库并检查备份。");
}
async function inspectDatabase(root: string) {
  for (const suffix of ["-wal", "-journal"]) {
    const info = await exists(join(root, `catalog.sqlite${suffix}`));
    if (info && info.size > 0) reject("UNCLEAN_DATABASE", "发现未清空的数据库日志，请先启动应用恢复，再正常停止后备份。");
  }
  const dbFile = join(root, "catalog.sqlite");
  const info = await lstat(dbFile);
  if (!info.isFile() || info.isSymbolicLink()) reject("INVALID_DATABASE", "未找到有效的 catalog.sqlite。");
  // Even a readonly connection to a WAL database can create -wal/-shm files.
  // Inspect a private disk copy so validation never opens or mutates the source.
  const scratch = await mkdtemp(join(tmpdir(), "asa-db-verify-"));
  const scratchDb = join(scratch, "catalog.sqlite");
  let db: Database.Database | undefined;
  try {
    await copyFile(dbFile, scratchDb, constants.COPYFILE_EXCL);
    db = new Database(scratchDb, { readonly: true, fileMustExist: true });
    const foreignKeys = db.pragma("foreign_key_check");
    if (db.pragma("integrity_check", { simple: true }) !== "ok" || !Array.isArray(foreignKeys) || foreignKeys.length) reject("INVALID_DATABASE", "SQLite 完整性检查未通过。");
    const version = db.pragma("user_version", { simple: true }) as number;
    const history = db.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as { version: number }[];
    if (version < 1 || version > CURRENT_SCHEMA_VERSION || history.length !== version || history.some((item, i) => item.version !== i + 1)) {
      reject("UNSUPPORTED_SCHEMA", "数据库迁移版本不受当前应用支持。");
    }
    return version;
  } finally {
    db?.close();
    // These exact files are owned by this invocation; never recursively remove a data directory.
    for (const suffix of ["", "-wal", "-shm", "-journal"]) {
      try { await unlink(`${scratchDb}${suffix}`); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    await rmdir(scratch);
  }
}
async function copyInventory(source: string, destination: string, manifest: Pick<Manifest, "files" | "directories">) {
  await mkdir(destination);
  for (const directory of [...manifest.directories].sort((a, b) => a.split("/").length - b.split("/").length)) await mkdir(join(destination, directory));
  for (const file of manifest.files) {
    const input = join(source, file.path);
    if ((await lstat(input)).isSymbolicLink()) reject("LINK_NOT_ALLOWED", "复制期间发现链接，操作已停止。");
    await copyFile(input, join(destination, file.path), constants.COPYFILE_EXCL);
  }
}
async function readBackup(source: string) {
  await noLinkedAncestors(source);
  const manifestPath = join(source, "manifest.json");
  const info = await lstat(manifestPath);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 32 * 1024 * 1024) reject("INVALID_MANIFEST", "备份清单缺失或无效。");
  let manifest: Manifest;
  try { manifest = manifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8"))); }
  catch { return reject("INVALID_MANIFEST", "备份未完成或清单格式不受支持。"); }
  const seen = new Set<string>();
  for (const path of [...manifest.directories, ...manifest.files.map(file => file.path)]) {
    validateRelative(path);
    const key = path.toLocaleLowerCase("en-US");
    if (seen.has(key)) reject("INVALID_MANIFEST", "备份清单含重复或冲突路径。");
    seen.add(key);
  }
  if (!manifest.files.some(file => file.path === "catalog.sqlite")) reject("INVALID_MANIFEST", "备份中没有数据库。");
  const data = join(source, "data");
  await noLinkedAncestors(data);
  sameInventory(manifest, await inventory(data));
  if (await inspectDatabase(data) !== manifest.schemaVersion) reject("INVALID_MANIFEST", "备份清单与数据库版本不符。");
  return manifest;
}

export async function backupData(source: string, destination: string, options: BackupOptions = {}) {
  return guarded(options, async () => {
    const located = await paths(source, destination);
    const content = await inventory(located.source);
    const schemaVersion = await inspectDatabase(located.source);
    const manifest: Manifest = { format: "asa-local-backup", version: 1, createdAt: new Date().toISOString(), schemaVersion, ...content };
    await mkdir(located.destination!);
    await copyInventory(located.source, join(located.destination!, "data"), manifest);
    sameInventory(content, await inventory(located.source));
    sameInventory(content, await inventory(join(located.destination!, "data")));
    await writeFile(join(located.destination!, "manifest.json"), JSON.stringify(manifest, null, 2), { flag: "wx" });
    return { directory: located.destination!, files: manifest.files.length, schemaVersion };
  });
}
export async function verifyBackup(source: string, options: BackupOptions = {}) {
  return guarded(options, async () => {
    const located = await paths(source);
    const manifest = await readBackup(located.source);
    return { directory: located.source, files: manifest.files.length, schemaVersion: manifest.schemaVersion };
  });
}
export async function restoreData(source: string, destination: string, options: BackupOptions = {}) {
  return guarded(options, async () => {
    const located = await paths(source, destination);
    const manifest = await readBackup(located.source);
    await copyInventory(join(located.source, "data"), located.destination!, manifest);
    sameInventory(manifest, await inventory(located.destination!));
    if (await inspectDatabase(located.destination!) !== manifest.schemaVersion) reject("INVALID_DATABASE", "恢复库的版本检查失败。");
    return { directory: located.destination!, files: manifest.files.length, schemaVersion: manifest.schemaVersion };
  });
}
