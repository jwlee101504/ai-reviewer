import crypto from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Db } from "../db/connection.js";
import { enqueueJob } from "../db/jobs.js";

type WebhookRequest = FastifyRequest<{
  Headers: {
    "x-github-event"?: string;
    "x-hub-signature-256"?: string;
  };
}>;

export async function registerWebhook(app: FastifyInstance, db: Db, secret: string): Promise<void> {
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_request, body, done) => {
    done(null, body);
  });

  app.post("/webhooks/github", async (request: WebhookRequest, reply) => {
    const eventType = request.headers["x-github-event"];
    const signature = request.headers["x-hub-signature-256"];
    const rawBody = request.body as string;

    if (!eventType || !signature) return reply.code(400).send({ error: "missing GitHub headers" });
    if (!verifySignature(secret, rawBody, signature)) return reply.code(401).send({ error: "invalid signature" });

    const payload = JSON.parse(rawBody) as unknown;
    const id = enqueueJob(db, eventType, payload);
    return reply.code(202).send({ queued: true, id });
  });
}

function verifySignature(secret: string, body: string, signature: string): boolean {
  const expected = `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
