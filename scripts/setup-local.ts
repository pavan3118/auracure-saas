import { generateKeyPairSync, randomBytes } from "node:crypto";
import {
  mkdirSync,
  existsSync,
  writeFileSync,
  readFileSync,
  appendFileSync,
} from "node:fs";
import { resolve } from "node:path";
const dir = resolve(".local");
mkdirSync(dir, { recursive: true, mode: 0o700 });
if (!existsSync(resolve(dir, "jwt-private.pem"))) {
  const keys = generateKeyPairSync("rsa", {
    modulusLength: 3072,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  writeFileSync(resolve(dir, "jwt-private.pem"), keys.privateKey, {
    mode: 0o600,
    flag: "wx",
  });
  writeFileSync(resolve(dir, "jwt-public.pem"), keys.publicKey, {
    mode: 0o600,
    flag: "wx",
  });
}
if (!existsSync(resolve(dir, "mfa.key")))
  writeFileSync(resolve(dir, "mfa.key"), randomBytes(32), {
    mode: 0o600,
    flag: "wx",
  });
if (!existsSync(resolve(dir, "pin-pepper.key")))
  writeFileSync(resolve(dir, "pin-pepper.key"), randomBytes(32), {
    mode: 0o600,
    flag: "wx",
  });
if (!existsSync(resolve(dir, "development.env")))
  writeFileSync(
    resolve(dir, "development.env"),
    `MONGODB_URI=mongodb://127.0.0.1:27017/auracare_dev?replicaSet=rs0\nAPP_ORIGIN=http://localhost:5173\nPORT=3000\nJWT_PRIVATE_KEY_FILE=${resolve(dir, "jwt-private.pem")}\nJWT_PUBLIC_KEY_FILE=${resolve(dir, "jwt-public.pem")}\nMFA_ENCRYPTION_KEY_FILE=${resolve(dir, "mfa.key")}\nPIN_PEPPER_FILE=${resolve(dir, "pin-pepper.key")}\nMAIL_DIR=${resolve(dir, "mail")}\n`,
    { mode: 0o600, flag: "wx" },
  );
if (
  !readFileSync(resolve(dir, "development.env"), "utf8").includes(
    "PIN_PEPPER_FILE=",
  )
)
  appendFileSync(
    resolve(dir, "development.env"),
    `PIN_PEPPER_FILE=${resolve(dir, "pin-pepper.key")}\n`,
  );
console.log(
  "Local development keys and configuration ready; existing files preserved.",
);
