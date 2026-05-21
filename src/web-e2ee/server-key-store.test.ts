import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { loadOrCreateServerKeyPair, serverKeyPath } from "./server-key-store.js";

describe("web-e2ee server key store", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync("/tmp/bryti-web-e2ee-key-");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates a persistent server key on first load and reuses it", async () => {
    const first = await loadOrCreateServerKeyPair(tempDir);
    const second = await loadOrCreateServerKeyPair(tempDir);
    const filePath = serverKeyPath(tempDir);
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as {
      publicKeyJwk: { d?: string };
      privateKeyJwk: { d?: string };
      version: number;
      algorithm: string;
    };

    expect(fs.existsSync(filePath)).toBe(true);
    expect(first.fingerprint).toBe(second.fingerprint);
    expect(raw.version).toBe(1);
    expect(raw.algorithm).toBe("X25519");
    expect(raw.publicKeyJwk.d).toBeUndefined();
    expect(typeof raw.privateKeyJwk.d).toBe("string");
  });

  it("uses restrictive permissions when feasible", async () => {
    await loadOrCreateServerKeyPair(tempDir);

    const dirMode = fs.statSync(path.join(tempDir, "web-e2ee")).mode & 0o777;
    const fileMode = fs.statSync(serverKeyPath(tempDir)).mode & 0o777;

    expect(dirMode).toBe(0o700);
    expect(fileMode).toBe(0o600);
  });

  it("throws clearly on malformed key files", async () => {
    const dir = path.join(tempDir, "web-e2ee");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(serverKeyPath(tempDir), "{bad json", "utf-8");

    await expect(loadOrCreateServerKeyPair(tempDir)).rejects.toThrow(
      "Failed to read web_e2ee server key file",
    );
  });
});
