import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const mongoImage =
  "mongo:7.0@sha256:c53852c00c23ca9f23fc39690350ffa9a80e3642fe8f96879726d8da0abe80a7";
export function prepareTestBinary() {
  const binary =
    process.env.MONGOMS_SYSTEM_BINARY || resolve(".local/mongodb/bin/mongod");
  if (!existsSync(binary)) {
    if (process.env.MONGOMS_SYSTEM_BINARY)
      throw new Error("Configured MongoDB test binary does not exist.");
    mkdirSync(resolve(".local/mongodb/bin"), { recursive: true });
    const name = `auracare-test-binary-${randomUUID()}`;
    const container = execFileSync(
      "docker",
      ["create", "--name", name, mongoImage],
      { encoding: "utf8" },
    ).trim();
    try {
      execFileSync("docker", ["cp", `${container}:/usr/bin/mongod`, binary]);
    } finally {
      execFileSync("docker", ["rm", "-v", container], { stdio: "ignore" });
    }
  }
  const info = execFileSync(binary, ["--version"], { encoding: "utf8" });
  const version = /db version v(\d+\.\d+\.\d+)/.exec(info)?.[1];
  if (!version)
    throw new Error("Could not identify MongoDB test binary version.");
  return { systemBinary: binary, version };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  prepareTestBinary();
  console.log("MongoDB test binary ready.");
}
