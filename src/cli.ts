#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { Command } from "commander";
import { sellerGraph } from "./graph/index.js";
import { getMarketplace } from "./marketplace.js";
import { writeJson } from "./reports.js";
import {
  ListingCreateRequestSchema,
  ListingOptimizeRequestSchema,
  ProductBriefSchema,
  type Intent,
} from "./schemas.js";

const program = new Command()
  .name("asa")
  .description("Amazon seller agent — LangGraph.js research and listing")
  .version("0.1.0");

program
  .command("research")
  .argument("<keyword>", "Seed keyword")
  .option("-m, --marketplace <code>", "Marketplace code", "us")
  .option("--deep", "Include a-z autocomplete expansion", false)
  .option("--compare <keywords>", "Comma-separated extra keywords")
  .option("--out <path>", "Write JSON report")
  .action(async (keyword: string, opts: { marketplace: string; deep: boolean; compare?: string; out?: string }) => {
    getMarketplace(opts.marketplace);
    const result = await sellerGraph.invoke({
      intent: "research" satisfies Intent,
      keyword,
      marketplace: opts.marketplace,
      deep: opts.deep,
      compareWith: opts.compare?.split(",").map((item) => item.trim()).filter(Boolean) ?? [],
    });
    const payload = result.researchReport ?? result;
    if (opts.out) await writeJson(opts.out, payload);
    console.log(JSON.stringify(payload, null, 2));
  });

program
  .command("listing-create")
  .requiredOption("-i, --input <path>", "examples/listing_create.json")
  .option("--out <path>")
  .action(async (opts: { input: string; out?: string }) => {
    const request = ListingCreateRequestSchema.parse(JSON.parse(await readFile(opts.input, "utf8")));
    getMarketplace(request.marketplace);
    const result = await sellerGraph.invoke({
      intent: "listing_create",
      marketplace: request.marketplace,
      product: request.product,
      keywords: request.keywords,
    });
    const payload = result.listingResult ?? result;
    if (opts.out) await writeJson(opts.out, payload);
    console.log(JSON.stringify(payload, null, 2));
  });

program
  .command("listing-audit")
  .requiredOption("-i, --input <path>", "examples/listing_input.json")
  .option("--out <path>")
  .action(async (opts: { input: string; out?: string }) => {
    const request = ListingOptimizeRequestSchema.parse(JSON.parse(await readFile(opts.input, "utf8")));
    getMarketplace(request.marketplace);
    const result = await sellerGraph.invoke({
      intent: "listing_audit",
      marketplace: request.marketplace,
      listingInput: request.listing,
      keywords: request.keywords,
      product: request.product,
    });
    const payload = result.listingResult ?? result;
    if (opts.out) await writeJson(opts.out, payload);
    console.log(JSON.stringify(payload, null, 2));
  });

program
  .command("pipeline")
  .argument("<keyword>", "Seed keyword")
  .requiredOption("-p, --product <path>", "examples/product_brief.json")
  .option("-m, --marketplace <code>", "Marketplace code", "us")
  .option("--out <path>")
  .action(async (keyword: string, opts: { product: string; marketplace: string; out?: string }) => {
    getMarketplace(opts.marketplace);
    const product = ProductBriefSchema.parse(JSON.parse(await readFile(opts.product, "utf8")));
    const result = await sellerGraph.invoke({
      intent: "pipeline",
      keyword,
      marketplace: opts.marketplace,
      product,
    });
    const payload = result.listingResult ?? result;
    if (opts.out) await writeJson(opts.out, payload);
    console.log(JSON.stringify(payload, null, 2));
  });

await program.parseAsync();
