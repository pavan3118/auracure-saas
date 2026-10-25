import { Operations } from "../reception/operations.js";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import type { Identity } from "../../auth.js";
import { digest } from "../../crypto.js";
import { check, type Principal } from "../../types.js";
import { Portal } from "./service.js";
export type DocumentKind = "PRESCRIPTION" | "LAB_RESULT" | "INVOICE";
function recordText(kind: DocumentKind, data: Record<string, unknown>) {
  const text = (v: unknown) => (v == null ? "" : String(v));
  const money = (v: unknown) => `INR ${(Number(v) / 100).toFixed(2)}`;
  if (kind === "PRESCRIPTION")
    return (
      `Prescription revision ${data.revision}\nSigned: ${text(data.signed_at)}\n\n` +
      (data.items as Record<string, unknown>[])
        .map(
          (i, n) =>
            `${n + 1}. ${i.medicine} ${i.strength}\nDose: ${i.dose} | Route: ${i.route}\nFrequency: ${i.frequency} | Duration: ${i.duration}\nQuantity: ${text(i.quantity)}\nInstructions: ${text(i.instructions)}`,
        )
        .join("\n\n") +
      `\n\nNotes: ${text(data.notes)}`
    );
  if (kind === "LAB_RESULT")
    return (
      `Laboratory result revision ${data.revision}\nVerified: ${text(data.verified_at)}\nReleased: ${text(data.released_at)}\n\n` +
      (data.observations as Record<string, unknown>[])
        .map(
          (o) =>
            `${o.name}: ${o.value} ${text(o.unit)}\nReference interval: ${text(o.reference_interval)}\n${text(o.comments)}`,
        )
        .join("\n\n") +
      `\n\nComments: ${text(data.comments)}`
    );
  return (
    `Invoice ${data.number} | ${data.state}\n\n` +
    (data.lines as Record<string, unknown>[])
      .map(
        (l, n) =>
          `${n + 1}. ${l.description}\n${l.quantity} x ${money(l.unit_price_minor)} | Tax ${Number(l.tax_basis_points) / 100}% | Total ${money(l.total_minor)}`,
      )
      .join("\n\n") +
    `\n\nTotal: ${money(data.total_minor)}\nPaid: ${money(data.paid_minor)}\nBalance: ${money(data.balance_minor)}`
  );
}
export class Documents {
  constructor(private identity: Identity) {}
  private file(key: string) {
    check(/^[a-f0-9-]{36}\.pdf$/.test(key), 500, "INVALID_STORAGE_KEY");
    return join(
      resolve(this.identity.config.documentsDir ?? ".local/documents"),
      key,
    );
  }
  private async render(title: string, body: string) {
    const pdf = new PDFDocument({
        size: "A4",
        margin: 45,
        info: { Title: title, Author: "AuraCare" },
      }),
      chunks: Buffer[] = [];
    const done = new Promise<Buffer>((ok, no) => {
      pdf.on("data", (c) => chunks.push(c as Buffer));
      pdf.on("end", () => ok(Buffer.concat(chunks)));
      pdf.on("error", no);
    });
    try {
      pdf.font(
        resolve(dirname(fileURLToPath(import.meta.url)), "DejaVuSans.ttf"),
      );
      const font = (
        pdf as unknown as {
          _font: { font: { hasGlyphForCodePoint: (n: number) => boolean } };
        }
      )._font.font;
      check(
        [...body].every(
          (c) =>
            /[\n\r\t]/.test(c) || font.hasGlyphForCodePoint(c.codePointAt(0)!),
        ),
        422,
        "UNSUPPORTED_PDF_TEXT",
        "This document contains characters unsupported by the installed PDF font. Read the original in your portal.",
      );
      pdf.fontSize(18).text(title);
      pdf.moveDown();
      pdf.fontSize(10).text(body, { lineGap: 3 });
      pdf.end();
      return await done;
    } catch (e) {
      pdf.end();
      await done.catch(() => {});
      throw e;
    }
  }
  async generate(
    p: Principal,
    kind: DocumentKind,
    id: string,
    requestId: string,
    key: string,
  ) {
    const portal = new Portal(this.identity),
      source = await portal.source(p, kind, id),
      sourceHash = digest(JSON.stringify(source.data)),
      db = this.identity.db;
    // Bind retry keys to a validated source request even when the semantic document already exists.
    await new Operations(db).execute(
      p,
      "document.request",
      key,
      { kind, id },
      async () => id,
    );
    const old = await db
      .documents(p.tenantId)
      .findOne({ kind, sourceId: id, sourceHash });
    if (old) return this.view(old);
    // Only explicit source fields enter the export; no arbitrary HTML or remote URLs are rendered.
    const body = `Patient: ${source.patient.name}\nRecord: ${id}\nGenerated: ${new Date().toISOString()}\n\n${recordText(kind, source.data)}\n\nAuthenticated record copy. Signed clinical content is entered by your care team.`;
    const bytes = await this.render(
      `AuraCare ${kind.replaceAll("_", " ")}`,
      body,
    );
    check(bytes.length <= 10000000, 413, "DOCUMENT_TOO_LARGE");
    const storageKey = `${randomUUID()}.pdf`,
      file = this.file(storageKey);
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(file, bytes, { mode: 0o600, flag: "wx" });
    let keep = false;
    try {
      let record;
      try {
        record = await db.transaction(async (s) => {
          // Reauthorize against the latest state; lab corrections serialize on the current order.
          await portal.source(p, kind, id);
          if (kind === "LAB_RESULT") {
            const r = await db.labResults(p.tenantId).findOne({ _id: id }, s);
            check(r, 404, "NOT_FOUND");
            check(
              await db
                .labOrders(p.tenantId)
                .update(
                  { _id: r.orderId, state: "RELEASED", currentResultId: id },
                  { $inc: { version: 1 } },
                  s,
                ),
              404,
              "NOT_FOUND",
            );
          }
          const d = await db.documents(p.tenantId).create(
            {
              patientId: source.patient._id,
              kind,
              sourceId: id,
              sourceHash,
              storageKey,
              checksum: createHash("sha256").update(bytes).digest("hex"),
              sizeBytes: bytes.length,
            },
            s,
          );
          await this.identity.audit(
            p.tenantId,
            p.userId,
            "DOCUMENT_CREATED",
            d._id,
            requestId,
            s,
          );
          return d;
        });
      } catch (e) {
        const existing = await db
          .documents(p.tenantId)
          .findOne({ kind, sourceId: id, sourceHash });
        if (!existing) throw e;
        record = existing;
      }
      keep = record.storageKey === storageKey;
      return this.view(record);
    } finally {
      if (!keep) await unlink(file).catch(() => {});
    }
  }
  private view(d: {
    _id: string;
    kind: string;
    sourceId: string;
    sizeBytes: number;
  }) {
    return {
      id: d._id,
      kind: d.kind,
      source_id: d.sourceId,
      size_bytes: d.sizeBytes,
    };
  }
  async download(p: Principal, id: string, requestId: string) {
    const pat = await new Portal(this.identity).patient(p),
      d = await this.identity.db
        .documents(p.tenantId)
        .findOne({ _id: id, patientId: pat._id });
    check(d, 404, "NOT_FOUND");
    await new Portal(this.identity).source(p, d.kind, d.sourceId);
    const bytes = await readFile(this.file(d.storageKey)).catch(() => null);
    check(
      bytes &&
        bytes.length === d.sizeBytes &&
        createHash("sha256").update(bytes).digest("hex") === d.checksum,
      503,
      "DOCUMENT_UNAVAILABLE",
    );
    await this.identity.audit(
      p.tenantId,
      p.userId,
      "DOCUMENT_DOWNLOADED",
      id,
      requestId,
    );
    return bytes;
  }
}
