import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { prepareTestBinary } from "./test-db.js";
// This smoke test has no caller-supplied database/restore destination and cannot target Atlas.
const mongo = await MongoMemoryReplSet.create({
    binary: prepareTestBinary(),
    replSet: { count: 1 },
  }),
  directory = await mkdtemp(join(tmpdir(), "auracare-backup-smoke-")),
  name = `auracare_test_backup_${randomUUID().replaceAll("-", "")}`,
  restored = name + "_restored";
let connection: mongoose.Connection | undefined;
try {
  connection = await mongoose.createConnection(mongo.getUri(name)).asPromise();
  const collection = connection.collection("synthetic_records");
  await collection.createIndex({ tenant_id: 1, source: 1 }, { unique: true });
  await collection.insertMany([
    { tenant_id: "alpha", source: "synthetic", amountMinor: 11800 },
    { tenant_id: "beta", source: "synthetic", amountMinor: 2900 },
  ]);
  const config = join(directory, "tools.yml"),
    archive = join(directory, "backup.archive"),
    encrypted = join(directory, "backup.enc"),
    recovered = join(directory, "recovered.archive");
  await writeFile(config, `uri: ${JSON.stringify(mongo.getUri(name))}\n`, {
    mode: 0o600,
  });
  execFileSync(
    resolve(".local/mongodb/bin/mongodump"),
    ["--config", config, `--archive=${archive}`, "--gzip"],
    { stdio: "pipe" },
  );
  const secret = randomBytes(32),
    iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", secret, iv),
    plain = await readFile(archive),
    ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  await writeFile(
    encrypted,
    Buffer.concat([iv, cipher.getAuthTag(), ciphertext]),
    { mode: 0o600 },
  );
  await rm(archive);
  const blob = await readFile(encrypted),
    decipher = createDecipheriv("aes-256-gcm", secret, blob.subarray(0, 12));
  decipher.setAuthTag(blob.subarray(12, 28));
  await writeFile(
    recovered,
    Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]),
    { mode: 0o600 },
  );
  execFileSync(
    resolve(".local/mongodb/bin/mongorestore"),
    [
      "--config",
      config,
      `--archive=${recovered}`,
      "--gzip",
      `--nsFrom=${name}.*`,
      `--nsTo=${restored}.*`,
    ],
    { stdio: "pipe" },
  );
  const target = connection.useDb(restored).collection("synthetic_records"),
    rows = await target.find({}).sort({ tenant_id: 1 }).toArray();
  if (
    rows.length !== 2 ||
    rows[0]?.amountMinor !== 11800 ||
    rows[1]?.amountMinor !== 2900
  )
    throw new Error("Restored synthetic values differ");
  const indexes = await target.indexes();
  if (
    !indexes.some(
      (i) => i.unique && i.key.tenant_id === 1 && i.key.source === 1,
    )
  )
    throw new Error("Unique tenant index was not restored");
  // An altered authentication tag must never decrypt.
  const tampered = Buffer.from(blob);
  tampered[12] = tampered[12]! ^ 1;
  const reject = createDecipheriv(
    "aes-256-gcm",
    secret,
    tampered.subarray(0, 12),
  );
  reject.setAuthTag(tampered.subarray(12, 28));
  let rejected = false;
  try {
    reject.update(tampered.subarray(28));
    reject.final();
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("Tampered archive accepted");
  console.log(
    "Backup/restore smoke passed: encrypted archive, two isolated tenant records, amounts, unique tenant index and tamper rejection.",
  );
} catch {
  console.error(
    "Backup/restore smoke failed. No database URI or archive content is included.",
  );
  process.exitCode = 1;
} finally {
  await connection?.close();
  await mongo.stop();
  await rm(directory, { recursive: true, force: true });
}
