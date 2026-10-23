import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const name = "auracare-mongo";
export async function localDatabase() {
  try {
    execFileSync("docker", ["inspect", name], { stdio: "ignore" });
    execFileSync("docker", ["start", name], { stdio: "ignore" });
  } catch {
    execFileSync(
      "docker",
      [
        "run",
        "-d",
        "--name",
        name,
        "--label",
        "app=auracare-local",
        "-p",
        "127.0.0.1:27017:27017",
        "mongo:7.0@sha256:c53852c00c23ca9f23fc39690350ffa9a80e3642fe8f96879726d8da0abe80a7",
        "--replSet",
        "rs0",
        "--bind_ip_all",
      ],
      { stdio: "ignore" },
    );
  }
  for (let i = 0; i < 40; i++) {
    try {
      execFileSync(
        "docker",
        [
          "exec",
          name,
          "mongosh",
          "--quiet",
          "--eval",
          'try { rs.status() } catch { rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]}) }',
        ],
        { stdio: "ignore" },
      );
      const writable = execFileSync(
        "docker",
        [
          "exec",
          name,
          "mongosh",
          "--quiet",
          "--eval",
          "db.hello().isWritablePrimary",
        ],
        { encoding: "utf8" },
      );
      if (writable.trim() === "true") return;
    } catch {
      /* Wait only for this startup attempt. */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Local MongoDB replica set did not become writable.");
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await localDatabase();
  console.log("Local MongoDB replica set is ready.");
}
