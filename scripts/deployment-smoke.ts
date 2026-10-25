import { MongoMemoryReplSet } from "mongodb-memory-server";
import { prepareTestBinary } from "./test-db.js";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
const mongo = await MongoMemoryReplSet.create({
    binary: prepareTestBinary(),
    replSet: { count: 1 },
  }),
  directory = await mkdtemp(join(tmpdir(), "auracare-deploy-smoke-")),
  name = `auracare-deploy-smoke-${randomUUID()}`;
let running = false;
try {
  const probe = createServer();
  await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((r, e) => probe.close((err) => (err ? e(err) : r())));
  const keys = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  for (const [file, data] of [
    ["private.pem", keys.privateKey],
    ["public.pem", keys.publicKey],
    ["mfa.key", randomBytes(32)],
    ["pin.key", randomBytes(32)],
  ] as const)
    await writeFile(join(directory, file), data, { mode: 0o600 });
  const documents = join(directory, "documents");
  await mkdir(documents, { mode: 0o700 });
  const env = [
    `MONGODB_URI=${mongo.getUri(`auracare_test_deploy_${randomUUID().replaceAll("-", "")}`)}`,
    `PORT=${port}`,
    "APP_ORIGIN=https://auracare.example.test",
    "SMTP_URL=smtps://synthetic:synthetic@127.0.0.1:465",
    "JWT_PRIVATE_KEY_FILE=/run/auracare/private.pem",
    "JWT_PUBLIC_KEY_FILE=/run/auracare/public.pem",
    "MFA_ENCRYPTION_KEY_FILE=/run/auracare/mfa.key",
    "PIN_PEPPER_FILE=/run/auracare/pin.key",
  ].join("\n");
  const envFile = join(directory, "runtime.env");
  await writeFile(envFile, env, { mode: 0o600 });
  execFileSync(
    "docker",
    [
      "run",
      "-d",
      "--name",
      name,
      "--network",
      "host",
      "--user",
      `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
      "--env-file",
      envFile,
      "--mount",
      `type=bind,source=${directory},target=/run/auracare,readonly`,
      "--mount",
      `type=bind,source=${documents},target=/data/documents`,
      "auracare-phase5:review",
    ],
    { stdio: "pipe" },
  );
  running = true;
  const origin = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${origin}/api/v1/health/ready`, {
        signal: AbortSignal.timeout(1000),
      });
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {
      /* Readiness can fail while the owned container starts; retry the probe. */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!ready) throw new Error("Container readiness did not pass");
  for (const [path, status] of [
    ["/", 200],
    ["/patient-activate", 200],
    ["/api/v1/me", 401],
    ["/api/v1/not-found", 404],
    ["/.env", 404],
  ] as const) {
    const r = await fetch(origin + path);
    if (r.status !== status) throw new Error("Unexpected smoke status");
    if (path === "/" && !(await r.text()).includes("AuraCare"))
      throw new Error("Frontend missing");
  }
  const callback = await fetch(origin + "/api/v1/providers/sandbox/message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (callback.status !== 503)
    throw new Error("Sandbox callback enabled in production");
  const user = execFileSync("docker", ["exec", name, "id", "-u"], {
    encoding: "utf8",
  }).trim();
  if (user === "0") throw new Error("Runtime must not be root");
  execFileSync(
    "docker",
    [
      "exec",
      name,
      "node",
      "--input-type=module",
      "-e",
      "import PDF from 'pdfkit';const d=new PDF();let n=0;d.on('data',b=>n+=b.length);d.on('end',()=>{if(n<1000)process.exitCode=1;});d.font('/app/server/dist/modules/portal/DejaVuSans.ttf').text('Synthetic container font check').end();",
    ],
    { stdio: "pipe" },
  );
  console.log(
    "Deployment smoke passed: nonroot production-mode container, frontend/SPA, database readiness, auth/API/private-file boundaries, disabled sandbox callbacks and PDF font runtime.",
  );
} catch {
  console.error(
    "Deployment smoke failed; no credentials, logs or patient records are included.",
  );
  process.exitCode = 1;
} finally {
  if (running) execFileSync("docker", ["rm", "-f", name], { stdio: "ignore" });
  await mongo.stop();
  await rm(directory, { recursive: true, force: true });
}
