import type { FastifyInstance } from "fastify";

export async function registerHealth(app: FastifyInstance): Promise<void> {
  app.get("/healthz", { logLevel: "silent" }, async () => ({ ok: true }));
}
