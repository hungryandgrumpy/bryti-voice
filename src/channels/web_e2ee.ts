// src/channels/web_e2ee.ts   
import { loadOrCreateServerKeyPair } from "../web-e2ee/server-key-store.js";
import { createDeviceStore } from "../web-e2ee/device-store.js";
import { createInviteStore } from "../web-e2ee/invite-store.js";
import type { ApprovalResult, ChannelBridge, IncomingMessage, SendOpts } from "./types.js";

type MessageHandler = (msg: IncomingMessage) => Promise<void>;

/**
 * Minimal plumbing-only bridge for the future self-hosted web_e2ee channel.
 *
 * Slice 1 intentionally does not implement transport, crypto, pairing, or any
 * browser-facing runtime. Outbound methods fail loudly so startup wiring can be
 * tested without pretending delivery works.
 */
export class WebE2EEBridge implements ChannelBridge {
  readonly name = "web_e2ee";
  readonly platform = "web_e2ee" as const;

  private handler: MessageHandler | null = null;
  private started = false;

  constructor(
    private readonly dataDir: string,
    private readonly config: {
      listen_host: string;
      listen_port: number;
      public_origin: string;
      allowed_origins: string[];
      path_prefix: string;
      pairing: { invite_ttl_minutes: number };
    },
  ) {}

  async start(): Promise<void> {
    const serverKeys = await loadOrCreateServerKeyPair(this.dataDir);
    createDeviceStore(this.dataDir);
    createInviteStore(this.dataDir);
    this.started = true;
    console.log(
      `[web_e2ee] Bridge skeleton started on ${this.config.listen_host}:${this.config.listen_port} ` +
      `(transport not implemented yet, server fingerprint ${serverKeys.fingerprint})`,
    );
  }

  async stop(): Promise<void> {
    this.started = false;
    console.log("[web_e2ee] Bridge skeleton stopped");
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void {
    this.handler = handler;
  }

  async sendMessage(_channelId: string, _text: string, _opts?: SendOpts): Promise<string> {
    this.assertStarted();
    throw new Error("web_e2ee.sendMessage is not implemented yet");
  }

  async editMessage(_channelId: string, _messageId: string, _text: string): Promise<void> {
    this.assertStarted();
    throw new Error("web_e2ee.editMessage is not implemented yet");
  }

  async sendTyping(_channelId: string): Promise<void> {
    this.assertStarted();
    throw new Error("web_e2ee.sendTyping is not implemented yet");
  }

  async sendApprovalRequest(
    _channelId: string,
    _prompt: string,
    _approvalKey: string,
    _timeoutMs?: number,
  ): Promise<ApprovalResult> {
    this.assertStarted();
    throw new Error("web_e2ee.sendApprovalRequest is not implemented yet");
  }

  private assertStarted(): void {
    if (!this.started) {
      throw new Error("web_e2ee bridge not started");
    }
  }
}
