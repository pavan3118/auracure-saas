import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import dotenv from "dotenv";
const env = {
  ...dotenv.parse(readFileSync(".local/development.env")),
  ...process.env,
};
const p = spawn(
  "npm",
  ["run", process.argv[2] ?? "db:indexes", "-w", "server"],
  { env, stdio: "inherit" },
);
p.on("exit", (c) => {
  process.exitCode = c ?? 1;
});
