import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import type { Config } from "./config.js";
import type { Database } from "./db.js";
import { open, seal } from "./crypto.js";
import type { ClientSession } from "mongoose";
export interface Mailer {
  send(to: string, subject: string, body: string): Promise<void>;
}
export function mailer(config: Config): Mailer {
  if (config.smtpUrl) {
    const u = new URL(config.smtpUrl);
    if (!["smtp:", "smtps:"].includes(u.protocol))
      throw new Error("SMTP_URL must use smtp or smtps");
    const transport = nodemailer.createTransport({
      host: u.hostname,
      port: Number(u.port || (u.protocol === "smtps:" ? 465 : 587)),
      secure: u.protocol === "smtps:",
      requireTLS: true,
      auth: {
        user: decodeURIComponent(u.username),
        pass: decodeURIComponent(u.password),
      },
      tls: { rejectUnauthorized: true },
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    return {
      send: async (to, subject, text) => {
        await transport.sendMail({ from: config.mailFrom, to, subject, text });
      },
    };
  }
  if (config.production) throw new Error("SMTP required");
  return {
    send: async (to, subject, body) => {
      await mkdir(config.mailDir, { recursive: true, mode: 0o700 });
      await writeFile(
        resolve(config.mailDir, `${randomUUID()}.json`),
        JSON.stringify({ to, subject, body }),
        { mode: 0o600 },
      );
    },
  };
}
export async function queueMail(
  db: Database,
  c: Config,
  t: string,
  to: string,
  subject: string,
  body: string,
  s?: ClientSession,
) {
  await db.outbox(t).create(
    {
      recipient: to,
      subject,
      encryptedBody: seal(body, c.encryptionKey),
      status: "PENDING",
      attempts: 0,
      nextAttempt: new Date(),
    },
    s,
  );
}
export async function deliverOutbox(db: Database, c: Config, m: Mailer) {
  for (const ref of await db.pendingMail()) {
    const q = db.outbox(ref.tenant_id);
    const item = await q.update(
      { _id: ref._id, status: "PENDING", nextAttempt: { $lte: new Date() } },
      {
        $set: { nextAttempt: new Date(Date.now() + 60000) },
        $inc: { attempts: 1 },
      },
    );
    if (!item) continue;
    try {
      await m.send(
        item.recipient,
        item.subject,
        open(item.encryptedBody, c.encryptionKey),
      );
      await q.update(
        { _id: item._id },
        { $set: { status: "SENT", encryptedBody: "" } },
      );
    } catch {
      await q.update(
        { _id: item._id },
        {
          $set: {
            nextAttempt: new Date(
              Date.now() +
                Math.min(3600000, 1000 * 2 ** Math.min(item.attempts, 12)),
            ),
          },
        },
      );
    }
  }
}
