import { expect } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
export async function mailbox(to: string, subject: string) {
  let body = "";
  await expect
    .poll(
      async () => {
        for (const name of await readdir(".local/mail").catch(() => [])) {
          try {
            const item = JSON.parse(
              await readFile(`.local/mail/${name}`, "utf8"),
            ) as { to: string; subject: string; body: string };
            if (item.to === to && item.subject === subject) {
              body = item.body;
              return true;
            }
          } catch {
            /* A concurrent local write can be retried. */
          }
        }
        return false;
      },
      { timeout: 15000 },
    )
    .toBe(true);
  return body;
}
