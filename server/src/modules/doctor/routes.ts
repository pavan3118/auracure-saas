import type { Express, Request, Response, RequestHandler } from "express";
import { z } from "zod";
import type { Identity } from "../../auth.js";
import { check, type Principal, type Purpose, type Role } from "../../types.js";
import type { QueuePublisher } from "../reception/service.js";
import { Doctor } from "./service.js";
import {
  empty,
  noteInput,
  prescriptionInput,
  versionInput,
  signInput,
  revisionInput,
  labInput,
  serviceInput,
  amendmentInput,
} from "./contracts.js";
interface Tools {
  guard: (purposes?: Purpose[], roles?: Role[]) => RequestHandler;
  route: (
    fn: (req: Request, res: Response) => Promise<unknown>,
  ) => RequestHandler;
  data: (res: Response, value: unknown, status?: number) => unknown;
  ctx: (res: Response) => { p: Principal; requestId: string };
}
export function doctorRoutes(
  app: Express,
  identity: Identity,
  tools: Tools,
  publish?: QueuePublisher,
) {
  const d = new Doctor(identity, publish),
    { guard, route, data, ctx } = tools,
    id = z.string().uuid();
  const doctor = () => guard(["access"], ["DOCTOR"]);
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
    "/api/v1/doctor/workspace",
    doctor(),
    route(async (req, res) => {
      empty.parse(req.query);
      data(res, await d.workspace(ctx(res).p));
    }),
  );
  app.get(
    "/api/v1/doctor/visits",
    doctor(),
    route(async (req, res) => {
      empty.parse(req.query);
      data(res, await d.list(ctx(res).p));
    }),
  );
  app.get(
    "/api/v1/visits/:id",
    doctor(),
    route(async (req, res) => {
      empty.parse(req.query);
      data(res, await d.detail(ctx(res).p, id.parse(req.params.id)));
    }),
  );
  app.post(
    "/api/v1/queue/claim-next",
    doctor(),
    route(async (req, res) => {
      empty.parse(req.body ?? {});
      data(res, await d.claim(ctx(res).p, key(req), ctx(res).requestId), 201);
    }),
  );
  app.get(
    "/api/v1/visits/:id/consultation",
    doctor(),
    route(async (req, res) => {
      empty.parse(req.query);
      data(res, await d.note(ctx(res).p, id.parse(req.params.id)));
    }),
  );
  app.patch(
    "/api/v1/visits/:id/consultation",
    doctor(),
    route(async (req, res) =>
      data(
        res,
        await d.saveNote(
          ctx(res).p,
          id.parse(req.params.id),
          noteInput.parse(req.body),
          ctx(res).requestId,
        ),
      ),
    ),
  );
  app.post(
    "/api/v1/visits/:id/prescriptions",
    doctor(),
    route(async (req, res) => {
      empty.parse(req.body ?? {});
      data(
        res,
        await d.createPrescription(
          ctx(res).p,
          id.parse(req.params.id),
          key(req),
          ctx(res).requestId,
        ),
        201,
      );
    }),
  );
  app.get(
    "/api/v1/prescriptions/:id",
    guard(["access"], ["DOCTOR", "PHARMACIST", "PATIENT"]),
    route(async (req, res) => {
      empty.parse(req.query);
      data(res, await d.prescription(ctx(res).p, id.parse(req.params.id)));
    }),
  );
  app.post(
    "/api/v1/prescriptions/:id/revisions",
    doctor(),
    route(async (req, res) =>
      data(
        res,
        await d.revision(
          ctx(res).p,
          id.parse(req.params.id),
          revisionInput.parse(req.body).reason,
          key(req),
          ctx(res).requestId,
        ),
        201,
      ),
    ),
  );
  for (const [path, renew] of [
    ["lease", false],
    ["lease/renew", true],
  ] as const)
    app.post(
      `/api/v1/prescriptions/:id/${path}`,
      doctor(),
      route(async (req, res) =>
        data(
          res,
          await d.lease(
            ctx(res).p,
            id.parse(req.params.id),
            versionInput.parse(req.body).expected_version,
            renew,
          ),
        ),
      ),
    );
  app.patch(
    "/api/v1/prescriptions/:id",
    doctor(),
    route(async (req, res) =>
      data(
        res,
        await d.savePrescription(
          ctx(res).p,
          id.parse(req.params.id),
          prescriptionInput.parse(req.body),
          ctx(res).requestId,
        ),
      ),
    ),
  );
  app.post(
    "/api/v1/prescriptions/:id/sign",
    doctor(),
    route(async (req, res) => {
      const b = signInput.parse(req.body);
      data(
        res,
        await d.sign(
          ctx(res).p,
          id.parse(req.params.id),
          b.expected_version,
          b.password,
          key(req),
          ctx(res).requestId,
        ),
      );
    }),
  );
  app.post(
    "/api/v1/prescriptions/:id/discard",
    doctor(),
    route(async (req, res) => {
      const b = versionInput
        .extend({ reason: z.string().trim().min(3).max(500) })
        .strict()
        .parse(req.body);
      data(
        res,
        await d.discard(
          ctx(res).p,
          id.parse(req.params.id),
          b.expected_version,
          b.reason,
          key(req),
          ctx(res).requestId,
        ),
      );
    }),
  );
  app.post(
    "/api/v1/lab/orders",
    doctor(),
    route(async (req, res) =>
      data(
        res,
        await d.orderLab(
          ctx(res).p,
          labInput.parse(req.body),
          key(req),
          ctx(res).requestId,
        ),
        201,
      ),
    ),
  );
  app.get(
    "/api/v1/lab/orders",
    guard(["access"], ["DOCTOR", "LAB"]),
    route(async (req, res) => {
      empty.parse(req.query);
      data(res, await d.labs(ctx(res).p));
    }),
  );
  app.post(
    "/api/v1/visits/:id/service-orders",
    doctor(),
    route(async (req, res) =>
      data(
        res,
        await d.orderService(
          ctx(res).p,
          id.parse(req.params.id),
          serviceInput.parse(req.body),
          key(req),
          ctx(res).requestId,
        ),
        201,
      ),
    ),
  );
  app.post(
    "/api/v1/visits/:id/complete",
    doctor(),
    route(async (req, res) =>
      data(
        res,
        await d.complete(
          ctx(res).p,
          id.parse(req.params.id),
          versionInput.parse(req.body).expected_version,
          key(req),
          ctx(res).requestId,
        ),
      ),
    ),
  );
  app.post(
    "/api/v1/visits/:id/amendments",
    doctor(),
    route(async (req, res) =>
      data(
        res,
        await d.amend(
          ctx(res).p,
          id.parse(req.params.id),
          amendmentInput.parse(req.body),
          key(req),
          ctx(res).requestId,
        ),
        201,
      ),
    ),
  );
}
