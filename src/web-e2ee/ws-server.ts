// src/web-e2ee/ws-server.ts         
import type http from "node:http";
import type { Socket } from "node:net";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { normalizePathPrefix, prefixedPath } from "./path-utils.js";

export interface WebE2EEWsServerOptions {
  pathPrefix: string;
  allowedOrigins: string[];
}

interface TransportFrame {
  kind?: unknown;
}

export class WebE2EEWsServer {
  private readonly pathPrefix: string;
  private readonly endpointPath: string;
  private readonly allowedOrigins: Set<string>;
  private readonly wss: WebSocketServer;
  private readonly upgradeHandler: (req: http.IncomingMessage, socket: Socket, head: Buffer) => void;

  constructor(server: http.Server, options: WebE2EEWsServerOptions) {
    this.pathPrefix = normalizePathPrefix(options.pathPrefix);
    this.endpointPath = prefixedPath(this.pathPrefix, "/ws");
    this.allowedOrigins = new Set(options.allowedOrigins);
    this.wss = new WebSocketServer({ noServer: true });

    this.wss.on("connection", (socket) => {
      this.sendJson(socket, {
        kind: "hello",
        channel: "web_e2ee",
        encrypted: false,
        chat: false,
      });
      socket.on("message", (data) => {
        this.handleMessage(socket, data);
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

  private handleMessage(socket: WebSocket, data: RawData): void {
    let frame: TransportFrame | null = null;
    try {
      frame = JSON.parse(String(data)) as TransportFrame;
    } catch {
      this.sendJson(socket, { kind: "error", code: "invalid_json" });
      return;
    }

    switch (frame.kind) {
      case "ping":
        this.sendJson(socket, { kind: "pong", channel: "web_e2ee" });
        break;
      case "status":
        this.sendJson(socket, {
          kind: "status",
          channel: "web_e2ee",
          encrypted: false,
          chat: false,
        });
        break;
      default:
        this.sendJson(socket, {
          kind: "error",
          code: "transport_shell_only",
          encrypted: false,
          chat: false,
        });
        break;
    }
  }

  private sendJson(socket: WebSocket, payload: unknown): void {
    socket.send(JSON.stringify(payload));
  }
}
