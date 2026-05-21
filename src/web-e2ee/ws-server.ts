import type http from "node:http";
import type { Socket } from "node:net";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import type { DeviceStore } from "./device-store.js";
import { decryptPayload, deriveDirectionalAesKeys, exportRawPublicKey, importPublicKeyJwk, publicKeyJwkToRawBytes } from "./crypto.js";
import { normalizePathPrefix, prefixedPath } from "./path-utils.js";
import {
  assertValidEncryptedMessageFrame,
  canonicalFrameHeader,
  type DecryptedTextMessageEvent,
} from "./protocol.js";
import type { LoadedServerKeyPair } from "./types.js";

export interface WebE2EEWsServerOptions {
  pathPrefix: string;
  allowedOrigins: string[];
  deviceStore: DeviceStore;
  serverKeys: LoadedServerKeyPair;
  onDecryptedMessage?: (event: DecryptedTextMessageEvent) => Promise<void> | void;
}

interface BasicFrame {
  kind?: unknown;
}

export class WebE2EEWsServer {
  private readonly pathPrefix: string;
  private readonly endpointPath: string;
  private readonly allowedOrigins: Set<string>;
  private readonly wss: WebSocketServer;
  private readonly upgradeHandler: (req: http.IncomingMessage, socket: Socket, head: Buffer) => void;

  constructor(server: http.Server, private readonly options: WebE2EEWsServerOptions) {
    this.pathPrefix = normalizePathPrefix(options.pathPrefix);
    this.endpointPath = prefixedPath(this.pathPrefix, "/ws");
    this.allowedOrigins = new Set(options.allowedOrigins);
    this.wss = new WebSocketServer({ noServer: true });

    this.wss.on("connection", (socket) => {
      this.sendJson(socket, {
        kind: "hello",
        channel: "web_e2ee",
        encrypted: true,
        chat: false,
      });
      socket.on("message", (data) => {
        void this.handleMessage(socket, data);
      });
    });

    this.upgradeHandler = (req, socket, head) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== this.endpointPath) {
        socket.destroy();
        return;
      }

      const origin = req.headers.origin;
      if (origin && !this.allowedOrigins.has(origin)) {
        socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }

      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.wss.emit("connection", ws, req);
      });
    };

    server.on("upgrade", this.upgradeHandler);
  }

  getEndpointPath(): string {
    return this.endpointPath;
  }

  async stop(): Promise<void> {
    for (const client of this.wss.clients) {
      client.close(1001, "server stopping");
    }
    await new Promise<void>((resolve, reject) => {
      this.wss.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }

  detachFrom(server: http.Server): void {
    server.off("upgrade", this.upgradeHandler);
  }

  private async handleMessage(socket: WebSocket, data: RawData): Promise<void> {
    let frame: unknown;
    try {
      frame = JSON.parse(String(data));
    } catch {
      this.sendJson(socket, { kind: "error", code: "invalid_json" });
      return;
    }

    const basic = frame as BasicFrame;
    switch (basic.kind) {
      case "ping":
        this.sendJson(socket, { kind: "pong", channel: "web_e2ee" });
        return;
      case "status":
        this.sendJson(socket, {
          kind: "status",
          channel: "web_e2ee",
          encrypted: true,
          chat: false,
        });
        return;
      case "msg":
        await this.handleEncryptedMessage(socket, frame);
        return;
      default:
        this.sendJson(socket, { kind: "error", code: "invalid_frame" });
        return;
    }
  }

  private async handleEncryptedMessage(socket: WebSocket, frameValue: unknown): Promise<void> {
    let frame;
    try {
      frame = assertValidEncryptedMessageFrame(frameValue);
    } catch {
      this.sendJson(socket, { kind: "error", code: "invalid_frame" });
      return;
    }

    const device = this.options.deviceStore.get(frame.deviceId);
    if (!device) {
      this.sendJson(socket, { kind: "error", code: "unknown_device" });
      return;
    }
    if (device.status !== "active") {
      this.sendJson(socket, { kind: "error", code: "revoked_device" });
      return;
    }
    if (frame.counter <= device.lastInboundCounter) {
      this.sendJson(socket, { kind: "error", code: "replay_detected" });
      return;
    }

    let payload;
    try {
      const devicePublicKey = await importPublicKeyJwk(device.publicKeyJwk);
      const serverPublicKeyRaw = await exportRawPublicKey(this.options.serverKeys.publicKey);
      const devicePublicKeyRaw = publicKeyJwkToRawBytes(device.publicKeyJwk);
      const { c2sKey } = await deriveDirectionalAesKeys(
        this.options.serverKeys.privateKey,
        devicePublicKey,
        serverPublicKeyRaw,
        devicePublicKeyRaw,
      );
      payload = await decryptPayload(c2sKey, canonicalFrameHeader(frame), frame.ciphertext);
    } catch {
      this.sendJson(socket, { kind: "error", code: "decrypt_failed" });
      return;
    }

    this.options.deviceStore.updateLastInboundCounter(frame.deviceId, frame.counter, new Date().toISOString());
    try {
      await this.options.onDecryptedMessage?.({
        deviceId: frame.deviceId,
        messageId: frame.messageId,
        counter: frame.counter,
        ts: frame.ts,
        payload,
        raw: {
          type: "web_e2ee_encrypted_msg",
          deviceId: frame.deviceId,
          messageId: frame.messageId,
          counter: frame.counter,
          ts: frame.ts,
          kind: "msg",
          nonceLength: frame.nonce.length,
          ciphertextLength: frame.ciphertext.length,
        },
      });
    } catch {
      this.sendJson(socket, { kind: "error", code: "handler_failed" });
    }
  }

  private sendJson(socket: WebSocket, payload: unknown): void {
    socket.send(JSON.stringify(payload));
  }
}
