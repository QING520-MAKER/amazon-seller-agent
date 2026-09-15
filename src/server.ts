import { serve } from "@hono/node-server";
import { app } from "./http/routes.js";

const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 8787 }, (info) => {
  console.log(`Seller workbench API: http://127.0.0.1:${info.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close((error) => {
      if (error) console.error(error.message);
      process.exit(error ? 1 : 0);
    });
  });
}
