import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withDurableOutbound } from "./outbound-queue.js";
import type { ApprovalResult, ChannelBridge, IncomingMessage, Platform, SendOpts } from "./types.js";

class FakeBridge implements ChannelBridge {
  readonly name = "fake";
  readonly platform: Platform = "telegram";
  sent: Array<{ channelId: string; text: string; opts?: SendOpts }> = [];
  failNext = false;

  async start() {}
  async stop() {}
  onMessage(_handler: (msg: IncomingMessage) => Promise<void>) {}
  async editMessage() {}
  async sendTyping() {}
  async sendApprovalRequest(): Promise<ApprovalResult> { return "deny"; }

  async sendMessage(channelId: string, text: string, opts?: SendOpts): Promise<string> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("network down");
    }
    this.sent.push({ channelId, text, opts });
    return String(this.sent.length);
  }
}

describe("DurableOutboundBridge", () => {
  let tmpDir: string | null = null;

  afterEach(() => {
    vi.useRealTimers();
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  });

  function make() {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bryti-outbound-test-"));
    const inner = new FakeBridge();
    return { inner, bridge: withDurableOutbound(inner, tmpDir) };
  }

  function queuedFiles(): string[] {
    const dir = path.join(tmpDir!, "pending", "outbound", "telegram");
    return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")) : [];
  }

  it("removes the queued record after a successful send", async () => {
    const { bridge } = make();
    await bridge.start();
    await bridge.sendMessage("123", "hello");

    expect(queuedFiles()).toEqual([]);
    await bridge.stop();
  });

  it("keeps the queued record when delivery fails", async () => {
    const { inner, bridge } = make();
    await bridge.start();
    inner.failNext = true;

    await expect(bridge.sendMessage("123", "hello")).rejects.toThrow("network down");

    expect(queuedFiles()).toHaveLength(1);
    await bridge.stop();
  });

  it("drains queued records on start", async () => {
    const { inner, bridge } = make();
    await bridge.start();
    inner.failNext = true;
    await expect(bridge.sendMessage("123", "hello")).rejects.toThrow("network down");
    await bridge.stop();

    const restarted = withDurableOutbound(inner, tmpDir!);
    await restarted.start();

    expect(inner.sent.some((msg) => msg.text === "hello")).toBe(true);
    expect(queuedFiles()).toEqual([]);
    await restarted.stop();
  });
});
