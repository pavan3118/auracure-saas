import "dotenv/config";
import { loadConfig } from "./config.js";
import { connect } from "./db.js";
const c = await loadConfig(),
  db = await connect(c.mongoUri);
await db.indexes();
await db.connection.close();
console.log("Database indexes ready.");
