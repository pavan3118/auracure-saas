import type { Express, Request, Response, RequestHandler } from "express";
import { z } from "zod";
import type { Identity } from "../../auth.js";
import { check, type Principal, type Purpose, type Role } from "../../types.js";
import { Billing } from "../billing/service.js";
import * as b from "../billing/contracts.js";
import { Pharmacy } from "../pharmacy/service.js";
import * as p from "../pharmacy/contracts.js";
import { Laboratory } from "../laboratory/service.js";
import * as l from "../laboratory/contracts.js";
interface Tools {
  guard: (purposes?: Purpose[], roles?: Role[]) => RequestHandler;
  route: (
    fn: (req: Request, res: Response) => Promise<unknown>,
  ) => RequestHandler;
  data: (res: Response, value: unknown, status?: number) => unknown;
  ctx: (res: Response) => { p: Principal; requestId: string };
}
export function operationsRoutes(app: Express, identity: Identity, t: Tools) {
  const billing = new Billing(identity),
    pharmacy = new Pharmacy(identity),
    lab = new Laboratory(identity);
  const id = (r: Request) => z.string().uuid().parse(r.params.id);
  const key = (r: Request) => {
    const k = r.header("Idempotency-Key");
    check(
      k && k.length >= 16 && k.length <= 128,
      400,
      "VALIDATION_ERROR",
      "Idempotency-Key is required (16–128 characters).",
    );
    return k;
  };
  const add = (
    method: "get" | "post" | "patch",
    path: string,
    roles: Role[],
    fn: (req: Request, p: Principal, rid: string) => Promise<unknown>,
  ) =>
    app[method](
      `/api/v1${path}`,
      t.guard(["access"], roles),
      t.route(async (req, res) => {
        if (method === "get") z.object({}).strict().parse(req.query);
        if (
          method === "post" &&
          (path.endsWith("/void") || path.endsWith("/review"))
        ) {
          const { p } = t.ctx(res);
          await identity.db.limit(
            `phase4-owner-proof:${p.tenantId}:${p.userId}`,
            10,
            15 * 60000,
          );
        }
        return t.data(
          res,
          await fn(req, t.ctx(res).p, t.ctx(res).requestId),
          method === "post" ? 201 : 200,
        );
      }),
    );
  const bill: Role[] = ["OWNER", "RECEPTIONIST"],
    readers: Role[] = [...bill, "PATIENT"];
  add("get", "/invoices", readers, (_r, p) => billing.list(p));
  add("post", "/invoices", bill, (r, p, q) =>
    billing.create(p, b.invoiceInput.parse(r.body), key(r), q),
  );
  add("get", "/invoices/:id", readers, (r, p) => billing.get(p, id(r)));
  add("patch", "/invoices/:id", bill, (r, p, q) =>
    billing.update(p, id(r), b.invoicePatch.parse(r.body), q),
  );
  add("post", "/invoices/:id/issue", bill, (r, p, q) =>
    billing.issue(
      p,
      id(r),
      b.version.parse(r.body).expected_version,
      key(r),
      q,
    ),
  );
  add("post", "/invoices/:id/void", ["OWNER"], (r, p, q) =>
    billing.void(p, id(r), b.voidInput.parse(r.body), key(r), q),
  );
  add("get", "/invoices/:id/payments", readers, (r, p) =>
    billing.payments(p, id(r)),
  );
  add("post", "/invoices/:id/payments", ["RECEPTIONIST"], (r, p, q) =>
    billing.pay(p, id(r), b.paymentInput.parse(r.body), key(r), q),
  );
  add("get", "/cash/sessions/:id", bill, (r, p) =>
    billing.cashDetail(p, id(r)),
  );
  add("post", "/cash/sessions/:id/close", ["RECEPTIONIST"], (r, p, q) =>
    billing.closeCash(p, id(r), b.closeInput.parse(r.body), key(r), q),
  );
  add("post", "/cash/sessions/:id/review", ["OWNER"], (r, p, q) =>
    billing.reviewCash(p, id(r), b.reviewInput.parse(r.body), key(r), q),
  );
  add("get", "/pharmacy/batches", ["OWNER", "PHARMACIST"], (_r, p) =>
    pharmacy.batches(p),
  );
  add("post", "/pharmacy/batches", ["PHARMACIST"], (r, a, q) =>
    pharmacy.receive(a, p.batchInput.parse(r.body), key(r), q),
  );
  add("post", "/pharmacy/batches/:id/adjustments", ["PHARMACIST"], (r, a, q) =>
    pharmacy.adjust(a, id(r), p.adjustmentInput.parse(r.body), key(r), q),
  );
  add("get", "/pharmacy/prescriptions", ["PHARMACIST"], (_r, p) =>
    pharmacy.prescriptions(p),
  );
  add("get", "/pharmacy/substitutions", ["PHARMACIST", "DOCTOR"], (_r, p) =>
    pharmacy.swaps(p),
  );
  add("post", "/prescriptions/:id/substitutions", ["PHARMACIST"], (r, a, q) =>
    pharmacy.requestSwap(
      a,
      id(r),
      p.substitutionInput.parse(r.body),
      key(r),
      q,
    ),
  );
  add("post", "/pharmacy/substitutions/:id/approve", ["DOCTOR"], (r, a, q) =>
    pharmacy.approveSwap(
      a,
      id(r),
      p.approveInput.parse(r.body).password,
      key(r),
      q,
    ),
  );
  add("post", "/prescriptions/:id/dispense", ["PHARMACIST"], (r, a, q) =>
    pharmacy.dispense(a, id(r), p.dispenseInput.parse(r.body), key(r), q),
  );
  add("get", "/lab/orders", ["LAB", "DOCTOR"], (_r, p) => lab.list(p));
  add("post", "/lab/orders/:id/collect", ["LAB"], (r, p, q) =>
    lab.collect(
      p,
      id(r),
      l.collectInput.parse(r.body).expected_version,
      key(r),
      q,
    ),
  );
  add("get", "/lab/orders/:id/results", ["LAB", "DOCTOR"], (r, p) =>
    lab.history(p, id(r)),
  );
  add("post", "/lab/orders/:id/results", ["LAB"], (r, p, q) =>
    lab.create(p, id(r), l.resultInput.parse(r.body), key(r), q),
  );
  add("get", "/lab/results/:id", ["LAB", "DOCTOR", "PATIENT"], (r, p) =>
    lab.result(p, id(r)),
  );
  add("patch", "/lab/results/:id", ["LAB"], (r, p, q) =>
    lab.update(p, id(r), l.resultPatch.parse(r.body), q),
  );
  add("post", "/lab/results/:id/sign", ["LAB"], (r, p, q) => {
    const v = l.signInput.parse(r.body);
    return lab.sign(p, id(r), v.expected_version, v.signoff_pin, key(r), q);
  });
  add("post", "/lab/results/:id/verify", ["DOCTOR"], (r, p, q) => {
    const v = l.verifyInput.parse(r.body);
    return lab.verify(p, id(r), v.expected_version, v.password, key(r), q);
  });
  add("post", "/lab/results/:id/release", ["LAB"], (r, p, q) =>
    lab.release(p, id(r), l.version.parse(r.body).expected_version, key(r), q),
  );
}
