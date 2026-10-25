import { receptionRoutes } from "./modules/reception/routes.js";
import type { QueuePublisher } from "./modules/reception/service.js";
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Identity, publicUser } from "./auth.js";
import { digest } from "./crypto.js";
import {
  AppError,
  check,
  roles,
  type Principal,
  type Purpose,
  type Role,
} from "./types.js";
const email = z
  .email()
  .max(254)
  .transform((v) => v.toLowerCase());
const password = z
  .string()
  .min(12)
  .refine(
    (v) => Buffer.byteLength(v, "utf8") <= 72,
    "Maximum password length is 72 UTF-8 bytes.",
  );
const subdomain = z
  .string()
  .min(3)
  .max(40)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .refine(
    (v) => !["www", "api", "admin", "support", "app", "mail"].includes(v),
  );
const secret = z.string().min(1).max(1024);
const id = z.string().uuid();
type Context = { p: Principal; requestId: string };
export async function createApp(identity: Identity, publish?: QueuePublisher) {
  const app = express();
  const db = identity.db,
    c = identity.config;
  app.disable("x-powered-by");
  app.set("trust proxy", false);
  app.use((req, res, next) => {
    res.locals.requestId = randomUUID();
    res.setHeader("X-Request-Id", res.locals.requestId as string);
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(
    helmet(),
    cors({ origin: c.origin, credentials: true }),
    express.json({ limit: "32kb" }),
    cookieParser(),
  );
  // Reject a conflicting browser origin even on endpoints that do not use cookies.
  app.use((req, _res, next) => {
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers.origin &&
      req.headers.origin !== c.origin
    )
      return next(new AppError(403, "FORBIDDEN"));
    next();
  });
  const route =
    (fn: (req: Request, res: Response) => Promise<unknown>) =>
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        await fn(req, res);
      } catch (e) {
        next(e);
      }
    };
  const data = (res: Response, v: unknown, status = 200) =>
    res
      .status(status)
      .json({ data: v, meta: { request_id: res.locals.requestId } });
  const auth = (
    allowed: Purpose[] = ["access"],
    allowedRoles: Role[] = [...roles],
  ) =>
    route(async (req, res) => {
      const h = req.headers.authorization;
      check(h && h.startsWith("Bearer "), 401, "AUTH_REQUIRED");
      const context = await identity.authenticate(h.slice(7));
      check(allowed.includes(context.principal.purpose), 403, "MFA_REQUIRED");
      check(allowedRoles.includes(context.principal.role), 403, "FORBIDDEN");
      res.locals.p = context.principal;
    });
  // Middleware wrapper advances only after the asynchronous authorization finishes.
  const guard =
    (purposes: Purpose[] = ["access"], rs: Role[] = [...roles]) =>
    async (req: Request, res: Response, next: NextFunction) => {
      let failed = false;
      await auth(purposes, rs)(req, res, (e?: unknown) => {
        failed = true;
        next(e);
      });
      if (!failed) next();
    };
  const ctx = (res: Response): Context => ({
    p: res.locals.p as Principal,
    requestId: res.locals.requestId as string,
  });
  const limited = (name: string, max: number, ms: number, account = false) =>
    route(async (req, res) => {
      await db.limit(`${name}:ip:${digest(req.ip ?? "unknown")}`, max, ms);
      if (account) {
        const b = req.body as Record<string, unknown> | undefined;
        const key =
          typeof b?.login === "string"
            ? b.login.toLowerCase()
            : typeof b?.email === "string"
              ? b.email.toLowerCase()
              : typeof b?.proof === "string"
                ? b.proof
                : typeof b?.challenge_id === "string"
                  ? b.challenge_id
                  : "";
        if (key) await db.limit(`${name}:account:${digest(key)}`, max, ms);
      }
      res.locals.limited = true;
    });
  const limit =
    (name: string, max: number, ms: number, account = false) =>
    async (req: Request, res: Response, next: NextFunction) => {
      let failed = false;
      await limited(
        name,
        max,
        ms,
        account,
      )(req, res, (e?: unknown) => {
        failed = true;
        next(e);
      });
      if (!failed) next();
    };
  const principalLimit = (name: string, max = 5) =>
    route(async (_req, res) => {
      const { p } = ctx(res);
      await db.limit(`${name}:${p.tenantId}:${p.userId}`, max, 15 * 60000);
    });
  const userLimit =
    (name: string, max = 5) =>
    async (req: Request, res: Response, next: NextFunction) => {
      let failed = false;
      await principalLimit(name, max)(req, res, (e?: unknown) => {
        failed = true;
        next(e);
      });
      if (!failed) next();
    };
  const sessionResponse = (res: Response, result: object, status = 200) => {
    const r = result as Record<string, unknown>;
    const { refresh, ...body } = r;
    if (typeof refresh === "string")
      res.cookie("auracare_refresh", refresh, {
        httpOnly: true,
        secure: c.production,
        sameSite: "lax",
        path: "/api/v1/auth",
        maxAge: 7 * 86400000,
      });
    return data(res, body, status);
  };
  const requireOrigin = (req: Request) =>
    check(
      req.headers.origin === c.origin,
      403,
      "FORBIDDEN",
      "Origin verification required.",
    );
  app.get("/api/v1/health/live", (_req, res) => data(res, { status: "ok" }));
  app.get(
    "/api/v1/health/ready",
    route(async (_req, res) => {
      await db.connection.db!.admin().command({ ping: 1 });
      data(res, { status: "ready" });
    }),
  );
  app.post(
    "/api/v1/onboarding/contact-challenges",
    limit("contact", 3, 15 * 60000, true),
    route(async (req, res) => {
      const b = z
        .object({ email, desired_subdomain: subdomain })
        .strict()
        .parse(req.body);
      data(res, await identity.contact(b.email, b.desired_subdomain), 202);
    }),
  );
  app.post(
    "/api/v1/onboarding/contact-challenges/verify",
    limit("contact-verify", 10, 15 * 60000, true),
    route(async (req, res) => {
      const b = z
        .object({ challenge_id: id, proof: secret })
        .strict()
        .parse(req.body);
      data(res, await identity.verifyContact(b.challenge_id, b.proof));
    }),
  );
  app.post(
    "/api/v1/onboarding/register",
    limit("register", 5, 3600000),
    route(async (req, res) => {
      const b = z
        .object({
          facility: z
            .object({
              name: z.string().trim().min(2).max(160),
              type: z.enum(["CLINIC", "POLYCLINIC", "DIAGNOSTIC_CENTER"]),
              subdomain,
              capacity: z.number().int().min(1).max(10000),
            })
            .strict(),
          owner: z
            .object({
              name: z.string().trim().min(2).max(120),
              email,
              password,
            })
            .strict(),
          verification_grant: secret,
        })
        .strict()
        .parse(req.body);
      check(
        z.string().min(16).max(128).safeParse(req.headers["idempotency-key"])
          .success,
        400,
        "VALIDATION_ERROR",
        "Idempotency-Key is required.",
      );
      data(
        res,
        await identity.register(
          b,
          ctx(res).requestId,
          req.headers["idempotency-key"] as string,
        ),
        201,
      );
    }),
  );
  app.post(
    "/api/v1/auth/otp-requests",
    limit("otp-request", 3, 15 * 60000, true),
    route(async (req, res) => {
      const b = z
        .object({ facility_subdomain: subdomain, contact: email })
        .strict()
        .parse(req.body);
      await identity.requestOtp(b.facility_subdomain, b.contact);
      data(
        res,
        { message: "If the account is eligible, a sign-in link will be sent." },
        202,
      );
    }),
  );
  app.post(
    "/api/v1/auth/otp-exchange",
    limit("otp-exchange", 5, 15 * 60000),
    route(async (req, res) => {
      const b = z.object({ code: secret }).strict().parse(req.body);
      sessionResponse(res, await identity.exchangeOtp(b.code));
    }),
  );
  app.post(
    "/api/v1/auth/login",
    limit("login", 5, 15 * 60000, true),
    route(async (req, res) => {
      const b = z
        .object({
          facility_subdomain: subdomain,
          login: z
            .string()
            .min(1)
            .max(254)
            .transform((v) => v.toLowerCase()),
          password: secret.optional(),
          portal_pin: z
            .string()
            .regex(/^\d{4}$/)
            .optional(),
        })
        .strict()
        .refine((b) => Boolean(b.password) !== Boolean(b.portal_pin))
        .parse(req.body);
      sessionResponse(
        res,
        await identity.login(
          b.facility_subdomain,
          b.login,
          b.password ?? b.portal_pin!,
          ctx(res).requestId,
          !!b.portal_pin,
        ),
      );
    }),
  );
  app.post(
    "/api/v1/auth/mfa/enroll",
    guard(["mfa-enroll"]),
    userLimit("enroll"),
    route(async (req, res) => {
      z.object({})
        .strict()
        .parse(req.body ?? {});
      data(res, await identity.enroll(ctx(res).p));
    }),
  );
  app.post(
    "/api/v1/auth/mfa/confirm",
    guard(["mfa-enroll"]),
    userLimit("mfa"),
    route(async (req, res) => {
      const b = z.object({ proof: secret }).strict().parse(req.body);
      sessionResponse(
        res,
        await identity.confirm(ctx(res).p, b.proof, ctx(res).requestId),
      );
    }),
  );
  app.post(
    "/api/v1/auth/mfa/verify",
    guard(["mfa-challenge"]),
    userLimit("mfa"),
    route(async (req, res) => {
      const b = z.object({ proof: secret }).strict().parse(req.body);
      sessionResponse(
        res,
        await identity.verifyMfa(ctx(res).p, b.proof, ctx(res).requestId),
      );
    }),
  );
  app.post(
    "/api/v1/auth/refresh",
    limit("refresh", 60, 15 * 60000),
    route(async (req, res) => {
      requireOrigin(req);
      z.object({})
        .strict()
        .parse(req.body ?? {});
      check(
        typeof req.cookies.auracare_refresh === "string",
        401,
        "AUTH_REQUIRED",
      );
      sessionResponse(
        res,
        await identity.refresh(req.cookies.auracare_refresh),
      );
    }),
  );
  app.post(
    "/api/v1/auth/logout",
    guard(["access", "mfa-enroll", "mfa-challenge", "password-change"]),
    route(async (_req, res) => {
      await identity.logout(ctx(res).p);
      res.clearCookie("auracare_refresh", {
        httpOnly: true,
        secure: c.production,
        sameSite: "lax",
        path: "/api/v1/auth",
      });
      res.status(204).end();
    }),
  );
  app.post(
    "/api/v1/auth/password/change",
    guard(["access", "password-change"]),
    userLimit("password"),
    route(async (req, res) => {
      const b = z
        .object({ current: secret, new_password: password })
        .strict()
        .parse(req.body);
      sessionResponse(
        res,
        await identity.changePassword(
          ctx(res).p,
          b.current,
          b.new_password,
          ctx(res).requestId,
        ),
      );
    }),
  );
  app.post(
    "/api/v1/auth/recovery/request",
    limit("recovery", 3, 15 * 60000, true),
    route(async (req, res) => {
      const b = z
        .object({ facility_subdomain: subdomain, login: email })
        .strict()
        .parse(req.body);
      await identity.recovery(b.facility_subdomain, b.login);
      data(
        res,
        {
          message:
            "If the account is eligible, recovery instructions will be sent.",
        },
        202,
      );
    }),
  );
  app.post(
    "/api/v1/auth/recovery/complete",
    limit("reset", 5, 15 * 60000),
    route(async (req, res) => {
      const b = z
        .object({
          token: secret,
          new_password: z.union([password, z.string().regex(/^\d{4}$/)]),
          mfa_proof: secret.optional(),
        })
        .strict()
        .parse(req.body);
      await identity.completeRecovery(
        b.token,
        b.new_password,
        b.mfa_proof,
        ctx(res).requestId,
      );
      data(res, { message: "Password reset. Sign in again." });
    }),
  );
  app.post(
    "/api/v1/auth/invitations/accept",
    limit("invite-accept", 10, 15 * 60000),
    route(async (req, res) => {
      const b = z
        .object({
          token: secret,
          name: z.string().trim().min(2).max(120),
          password,
          signoff_pin: z
            .string()
            .regex(/^\d{6}$/)
            .optional(),
        })
        .strict()
        .parse(req.body);
      sessionResponse(
        res,
        await identity.acceptInvite(
          b.token,
          b.name,
          b.password,
          ctx(res).requestId,
          b.signoff_pin,
        ),
        201,
      );
    }),
  );
  app.get(
    "/api/v1/me",
    guard(),
    route(async (_req, res) => {
      const { p } = ctx(res);
      const u = await db.users(p.tenantId).findOne({ _id: p.userId });
      const t = await db.tenants(p.tenantId).findOne({ _id: p.tenantId });
      check(u && t, 401, "AUTH_INVALID");
      data(res, {
        user: publicUser(u),
        tenant: {
          id: t._id,
          name: t.name,
          subdomain: t.subdomain,
          type: t.type,
        },
      });
    }),
  );
  app.get(
    "/api/v1/staff",
    guard(["access"], ["OWNER"]),
    route(async (req, res) => {
      z.object({}).strict().parse(req.query);
      const users = await db
        .users(ctx(res).p.tenantId)
        .find({ role: { $ne: "PATIENT" } });
      data(res, users.map(publicUser));
    }),
  );
  app.get(
    "/api/v1/staff/invitations",
    guard(["access"], ["OWNER"]),
    route(async (req, res) => {
      z.object({}).strict().parse(req.query);
      const list = await db.challenges(ctx(res).p.tenantId).find({
        purpose: "INVITE",
        consumedAt: null,
        expiresAt: { $gt: new Date() },
      });
      data(
        res,
        list.map((i) => ({
          id: i._id,
          login: i.login,
          role: i.role,
          approved: i.approved,
          expires_at: i.expiresAt,
        })),
      );
    }),
  );
  app.post(
    "/api/v1/staff/invitations",
    guard(["access"], ["OWNER", "PHARMACIST", "LAB"]),
    userLimit("invite", 20),
    route(async (req, res) => {
      const b = z
        .object({ login: email, role: z.enum(roles) })
        .strict()
        .parse(req.body);
      data(
        res,
        await identity.invite(ctx(res).p, b.login, b.role, ctx(res).requestId),
        201,
      );
    }),
  );
  app.post(
    "/api/v1/staff/invitations/:id/approve",
    guard(["access"], ["OWNER"]),
    route(async (req, res) => {
      z.object({})
        .strict()
        .parse(req.body ?? {});
      await identity.approveInvitation(
        ctx(res).p,
        id.parse(req.params.id),
        ctx(res).requestId,
      );
      data(res, { message: "Invitation approved." });
    }),
  );
  app.patch(
    "/api/v1/staff/:id",
    guard(["access"], ["OWNER"]),
    userLimit("staff-sensitive"),
    route(async (req, res) => {
      const b = z
        .object({
          role: z.enum(roles).optional(),
          status: z.enum(["ACTIVE", "DISABLED"]).optional(),
          mfa_proof: secret,
        })
        .strict()
        .refine((v) => !!v.role || !!v.status)
        .parse(req.body);
      const { mfa_proof, ...patch } = b;
      data(
        res,
        await identity.updateStaff(
          ctx(res).p,
          id.parse(req.params.id),
          patch,
          mfa_proof,
          ctx(res).requestId,
        ),
      );
    }),
  );
  app.post(
    "/api/v1/staff/:id/licence-verification",
    guard(["access"], ["OWNER"]),
    userLimit("staff-sensitive"),
    route(async (req, res) => {
      const b = z
        .object({ evidence_ref: z.string().min(3).max(200), mfa_proof: secret })
        .strict()
        .parse(req.body);
      await identity.verifyLicence(
        ctx(res).p,
        id.parse(req.params.id),
        b.evidence_ref,
        b.mfa_proof,
        ctx(res).requestId,
      );
      data(res, { message: "Licence verified." });
    }),
  );
  app.get(
    "/api/v1/audit-events",
    guard(["access"], ["OWNER"]),
    route(async (req, res) => {
      z.object({}).strict().parse(req.query);
      data(
        res,
        (await db.audits(ctx(res).p.tenantId).find()).map((e) => ({
          id: e._id,
          actor_id: e.actorId,
          action: e.action,
          resource_id: e.resourceId,
          outcome: e.outcome,
          created_at: e.createdAt,
          request_id: e.requestId,
        })),
      );
    }),
  );
  receptionRoutes(app, identity, { guard, route, data, ctx }, publish);
  app.use((_req, _res, next) => next(new AppError(404, "NOT_FOUND")));
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    let e: AppError;
    if (err instanceof z.ZodError)
      e = new AppError(400, "VALIDATION_ERROR", "Check the supplied fields.");
    else if (err instanceof AppError) e = err;
    else if ((err as { code?: number })?.code === 11000)
      e = new AppError(409, "CONFLICT", "This record already exists.");
    else if (
      ["MongoServerSelectionError", "MongoNetworkError"].includes(
        (err as Error)?.name,
      )
    )
      e = new AppError(503, "SERVICE_UNAVAILABLE", "Database is unavailable.");
    else if ((err as { status?: number })?.status === 413)
      e = new AppError(
        413,
        "PAYLOAD_TOO_LARGE",
        "Request exceeds the size limit.",
      );
    else if (err instanceof SyntaxError)
      e = new AppError(400, "VALIDATION_ERROR", "Invalid JSON.");
    else
      e = new AppError(
        500,
        "INTERNAL_ERROR",
        "The request could not be completed.",
      );
    res.status(e.status).json({
      error: {
        code: e.code,
        message: e.message,
        fields:
          err instanceof z.ZodError
            ? err.issues.map((i) => ({
                path: i.path.join("."),
                message: i.message,
              }))
            : [],
      },
      meta: { request_id: res.locals.requestId },
    });
  });
  return app;
}
