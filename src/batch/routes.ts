import { z } from "zod";
import {
  CatalogPaginationSchema, ContentBatchPageSchema, ContentBatchSchema, CreateContentBatchSchema,
  ProductImportResultSchema, ProductImportSchema,
} from "../schemas.js";
import { BatchService } from "./service.js";
import { output, paramId, parse, query, readJson, studioRoutes } from "../http/studio.js";

export function createBatchRoutes(service?: BatchService) {
  const app = studioRoutes(Boolean(service), ["/batches", "/batches/*", "/products/import"]);
  app.get("/batches", c => output(c, ContentBatchPageSchema, service!.list(parse(CatalogPaginationSchema, query(c)))));
  app.post("/batches", async c => output(c, ContentBatchSchema, service!.create(parse(CreateContentBatchSchema, await readJson(c))), 201));
  app.get("/batches/:batchId", c => {
    parse(z.object({}).strict(), query(c));
    return output(c, ContentBatchSchema, service!.get(paramId(c, "batchId")));
  });
  app.post("/batches/:batchId/execute", async c => {
    parse(z.object({}).strict(), query(c));
    return output(c, ContentBatchSchema, await service!.execute(paramId(c, "batchId")));
  });
  app.post("/products/import", async c => {
    parse(z.object({}).strict(), query(c));
    return output(c, ProductImportResultSchema, service!.importProducts(parse(ProductImportSchema, await readJson(c))));
  });
  return app;
}
