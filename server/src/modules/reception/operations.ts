import type { ClientSession } from "mongoose";
import { digest } from "../../crypto.js";
import type { Database } from "../../db.js";
import { check, type Principal } from "../../types.js";

/** Transactional retry ledger stores resource references, never patient payloads. */
export class Operations {
  constructor(private db: Database) {}
  async execute(
    principal: Principal,
    operation: string,
    key: string,
    input: unknown,
    create: (session: ClientSession) => Promise<string>,
  ): Promise<string> {
    check(
      key.length >= 16 && key.length <= 128,
      400,
      "VALIDATION_ERROR",
      "Idempotency-Key must contain 16–128 characters.",
    );
    const keyHash = digest(`${principal.userId}:${key}`);
    const requestHash = digest(JSON.stringify(input));
    const lookup = { actorId: principal.userId, operation, keyHash };
    const replay = async () => {
      const prior = await this.db
        .operations(principal.tenantId)
        .findOne(lookup);
      if (!prior) return null;
      check(
        prior.requestHash === requestHash,
        409,
        "CONFLICT",
        "This retry key was used for a different request.",
      );
      return prior.resourceId;
    };
    const prior = await replay();
    if (prior) return prior;
    try {
      return await this.db.transaction(async (session) => {
        // Insert first so concurrent callers cannot both create side effects.
        const entry = await this.db.operations(principal.tenantId).create(
          {
            ...lookup,
            requestHash,
            resourceId: "pending",
            expiresAt: new Date(Date.now() + 86400000),
          },
          session,
        );
        const resourceId = await create(session);
        await this.db
          .operations(principal.tenantId)
          .update({ _id: entry._id }, { $set: { resourceId } }, session);
        return resourceId;
      });
    } catch (error) {
      const result = await replay();
      if (result) return result;
      throw error;
    }
  }
}
