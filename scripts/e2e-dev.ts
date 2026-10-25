import { spawn } from "node:child_process";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { prepareTestBinary } from "./test-db.js";
const mongo = await MongoMemoryReplSet.create({
  binary: prepareTestBinary(),
  replSet: { count: 1, spawn: { detached: true } },
});
// Run the dev supervisor directly so SIGTERM reaches its owned child groups.
const child = spawn(process.execPath, ["--import", "tsx", "scripts/dev.ts"], {
  stdio: "inherit",
  env: {
    ...process.env,
    MONGODB_URI: mongo.getUri("auracare_e2e"),
    APP_ORIGIN: "http://localhost:5173",
    NODE_ENV: "development",
    SMTP_URL: "",
  },
});
let stopping: Promise<void> | undefined;
function stop(): Promise<void> {
  if (stopping) return stopping;
  stopping = (async () => {
    if (child.exitCode === null) {
      const exited = new Promise<void>((resolve) =>
        child.once("exit", () => resolve()),
      );
      child.kill("SIGTERM");
      const force = setTimeout(() => child.kill("SIGKILL"), 5000);
      await exited;
      clearTimeout(force);
    }
    await mongo.stop();
  })();
  return stopping;
}
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
child.once("exit", (code) => {
  process.exitCode = code ?? 1;
  void stop();
});
