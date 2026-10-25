import { mkdir, access } from "node:fs/promises";
import { constants } from "node:fs";
import { Platform } from "./modules/platform/service.js";
import { createServer } from "node:http";
import { QueueEvents } from "./modules/reception/events.js";
import { liveQueue } from "./modules/reception/live.js";
import "dotenv/config";
import { loadConfig } from "./config.js";
import { connect } from "./db.js";
import { mailer, deliverOutbox } from "./mail.js";
import { Identity } from "./auth.js";
import { createApp } from "./app.js";
async function main() {
  const config = await loadConfig(),
    db = await connect(config.mongoUri),
    mail = mailer(config);
  await mkdir(config.documentsDir ?? ".local/documents", {
    recursive: true,
    mode: 0o700,
  });
  await access(
    config.documentsDir ?? ".local/documents",
    constants.R_OK | constants.W_OK,
  );
  const identity = await Identity.create(db, config, mail),
    events = new QueueEvents();
  const app = await createApp(identity, events.publish);
  const server = createServer(app);
  const sockets = liveQueue(server, identity, events);
  server.listen(config.port, "0.0.0.0", () =>
    console.log(`AuraCare API listening on port ${config.port}`),
  );
  const platform = new Platform(identity);
  let platformBusy = false;
  const runPlatform = () => {
    if (platformBusy) return;
    platformBusy = true;
    void platform
      .tick()
      .catch(() =>
        console.error(
          "Usage/provider worker failed; durable records retained.",
        ),
      )
      .finally(() => {
        platformBusy = false;
      });
  };
  runPlatform();
  const platformWorker = setInterval(runPlatform, 15000);
  let busy = false;
  const worker = setInterval(() => {
    if (busy) return;
    busy = true;
    void deliverOutbox(db, config, mail)
      .catch(() =>
        console.error("Mail delivery worker failed; pending items retained."),
      )
      .finally(() => {
        busy = false;
      });
  }, 1000);
  async function stop() {
    clearInterval(worker);
    clearInterval(platformWorker);
    await sockets.close();
    server.close(async () => {
      await db.connection.close();
      process.exit(0);
    });
  }
  server.on("error", () => {
    console.error("API listener failed. Check the configured port.");
    clearInterval(worker);
    clearInterval(platformWorker);
    void db.connection.close().finally(() => {
      process.exitCode = 1;
    });
  });
  process.on("SIGTERM", () => void stop());
  process.on("SIGINT", () => void stop());
}
void main().catch(() => {
  console.error(
    "API startup failed. Check database connectivity, key files and required configuration. No credentials are included in this message.",
  );
  process.exit(1);
});
