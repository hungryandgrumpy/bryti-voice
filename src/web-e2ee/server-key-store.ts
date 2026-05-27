import fs from "node:fs";
import path from "node:path";
import {
  exportPrivateKeyJwk,
  exportPublicKeyJwk,
  fingerprintPublicKey,
  generateX25519KeyPair,
  importPrivateKeyJwk,
  importPublicKeyJwk,
} from "./crypto.js";
import type { LoadedServerKeyPair, WebE2EEServerKeyFile } from "./types.js";

function stateDir(dataDir: string): string {
  return path.join(dataDir, "web-e2ee");
}

export function serverKeyPath(dataDir: string): string {
  return path.join(stateDir(dataDir), "server-key.jwk.json");
}

function warnPerm(path_: string, err: unknown): void {
  console.warn(`[web_e2ee] Could not set permissions on ${path_}: ${(err as Error).message}`);
}

function ensureStateDir(dataDir: string): void {
  const dir = stateDir(dataDir);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch (err) {
    warnPerm(dir, err);
  }
}

function writeJsonFile(filePath: string, content: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(content, null, 2), "utf-8");
  try {
    fs.chmodSync(filePath, 0o600);
  } catch (err) {
    warnPerm(filePath, err);
  }
}

function validateServerKeyFile(file: WebE2EEServerKeyFile): void {
  if (file.version !== 1) throw new Error("Unsupported web_e2ee server key file version");
  if (file.algorithm !== "X25519") throw new Error("Unsupported web_e2ee server key algorithm");
  if (!file.publicKeyJwk || !file.privateKeyJwk) {
    throw new Error("web_e2ee server key file is missing key material");
  }
}

export async function loadOrCreateServerKeyPair(dataDir: string): Promise<LoadedServerKeyPair> {
  ensureStateDir(dataDir);
  const filePath = serverKeyPath(dataDir);

  if (!fs.existsSync(filePath)) {
    const pair = await generateX25519KeyPair();
    const publicKeyJwk = await exportPublicKeyJwk(pair.publicKey);
    const privateKeyJwk = await exportPrivateKeyJwk(pair.privateKey);
    const createdAt = new Date().toISOString();
    const file: WebE2EEServerKeyFile = {
      version: 1,
      algorithm: "X25519",
      createdAt,
      publicKeyJwk,
      privateKeyJwk,
    };
    writeJsonFile(filePath, file);
    const fingerprint = await fingerprintPublicKey(pair.publicKey);
    return {
      path: filePath,
      createdAt,
      publicKey: pair.publicKey,
      privateKey: pair.privateKey,
      publicKeyJwk,
      privateKeyJwk,
      fingerprint,
    };
  }

  let parsed: WebE2EEServerKeyFile;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as WebE2EEServerKeyFile;
  } catch (err) {
    throw new Error(`Failed to read web_e2ee server key file: ${(err as Error).message}`);
  }
  validateServerKeyFile(parsed);

  const publicKey = await importPublicKeyJwk(parsed.publicKeyJwk);
  const privateKey = await importPrivateKeyJwk(parsed.privateKeyJwk);
  const fingerprint = await fingerprintPublicKey(publicKey);
  return {
    path: filePath,
    createdAt: parsed.createdAt,
    publicKey,
    privateKey,
    publicKeyJwk: parsed.publicKeyJwk,
    privateKeyJwk: parsed.privateKeyJwk,
    fingerprint,
  };
}
