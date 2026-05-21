// src/web-e2ee/http-server.ts         
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { matchesIndexPath, normalizePathPrefix, prefixedPath } from "./path-utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STATIC_FILES = new Map<string, { file: string; contentType: string }>([
  ["/index.html", { file: "index.html", contentType: "text/html; charset=utf-8" }],
  ["/app.js", { file: "app.js", contentType: "application/javascript; charset=utf-8" }],
  ["/styles.css", { file: "styles.css", contentType: "text/css; charset=utf-8" }],
  ["/manifest.json", { file: "manifest.json", contentType: "application/manifest+json; charset=utf-8" }],
  ["/sw.js", { file: "sw.js", contentType: "application/javascript; charset=utf-8" }],
]);

export interface ServerInfoResponse {
  channel: "web_e2ee";
  protocolVersion: number;
  designVersion: string;
  serverPublicFingerprint: string;
  pathPrefix: string;
  pairingEnabled: boolean;
  encryptedTransport: false;
  chatEnabled: false;
}

export interface WebE2EEHttpServerOptions {
  listenHost: string;
  listenPort: number;
  publicOrigin: string;
  pathPrefix: string;
  serverInfo: ServerInfoResponse;
}

function staticRoot(): string {
  return path.join(__dirname, "static");
}

function websocketConnectSources(publicOrigin: string): string[] {
  try {
    const url = new URL(publicOrigin);
    const wsProtocol = url.protocol === "https:" ? "wss:" : "ws:";
    return [publicOrigin, `${wsProtocol}//${url.host}`];
  } catch {
    return ["'self'"];
  }
}

function securityHeaders(publicOrigin: string): Record<string, string> {
  const connectSrc = ["'self'", ...websocketConnectSources(publicOrigin)].join(" ");
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": [
      "default-src 'self'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
      "form-action 'none'",
      "object-src 'none'",
      `connect-src ${connectSrc}`,
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",
      "manifest-src 'self'",
      "worker-src 'self'",
    ].join("; "),
    "Cache-Control": "no-store",
  };
}

function hasTraversalAttempt(pathname: string): boolean {
  try {
    return decodeURIComponent(pathname).includes("..");
  } catch {
    return true;
  }
}

export class WebE2EEHttpServer {
  private readonly pathPrefix: string;
  private readonly server: http.Server;
  private listening = false;

  constructor(private readonly options: WebE2EEHttpServerOptions) {
    this.pathPrefix = normalizePathPrefix(options.pathPrefix);
    this.server = http.createServer((req, res) => {
      void this.handleRequest(req, res);
    });
  }

  getHttpServer(): http.Server {
    return this.server;
  }

  getBaseUrl(): string {
    const address = this.server.address();
    if (!address || typeof address === "string") {
      return `http://${this.options.listenHost}:${this.options.listenPort}`;
    }
    const host = address.address.includes(":") ? `[${address.address}]` : address.address;
    return `http://${host}:${address.port}`;
  }

  async start(): Promise<void> {
    if (this.listening) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.options.listenPort, this.options.listenHost, () => {
        this.server.off("error", reject);
        this.listening = true;
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.listening) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      this.server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        this.listening = false;
        resolve();
      });
    });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const pathname = url.pathname;

    this.applyHeaders(res);

    if (hasTraversalAttempt(pathname)) {
      this.respondJson(res, 400, { error: "invalid path" });
      return;
    }

    if (method !== "GET") {
      this.respondJson(res, 405, { error: "method not allowed" });
      return;
    }

    if (pathname === prefixedPath(this.pathPrefix, "/api/server-info")) {
      this.respondJson(res, 200, this.options.serverInfo);
      return;
    }

    if (matchesIndexPath(pathname, this.pathPrefix)) {
      if (this.pathPrefix !== "/" && pathname === this.pathPrefix) {
        res.statusCode = 307;
        res.setHeader("Location", `${this.pathPrefix}/`);
        res.end();
        return;
      }
      this.serveStaticFile(res, "/index.html");
      return;
    }

    const prefix = this.pathPrefix === "/" ? "/" : `${this.pathPrefix}/`;
    if (!pathname.startsWith(prefix)) {
      this.respondJson(res, 404, { error: "not found" });
      return;
    }

    const relativePath = this.pathPrefix === "/"
      ? pathname
      : pathname.slice(this.pathPrefix.length);
    this.serveStaticFile(res, relativePath);
  }

  private serveStaticFile(res: http.ServerResponse, requestPath: string): void {
    const entry = STATIC_FILES.get(requestPath);
    if (!entry) {
      this.respondJson(res, 404, { error: "not found" });
      return;
    }

    const filePath = path.join(staticRoot(), entry.file);
    try {
      const content = fs.readFileSync(filePath);
      res.statusCode = 200;
      res.setHeader("Content-Type", entry.contentType);
      if (entry.file === "sw.js") {
        res.setHeader("Service-Worker-Allowed", prefixedPath(this.pathPrefix, "/"));
      }
      res.end(content);
    } catch {
      this.respondJson(res, 500, { error: "static asset unavailable" });
    }
  }

  private applyHeaders(res: http.ServerResponse): void {
    for (const [key, value] of Object.entries(securityHeaders(this.options.publicOrigin))) {
      res.setHeader(key, value);
    }
  }

  private respondJson(res: http.ServerResponse, statusCode: number, payload: unknown): void {
    res.statusCode = statusCode;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(payload));
  }
}
