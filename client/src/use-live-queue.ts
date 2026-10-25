import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import { useAuth } from "./auth";
export function useLiveQueue(refresh: () => Promise<void>) {
  const { result } = useAuth();
  const [state, setState] = useState<"connecting" | "live" | "offline">(
    "connecting",
  );
  useEffect(() => {
    if (!result?.access_token) return;
    let disposed = false;
    const socket = io({
      auth: { token: result.access_token },
      transports: ["websocket", "polling"],
    });
    const update = () => {
      void refresh();
    };
    socket.on("connect", () => {
      if (!disposed) {
        setState("live");
        update();
      }
    });
    socket.on("queue.updated", update);
    socket.on("disconnect", () => {
      if (!disposed) setState("offline");
    });
    socket.on("connect_error", () => {
      if (!disposed) setState("offline");
    });
    // HTTP refetch covers a dropped event or a temporary real-time outage.
    const timer = window.setInterval(update, 15000);
    const focus = () => update();
    window.addEventListener("focus", focus);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", focus);
      socket.disconnect();
    };
  }, [result?.access_token, refresh]);
  return state;
}
