import "dotenv/config";
import { startCatalogServer } from "./http/lifecycle.js";
import { loadStorageSettings } from "./storage/settings.js";

let running: Awaited<ReturnType<typeof startCatalogServer>> | undefined;
let shutdownRequested = false;
let stopping = false;
const stop = async () => {
  shutdownRequested = true;
  if (!running || stopping) return;
  stopping = true;
  try {
    await running.close();
    console.log("Storage closed; safe to back up the complete data directory.");
    process.send?.({ type: "closed" });
    process.exit(0);
  } catch { console.error("Storage shutdown failed; inspect storage before backup."); process.exit(1); }
};
// Register before asynchronous initialization so an early console stop is retained.
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void stop(); });
process.on("message", message => {
  if (message && typeof message === "object" && "type" in message && message.type === "shutdown") void stop();
});
if (process.connected) process.once("disconnect", () => { void stop(); });

try {
  const settings = loadStorageSettings();
  running = await startCatalogServer(settings);
  if (shutdownRequested) await stop();
  console.log("Seller workbench API ready: http://127.0.0.1:8787");
  console.log("Local data directory: " + settings.dataDir);
  console.log("Recovery diagnostics: " + running.recoveryRecords);
  process.send?.({ type: "ready" });
} catch (error) {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "INITIALIZATION_FAILED";
  console.error("API startup failed: " + code + ". Existing data was not reset.");
  process.exitCode = 1;
  // Initialization has released its resources. An IPC listener would otherwise
  // keep this failed child (and the production supervisor) alive indefinitely.
  if (process.connected) process.disconnect();
}
