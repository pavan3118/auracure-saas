import { EventEmitter } from "node:events";
import type { QueueNotice } from "./service.js";
export class QueueEvents {
  private events = new EventEmitter().setMaxListeners(0);
  publish = (notice: QueueNotice) => {
    this.events.emit("queue", notice);
  };
  subscribe(listener: (notice: QueueNotice) => void) {
    this.events.on("queue", listener);
    return () => this.events.off("queue", listener);
  }
}
