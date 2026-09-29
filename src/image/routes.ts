import { z } from "zod";
import { CatalogPaginationSchema, ImageDetailSchema, ImagePageSchema, ImageReviewSchema, ImageRunPageSchema, GenerateImageResultSchema, GenerateImageSchema } from "../schemas.js";
import type { ImageService } from "./service.js";
import { output, paramId, parse, query, readJson, studioRoutes } from "../http/studio.js";

export function createImageRoutes(service?: ImageService) {
  const app = studioRoutes(Boolean(service));
  // Static route literals must precede /:imageId so "runs" and "generate"
  // are never interpreted as image identifiers.
  app.get("/:productId/images/runs", (c) => output(c, ImageRunPageSchema, service!.runs(paramId(c, "productId"), parsePagination(c))));
  app.post("/:productId/images/generate", async (c) => {
    const result = await service!.generate(paramId(c, "productId"), parse(GenerateImageSchema, await readJson(c)));
    return output(c, GenerateImageResultSchema, result, result.reused ? 200 : 201);
  });
  app.get("/:productId/images", (c) => output(c, ImagePageSchema, service!.list(paramId(c, "productId"), parsePagination(c))));
  app.post("/:productId/images/:imageId/reviews", async (c) => {
    const productId = paramId(c, "productId");
    const imageId = paramId(c, "imageId");
    const request = parse(ImageReviewRequestSchema, await readJson(c));
    return output(c, ImageReviewSchema, service!.review(productId, imageId, request.decision, request.notes), 201);
  });
  app.get("/:productId/images/:imageId/content", async (c) => {
    const { download } = parse(z.object({ download: z.literal("1").optional() }).strict(), query(c));
    const result = await service!.content(paramId(c, "productId"), paramId(c, "imageId"));
    const extension = result.image.mimeType === "image/png" ? "png" : "jpg";
    return new Response(result.bytes, { headers: {
      "Content-Type": result.image.mimeType,
      "Content-Length": String(result.bytes.length),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="image.${extension}"`,
      "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store",
    } });
  });
  app.get("/:productId/images/:imageId", (c) => output(c, ImageDetailSchema, service!.detail(paramId(c, "productId"), paramId(c, "imageId"))));
  return app;
}

const ImageReviewRequestSchema = z.object({ decision: z.enum(["approved", "rejected"]), notes: z.string().trim().max(10000) }).strict();
function parsePagination(c: Parameters<typeof query>[0]) { return parse(CatalogPaginationSchema, query(c)); }
