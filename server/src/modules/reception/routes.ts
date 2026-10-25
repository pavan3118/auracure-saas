import type { Express, Request, Response, RequestHandler } from "express";
import { z } from "zod";
import type { Identity } from "../../auth.js";
import type { Principal, Purpose, Role } from "../../types.js";
import { check } from "../../types.js";
import { Reception, type QueuePublisher } from "./service.js";
import {
  patientInput,
  patientPatch,
  listPatients,
  checkInInput,
  cancelInput,
  vitalsInput,
  cashInput,
} from "./contracts.js";
interface HttpTools {
  guard: (purposes?: Purpose[], roles?: Role[]) => RequestHandler;
  route: (
    fn: (req: Request, res: Response) => Promise<unknown>,
  ) => RequestHandler;
  data: (res: Response, value: unknown, status?: number) => unknown;
  ctx: (res: Response) => { p: Principal; requestId: string };
}
export function receptionRoutes(
  app: Express,
  identity: Identity,
  tools: HttpTools,
  publish?: QueuePublisher,
) {
  const service = new Reception(identity, publish),
    { guard, route, data, ctx } = tools,
    id = z.string().uuid();
  const key = (req: Request) => {
    const k = req.header("Idempotency-Key");
    check(
      k && k.length >= 16 && k.length <= 128,
      400,
      "VALIDATION_ERROR",
      "Idempotency-Key is required (16–128 characters).",
    );
    return k;
  };
  app.get(
    "/api/v1/patients",
    guard(["access"], ["RECEPTIONIST", "OWNER"]),
    route(async (req, res) =>
      data(
        res,
        await service.search(ctx(res).p, listPatients.parse(req.query)),
      ),
    ),
  );
  app.post(
    "/api/v1/patients",
    guard(["access"], ["RECEPTIONIST"]),
    route(async (req, res) =>
      data(
        res,
        await service.register(
          ctx(res).p,
          patientInput.parse(req.body),
          key(req),
          ctx(res).requestId,
        ),
        201,
      ),
    ),
  );
  app.get(
    "/api/v1/patients/:id",
    guard(["access"], ["RECEPTIONIST", "OWNER", "DOCTOR", "PATIENT"]),
    route(async (req, res) =>
      data(res, await service.patient(ctx(res).p, id.parse(req.params.id))),
    ),
  );
  app.patch(
    "/api/v1/patients/:id",
    guard(["access"], ["RECEPTIONIST"]),
    route(async (req, res) =>
      data(
        res,
        await service.update(
          ctx(res).p,
          id.parse(req.params.id),
          patientPatch.parse(req.body),
          ctx(res).requestId,
        ),
      ),
    ),
  );
  app.post(
    "/api/v1/visits",
    guard(["access"], ["RECEPTIONIST"]),
    route(async (req, res) =>
      data(
        res,
        await service.checkIn(
          ctx(res).p,
          checkInInput.parse(req.body).patient_id,
          key(req),
          ctx(res).requestId,
        ),
        201,
      ),
    ),
  );
  app.get(
    "/api/v1/queue",
    guard(["access"], ["RECEPTIONIST", "OWNER", "DOCTOR"]),
    route(async (req, res) => {
      z.object({}).strict().parse(req.query);
      data(res, await service.queue(ctx(res).p));
    }),
  );
  app.post(
    "/api/v1/visits/:id/cancel",
    guard(["access"], ["RECEPTIONIST", "OWNER"]),
    route(async (req, res) =>
      data(
        res,
        await service.cancel(
          ctx(res).p,
          id.parse(req.params.id),
          cancelInput.parse(req.body),
          key(req),
          ctx(res).requestId,
        ),
      ),
    ),
  );
  app.post(
    "/api/v1/visits/:id/vitals",
    guard(["access"], ["RECEPTIONIST"]),
    route(async (req, res) =>
      data(
        res,
        await service.recordVitals(
          ctx(res).p,
          id.parse(req.params.id),
          vitalsInput.parse(req.body),
          key(req),
          ctx(res).requestId,
        ),
        201,
      ),
    ),
  );
  app.get(
    "/api/v1/visits/:id/vitals",
    guard(["access"], ["RECEPTIONIST", "DOCTOR"]),
    route(async (req, res) => {
      z.object({}).strict().parse(req.query);
      data(res, await service.vitals(ctx(res).p, id.parse(req.params.id)));
    }),
  );
  app.get(
    "/api/v1/cash/sessions",
    guard(["access"], ["RECEPTIONIST", "OWNER"]),
    route(async (req, res) => {
      z.object({}).strict().parse(req.query);
      data(res, await service.cash(ctx(res).p));
    }),
  );
  app.post(
    "/api/v1/cash/sessions",
    guard(["access"], ["RECEPTIONIST"]),
    route(async (req, res) =>
      data(
        res,
        await service.openCash(
          ctx(res).p,
          cashInput.parse(req.body),
          key(req),
          ctx(res).requestId,
        ),
        201,
      ),
    ),
  );
}
