import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
const image =
    "mongo:7.0@sha256:c53852c00c23ca9f23fc39690350ffa9a80e3642fe8f96879726d8da0abe80a7",
  name = `auracare-backup-tools-${randomUUID()}`;
mkdirSync(".local/mongodb/bin", { recursive: true });
const container = execFileSync("docker", ["create", "--name", name, image], {
  encoding: "utf8",
}).trim();
try {
  for (const tool of ["mongodump", "mongorestore"]) {
    execFileSync("docker", [
      "cp",
      `${container}:/usr/bin/${tool}`,
      resolve(".local/mongodb/bin", tool),
    ]);
    execFileSync(resolve(".local/mongodb/bin", tool), ["--version"], {
      stdio: "ignore",
    });
  }
  console.log("Trusted MongoDB backup tools ready.");
} finally {
  execFileSync("docker", ["rm", "-v", container], { stdio: "ignore" });
}
