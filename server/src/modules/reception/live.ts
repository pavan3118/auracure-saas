import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { decodeJwt } from "jose";
import type { Identity } from "../../auth.js";
import { check } from "../../types.js";
import type { QueueEvents } from "./events.js";
export function liveQueue(
  http: HttpServer,
  identity: Identity,
  events: QueueEvents,
) {
  const io = new Server(http, {
    cors: { origin: identity.config.origin, credentials: true },
    maxHttpBufferSize: 4096,
    serveClient: false,
  });
  io.use(async (socket, next) => {
    try {
      check(
        socket.handshake.headers.origin === identity.config.origin,
        403,
        "FORBIDDEN",
      );
      const raw: unknown = socket.handshake.auth.token;
      check(
        typeof raw === "string" && raw.length <= 8192,
        401,
        "AUTH_REQUIRED",
      );
      const { principal: p } = await identity.authenticate(raw);
      check(
        p.purpose === "access" &&
          ["RECEPTIONIST", "OWNER", "DOCTOR"].includes(p.role),
        403,
        "FORBIDDEN",
      );
      socket.data.principal = p;
      socket.data.token = raw;
      next();
    } catch {
      next(new Error("Authentication required."));
    }
  });
  io.on("connection", (socket) => {
    const raw = socket.data.token as string;
    const expiry = decodeJwt(raw).exp!;
    const expires = setTimeout(
      () => socket.disconnect(true),
      Math.max(0, expiry * 1000 - Date.now()),
    );
    let checking = false;
    const validate = async () => {
      if (checking) return;
      checking = true;
      try {
        await identity.authenticate(raw);
      } catch {
        socket.disconnect(true);
      } finally {
        checking = false;
      }
    };
    const timer = setInterval(() => {
      void validate();
    }, 5000);
    // Subscribers get no names, contact information, vitals or client-selected tenant room.
    const unsubscribe = events.subscribe((notice) => {
      if (notice.tenantId !== socket.data.principal.tenantId) return;
      void identity
        .authenticate(raw)
        .then(() => {
          if (socket.connected)
            socket.emit("queue.updated", {
              visit_id: notice.visitId,
              state: notice.state,
              version: notice.version,
            });
        })
        .catch(() => socket.disconnect(true));
    });
    socket.on("disconnect", () => {
      clearTimeout(expires);
      clearInterval(timer);
      unsubscribe();
    });
  });
  return io;
}
