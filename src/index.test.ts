import { describe, expect, it } from "vitest";
import { formatQueueFullLog } from "./index.js";
import type { IncomingMessage } from "./channels/types.js";

describe("formatQueueFullLog", () => {
  it("redacts web_e2ee plaintext and logs safe metadata only", () => {
    const msg: IncomingMessage = {
      text: "secret web message",
      channelId: "wed_123",
      userId: "wed_123",
      platform: "web_e2ee",
    };

    const parts = formatQueueFullLog(msg);
    expect(parts[0]).toBe("Queue full, rejecting web_e2ee message:");
    expect(JSON.stringify(parts)).not.toContain("secret web message");
    expect(parts[1]).toEqual({
      platform: "web_e2ee",
      channelId: "wed_123",
      userId: "wed_123",
      textLength: 18,
    });
  });

  it("preserves existing plaintext logging for non-web_e2ee platforms", () => {
    const msg: IncomingMessage = {
      text: "telegram text",
      channelId: "123",
      userId: "123",
      platform: "telegram",
    };

    expect(formatQueueFullLog(msg)).toEqual(["Queue full, rejecting message:", "telegram text"]);
  });
});
