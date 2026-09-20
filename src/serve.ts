import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// Parent owns the console and requests a cooperative IPC shutdown on Windows.
const child = spawn(process.execPath, [fileURLToPath(new URL("./server.js", import.meta.url))], {
  stdio: ["ignore", "inherit", "inherit", "ipc"], windowsHide: true,
});
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  if (child.connected) child.send({ type: "shutdown" });
}
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, stop);
process.stdin.setEncoding("utf8");
process.stdin.on("data", value => { if (String(value).trim().toLowerCase() === "stop") stop(); });
process.stdin.resume();
child.on("exit", code => { process.stdin.pause(); process.exit(code ?? 1); });
child.on("error", () => { process.stdin.pause(); process.exitCode = 1; });
console.log("Type stop then Enter to close storage before backup.");
