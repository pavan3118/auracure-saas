import { spawn } from "node:child_process";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { prepareTestBinary } from "./test-db.js";

// A real, disposable replica set preserves transaction/concurrency test coverage.
// Atlas credentials and server/.env are never loaded by this runner.
const binary = prepareTestBinary();
const mongo = await MongoMemoryReplSet.create({
  binary,
  replSet: { count: 1 },
});
try {
  const child = spawn("npm", ["run", "test", "--workspaces"], {
    stdio: "inherit",
    env: { ...process.env, TEST_MONGODB_URI: mongo.getUri() },
  });
  const terminate = () => child.kill("SIGTERM");
  process.once("SIGINT", terminate);
  process.once("SIGTERM", terminate);
  process.exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  process.removeListener("SIGINT", terminate);
  process.removeListener("SIGTERM", terminate);
} finally {
  await mongo.stop();
}
