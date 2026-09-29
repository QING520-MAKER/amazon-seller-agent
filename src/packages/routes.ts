import { z } from "zod";
import type { PackageService } from "./service.js";
import { CatalogPaginationSchema, ContentPackagePageSchema, ContentPackageSchema, CreateContentPackageSchema } from "../schemas.js";
import { output, paramId, parse, query, readJson, studioRoutes } from "../http/studio.js";

export function createPackageRoutes(service?: PackageService) {
  const app = studioRoutes(Boolean(service));
  app.get("/:productId/packages", c => output(c, ContentPackagePageSchema, service!.list(paramId(c, "productId"), parse(CatalogPaginationSchema, query(c)))));
  app.post("/:productId/packages", async c => output(c, ContentPackageSchema, service!.create(paramId(c, "productId"), parse(CreateContentPackageSchema, await readJson(c))), 201));
  app.get("/:productId/packages/:packageId", c => output(c, ContentPackageSchema, service!.get(paramId(c, "productId"), paramId(c, "packageId"))));
  app.get("/:productId/packages/:packageId/download", async c => {
    parse(z.object({}).strict(), query(c));
    const { pack, bytes } = await service!.download(paramId(c, "productId"), paramId(c, "packageId"));
    return new Response(new Uint8Array(bytes), { headers: {
      "Content-Type": "application/zip", "Content-Length": String(bytes.length), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `attachment; filename="${pack.manifest.status}-content-package-${pack.id}.zip"`,
    } });
  });
  return app;
}
