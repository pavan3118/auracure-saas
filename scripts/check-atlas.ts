import "../server/src/config/dns.js";
import { readFileSync } from "node:fs";
import dotenv from "dotenv";
import mongoose from "mongoose";
const local = dotenv.parse(readFileSync(".local/atlas.env"));
const c = mongoose.createConnection(local.MONGODB_URI!, {
  dbName: "auracare_phase1_dev",
  serverSelectionTimeoutMS: 12000,
});
try {
  await c.asPromise();
  await c.db!.admin().command({ ping: 1 });
  const hello = await c.db!.admin().command({ hello: 1 });
  console.log(
    "Atlas authenticated ping passed; transactions supported:",
    Boolean(hello.setName && hello.logicalSessionTimeoutMinutes),
    "replica set:",
    typeof hello.setName === "string" ? hello.setName : "not reported",
  );
} catch (e) {
  const error = e as {
    name?: string;
    code?: string;
    syscall?: string;
    reason?: {
      servers?: Map<
        string,
        { error?: { name?: string; code?: string; cause?: { code?: string } } }
      >;
    };
  };
  console.error(
    "Atlas check failed:",
    error.name,
    error.code ?? "connection/discovery failure",
    error.syscall ?? "",
  );
  for (const [address, server] of error.reason?.servers ?? []) {
    console.error(
      "Seed connection:",
      address,
      server.error?.name ?? "no response",
      server.error?.cause?.code ?? server.error?.code ?? "unavailable",
    );
  }
  process.exitCode = 1;
} finally {
  await c.close(true);
}
