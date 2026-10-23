import "dotenv/config";
import "./config/dns.js";
import mongoose from "mongoose";

function redact(message: string, uri: string): string {
  let safe = message.replaceAll(uri, "[redacted URI]");
  const auth = /^mongodb(?:\+srv)?:\/\/([^@]+)@/.exec(uri)?.[1];
  for (const part of auth?.split(":") ?? []) {
    if (!part) continue;
    safe = safe.replaceAll(part, "[redacted]");
    try {
      safe = safe.replaceAll(decodeURIComponent(part), "[redacted]");
    } catch {
      /* An invalid URI is reported without exposing its credentials. */
    }
  }
  return safe.replace(/mongodb(?:\+srv)?:\/\/[^\s]+/g, "[redacted URI]");
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not configured");
  const connection = mongoose.createConnection(uri, {
    serverSelectionTimeoutMS: 10000,
  });
  try {
    await connection.asPromise();
    await connection.db!.admin().command({ ping: 1 });
    console.log("SUCCESS");
  } catch (error) {
    const e = error as Error & {
      reason?: { servers?: Map<string, { error?: Error }> };
    };
    const causes = [...(e.reason?.servers?.values() ?? [])]
      .map((server) => server.error?.message)
      .filter((value): value is string => Boolean(value));
    console.error(
      redact(
        `${e.name}: ${e.message}${causes.length ? `; ${[...new Set(causes)].join("; ")}` : ""}`,
        uri,
      ),
    );
    process.exitCode = 1;
  } finally {
    await connection.close(true);
  }
}
void main().catch((error: unknown) => {
  console.error(
    redact(
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : "Database ping failed",
      process.env.MONGODB_URI ?? "[unset]",
    ),
  );
  process.exitCode = 1;
});
