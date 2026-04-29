import crypto from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Db } from "../db/connection.js";
import { enqueueJob } from "../db/jobs.js";
import { createLogger } from "../logger.js";

const log = createLogger("webhook");

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
    const eventType = headerValue(request.headers["x-github-event"]);
    const signature = headerValue(request.headers["x-hub-signature-256"]);
    const rawBody = request.body as string;

    if (!eventType || !signature) {
      const headerNames = Object.keys(request.headers).sort();
      log.warn({
        hasEventType: Boolean(eventType),
        hasSignature: Boolean(signature),
        delivery: request.headers["x-github-delivery"],
        userAgent: request.headers["user-agent"],
        contentType: request.headers["content-type"],
        headerNames
      }, "missing required GitHub webhook headers");
      return reply.code(400).send({
        error: "missing GitHub headers",
        hasEventType: Boolean(eventType),
        hasSignature: Boolean(signature),
        headerNames
      });
    }
    const verification = verifySignature(secret, rawBody, signature);
    if (!verification.ok) {
      log.warn({
        eventType,
        delivery: request.headers["x-github-delivery"],
        secretLength: secret.length,
        bodyType: typeof rawBody,
        bodyLength: typeof rawBody === "string" ? rawBody.length : undefined,
        receivedPrefix: signature.slice(0, 18),
        expectedPrefix: verification.expected.slice(0, 18)
      }, "invalid GitHub webhook signature");
      return reply.code(401).send({ error: "invalid signature" });
    }

    const id = enqueueJob(db, eventType, rawBody);
    log.info({
      jobId: id,
      eventType,
      delivery: request.headers["x-github-delivery"],
      ...summarizeWebhookPayload(rawBody)
    }, "webhook accepted");
    return reply.code(202).send({ queued: true, id });
  });
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function verifySignature(secret: string, body: string, signature: string): { ok: boolean; expected: string } {
  const expected = `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
  if (expected.length !== signature.length) return { ok: false, expected };
  return { ok: crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature)), expected };
}

function summarizeWebhookPayload(rawBody: string): Record<string, unknown> {
  try {
    const payload = JSON.parse(rawBody) as {
      action?: string;
      repository?: { full_name?: string };
      pull_request?: { number?: number; base?: { sha?: string }; head?: { sha?: string } };
      issue?: { number?: number; pull_request?: unknown };
    };
    return {
      action: payload.action,
      repository: payload.repository?.full_name,
      pullNumber: payload.pull_request?.number ?? (payload.issue?.pull_request ? payload.issue.number : undefined),
      baseSha: payload.pull_request?.base?.sha,
      headSha: payload.pull_request?.head?.sha
    };
  } catch {
    return { payloadParseFailed: true };
  }
}
