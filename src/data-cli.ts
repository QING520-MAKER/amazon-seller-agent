import { Command } from "commander";
import { backupData, restoreData, verifyBackup, BackupError } from "./storage/backup.js";

const program = new Command().name("asa-data").description("停服后的本地数据备份、校验与新目录恢复");
for (const action of ["backup", "restore", "verify"] as const) {
  const command = program.command(action).requiredOption("--source <directory>", "源目录");
  if (action !== "verify") command.requiredOption("--destination <directory>", "不存在的新目标目录（父目录必须已存在）");
  command.action(async (options: { source: string; destination?: string }) => {
    const result = action === "backup" ? await backupData(options.source, options.destination!)
      : action === "restore" ? await restoreData(options.source, options.destination!) : await verifyBackup(options.source);
    console.log(JSON.stringify({ action, status: "completed", ...result }, null, 2));
  });
}
try { await program.parseAsync(); }
catch (error) {
  console.error(error instanceof BackupError ? `${error.code}: ${error.message}` : "操作失败。请检查目录、读取权限、剩余空间；原始数据未被覆盖，未完成的新目录请保留排查。");
  process.exitCode = 1;
}
