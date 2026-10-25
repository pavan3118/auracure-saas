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
  const identity = await Identity.create(db, config, mail),
    events = new QueueEvents();
  const app = await createApp(identity, events.publish);
  const server = createServer(app);
  const sockets = liveQueue(server, identity, events);
  server.listen(config.port, "0.0.0.0", () =>
    console.log(`AuraCare API listening on port ${config.port}`),
  );
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
    await sockets.close();
    server.close(async () => {
      await db.connection.close();
      process.exit(0);
    });
  }
  server.on("error", () => {
    console.error("API listener failed. Check the configured port.");
    clearInterval(worker);
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
