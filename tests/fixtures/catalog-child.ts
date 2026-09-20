import { resolve, sep } from "node:path";
import { startCatalogServer } from "../../src/http/lifecycle.js";
import { openCatalog } from "../../src/catalog/service.js";

const dataDir = resolve(process.env.ASA_DATA_DIR!);
if (!dataDir.startsWith(resolve("E:\\CodexTemp") + sep)) throw new Error("Fault fixture only permits the test directory.");
try {
  const running = await startCatalogServer({ dataDir }, { initialize: settings => openCatalog(settings, {
    point: point => { if (point === process.argv[2]) process.exit(77); },
  }) });
  process.send?.({ type: "ready", recoveryRecords: running.recoveryRecords });
  process.on("message", async message => {
    if (message && typeof message === "object" && "type" in message && message.type === "shutdown") {
      await running.close(); process.exit(0);
    }
  });
  process.on("disconnect", () => { void running.close().then(() => process.exit(0)); });
} catch (error) {
  process.send?.({ type: "error", code: error && typeof error === "object" && "code" in error ? error.code : "START_FAILED" });
  process.exit(1);
}
