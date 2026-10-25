import type { Express, Request, Response, RequestHandler } from "express";
import { z } from "zod";
import type { Identity } from "../../auth.js";
import { check, type Principal, type Purpose, type Role } from "../../types.js";
import { digest } from "../../crypto.js";
import { Portal } from "./service.js";
import { Documents } from "./documents.js";
import { Platform } from "../platform/service.js";
import { verifySandboxCallback } from "../platform/providers.js";
interface Tools {
  guard: (purposes?: Purpose[], roles?: Role[]) => RequestHandler;
  route: (
    fn: (req: Request, res: Response) => Promise<unknown>,
  ) => RequestHandler;
  data: (res: Response, value: unknown, status?: number) => unknown;
  ctx: (res: Response) => { p: Principal; requestId: string };
}
export function portalRoutes(app: Express, identity: Identity, t: Tools) {
  const portal = new Portal(identity),
    documents = new Documents(identity),
    platform = new Platform(identity),
    empty = z.object({}).strict();
  const key = (r: Request) =>
    z.string().min(16).max(128).parse(r.header("Idempotency-Key"));
  const patient = () => t.guard(["access"], ["PATIENT"]),
    owner = () => t.guard(["access"], ["OWNER"]);
  app.get(
    "/api/v1/portal",
    patient(),
    t.route(async (req, res) => {
      empty.parse(req.query);
      return t.data(res, await portal.overview(t.ctx(res).p));
    }),
  );
  app.post(
    "/api/v1/portal/documents",
    patient(),
    t.route(async (req, res) => {
      const b = z
        .object({
          kind: z.enum(["PRESCRIPTION", "LAB_RESULT", "INVOICE"]),
          source_id: z.string().uuid(),
        })
        .strict()
        .parse(req.body);
      key(req);
      const c = t.ctx(res);
      await identity.db.limit(
        `pdf:${c.p.tenantId}:${c.p.userId}`,
        20,
        15 * 60000,
      );
      return t.data(
        res,
        await documents.generate(
          c.p,
          b.kind,
          b.source_id,
          c.requestId,
          key(req),
        ),
        201,
      );
    }),
  );
  app.get(
    "/api/v1/portal/documents/:id/download",
    patient(),
    t.route(async (req, res) => {
      empty.parse(req.query);
      const c = t.ctx(res),
        bytes = await documents.download(
          c.p,
          z.string().uuid().parse(req.params.id),
          c.requestId,
        );
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="auracare-record.pdf"',
      );
      return res.send(bytes);
    }),
  );
  app.get(
    "/api/v1/platform/usage",
    owner(),
    t.route(async (req, res) => {
      const b = z
        .object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) })
        .strict()
        .parse(req.query);
      return t.data(res, await platform.usage(t.ctx(res).p, b.month));
    }),
  );
  app.post(
    "/api/v1/platform/usage/snapshot",
    owner(),
    t.route(async (req, res) => {
      empty.parse(req.body);
      const c = t.ctx(res);
      await identity.db.limit(
        `snapshot:${c.p.tenantId}:${c.p.userId}`,
        10,
        15 * 60000,
      );
      await platform.snapshot(c.p.tenantId);
      return t.data(res, { recorded: true });
    }),
  );
  app.post(
    "/api/v1/platform/wallet/test-credits",
    owner(),
    t.route(async (req, res) => {
      const b = z
          .object({
            units: z.number().int().min(1).max(1000000),
            mfa_proof: z.string().min(1).max(1024),
          })
          .strict()
          .parse(req.body),
        c = t.ctx(res);
      await identity.db.limit(
        `wallet-proof:${c.p.tenantId}:${c.p.userId}`,
        5,
        15 * 60000,
      );
      return t.data(
        res,
        await platform.credit(c.p, b.units, b.mfa_proof, key(req), c.requestId),
        201,
      );
    }),
  );
  app.get(
    "/api/v1/platform/messages",
    owner(),
    t.route(async (req, res) => {
      empty.parse(req.query);
      return t.data(res, await platform.messages(t.ctx(res).p));
    }),
  );
  app.post(
    "/api/v1/platform/messages",
    owner(),
    t.route(async (req, res) => {
      const b = z
          .object({
            patient_id: z.string().uuid(),
            channel: z.enum(["SMS", "WHATSAPP"]),
          })
          .strict()
          .parse(req.body),
        c = t.ctx(res);
      await identity.db.limit(
        `message:${c.p.tenantId}:${c.p.userId}`,
        10,
        15 * 60000,
      );
      return t.data(
        res,
        await platform.queue(c.p, b, key(req), c.requestId),
        201,
      );
    }),
  );
  app.post(
    "/api/v1/platform/bills/preview",
    owner(),
    t.route(async (req, res) => {
      const b = z.object({ month: z.string() }).strict().parse(req.body),
        c = t.ctx(res);
      return t.data(
        res,
        await platform.preview(c.p, b.month, key(req), c.requestId),
        201,
      );
    }),
  );
  for (const kind of ["MESSAGE", "BILL"] as const)
    app.post(
      `/api/v1/providers/sandbox/${kind.toLowerCase()}`,
      t.route(async (req, res) => {
        check(!identity.config.production, 503, "PROVIDER_UNAVAILABLE");
        await identity.db.limit(
          `callback:${digest(req.ip ?? "unknown")}`,
          100,
          60000,
        );
        const raw = (req as Request & { rawBody?: Buffer }).rawBody;
        check(raw, 400, "VALIDATION_ERROR");
        verifySandboxCallback(
          identity.config.sandboxWebhookSecret,
          req.header("Sandbox-Signature"),
          raw,
        );
        const b = z
          .object({
            event_id: z.string().min(8).max(100),
            reference: z.string().min(8).max(100),
            status: z.enum(["DELIVERED", "FAILED", "PAID"]),
          })
          .strict()
          .parse(req.body);
        return t.data(
          res,
          await platform.callback(kind, b, digest(raw.toString("utf8"))),
        );
      }),
    );
}
