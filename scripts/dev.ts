import { spawn, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import dotenv from "dotenv";
import { localDatabase } from "./local-db.js";
execFileSync("node", ["--import", "tsx", "scripts/setup-local.ts"], {
  stdio: "inherit",
});
const env = {
  ...dotenv.parse(readFileSync(".local/development.env")),
  ...process.env,
};
if (process.argv.includes("--atlas")) {
  Object.assign(env, dotenv.parse(readFileSync(".local/atlas.env")));
  const uri = new URL(env.MONGODB_URI!);
  if (!uri.pathname || uri.pathname === "/")
    uri.pathname = "/auracare_phase1_dev";
  env.MONGODB_URI = uri.toString();
} else if (env.MONGODB_URI?.includes("127.0.0.1")) await localDatabase();
const children = [
  spawn("npm", ["run", "dev", "-w", "server"], {
    env,
    stdio: "inherit",
    detached: true,
  }),
  spawn("npm", ["run", "dev", "-w", "client"], {
    env,
    stdio: "inherit",
    detached: true,
  }),
];
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  children.forEach((p) => {
    if (p.pid) {
      try {
        process.kill(-p.pid, "SIGTERM");
      } catch {
        /* Child group already exited. */
      }
    }
  });
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
children.forEach((p) =>
  p.on("exit", (code) => {
    stop();
    process.exitCode = code ?? 1;
  }),
);
