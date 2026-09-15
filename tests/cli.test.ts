import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { ListingResultSchema, ResearchReportSchema } from "../src/schemas.js";

const cwd = fileURLToPath(new URL("../", import.meta.url));
const fixture = pathToFileURL(resolve(cwd, "tests/fixtures/autocomplete-preload.ts")).href;

function cli(args: string[]) {
  const result = spawnSync(process.execPath, ["--import", "tsx", "--import", fixture, "src/cli.ts", ...args], {
    cwd,
    env: { ...process.env, OPENAI_API_KEY: "", AUTOCOMPLETE_DELAY_MS: "0", LANGCHAIN_TRACING_V2: "false", LANGSMITH_TRACING: "false" },
    encoding: "utf8",
    timeout: 20000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  return result.stdout;
}

describe("CLI JSON contracts (mock fetch in child processes)", () => {
  it("shows all four commands", () => {
    const help = cli(["--help"]);
    for (const command of ["research", "listing-create", "listing-audit", "pipeline"]) expect(help).toContain(command);
  }, 25000);

  it("prints research JSON and writes the same report to --out", () => {
    // Windows task files belong on E:, and CI can supply its own TEMP elsewhere.
    const base = process.platform === "win32" ? "E:\\CodexTemp" : process.env.TEMP ?? "/tmp";
    mkdirSync(base, { recursive: true });
    const output = join(mkdtempSync(join(base, "asa-cli-")), "nested", "research.json");
    const json = JSON.parse(cli(["research", "portable blender", "-m", "us", "--out", output]));
    const report = ResearchReportSchema.parse(json);
    expect(report.keywords).toHaveLength(6);
    expect(report.competition.estimatedCompetitors).toBeNull();
    expect(JSON.parse(readFileSync(output, "utf8"))).toEqual(json);
  }, 25000);

  it("creates valid copy from the camelCase example", () => {
    const result = ListingResultSchema.parse(JSON.parse(cli(["listing-create", "-i", "examples/listing_create.json"])));
    expect(result.listing.bullets).toHaveLength(5);
    expect(result.listing.title.length).toBeLessThanOrEqual(200);
    expect(result.coverage.coveragePct).toBe(100);
  }, 25000);

  it("audits the example without requiring a product brief", () => {
    const result = ListingResultSchema.parse(JSON.parse(cli(["listing-audit", "-i", "examples/listing_input.json"])));
    expect(result.listing.title).toBe("Portable Blender");
    expect(result.audit?.dimensions).toHaveLength(8);
    expect(result.coverage.coveragePct).toBe(20);
  }, 25000);

  it("runs research then generation with computed partial coverage", () => {
    const result = ListingResultSchema.parse(JSON.parse(cli(["pipeline", "portable blender", "-p", "examples/product_brief.json"])));
    expect(result.coverage.rows).toHaveLength(6);
    expect(result.coverage.coveragePct).toBe(83.33);
    expect(result.coverage.uncovered).toEqual(["portable blender extra cup"]);
    expect(result.listing.backendSearchTerms).toContain("portable blender extra cup");
  }, 25000);
});
