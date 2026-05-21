import fs from "node:fs";
import path from "node:path";
import { generateInviteCode, generateInviteId, hashInviteCode } from "./crypto.js";
import type { PairingInviteRecord, PairingInvitesFile } from "./types.js";

function stateDir(dataDir: string): string {
  return path.join(dataDir, "web-e2ee");
}

export function invitesPath(dataDir: string): string {
  return path.join(stateDir(dataDir), "invites.json");
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

function saveFile(filePath: string, data: PairingInvitesFile): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  try {
    fs.chmodSync(filePath, 0o600);
  } catch (err) {
    warnPerm(filePath, err);
  }
}

function loadFile(filePath: string): PairingInvitesFile {
  if (!fs.existsSync(filePath)) {
    return { version: 1, invites: [] };
  }
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as PairingInvitesFile;
  if (parsed.version !== 1 || !Array.isArray(parsed.invites)) {
    throw new Error("Invalid web_e2ee invites file");
  }
  return parsed;
}

function nowIso(): string {
  return new Date().toISOString();
}

function markExpired(invite: PairingInviteRecord, now = nowIso()): void {
  if (invite.status === "pending" && invite.expiresAt <= now) {
    invite.status = "expired";
  }
}

export interface InviteStore {
  list(): PairingInviteRecord[];
  create(ttlMinutes: number): Promise<{ inviteId: string; code: string; expiresAt: string }>;
  consume(code: string, usedByDeviceId?: string): Promise<PairingInviteRecord>;
}

export function createInviteStore(dataDir: string): InviteStore {
  ensureStateDir(dataDir);
  const filePath = invitesPath(dataDir);

  function pruneAndLoad(): PairingInvitesFile {
    const file = loadFile(filePath);
    const now = nowIso();
    let changed = false;
    for (const invite of file.invites) {
      const before = invite.status;
      markExpired(invite, now);
      if (invite.status !== before) changed = true;
    }
    if (changed || !fs.existsSync(filePath)) {
      saveFile(filePath, file);
    }
    return file;
  }

  return {
    list(): PairingInviteRecord[] {
      return pruneAndLoad().invites;
    },

    async create(ttlMinutes: number): Promise<{ inviteId: string; code: string; expiresAt: string }> {
      if (ttlMinutes <= 0) {
        throw new Error("Invite TTL must be greater than 0 minutes");
      }
      const file = pruneAndLoad();
      const code = generateInviteCode();
      const codeHash = await hashInviteCode(code);
      const createdAt = nowIso();
      const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
      const inviteId = generateInviteId();
      file.invites.push({
        inviteId,
        codeHash,
        createdAt,
        expiresAt,
        usedAt: null,
        usedByDeviceId: null,
        status: "pending",
      });
      saveFile(filePath, file);
      return { inviteId, code, expiresAt };
    },

    async consume(code: string, usedByDeviceId: string | null = null): Promise<PairingInviteRecord> {
      const file = pruneAndLoad();
      const codeHash = await hashInviteCode(code);
      const invite = file.invites.find((entry) => entry.codeHash === codeHash);
      if (!invite) {
        throw new Error("Invalid pairing invite code");
      }
      const now = nowIso();
      markExpired(invite, now);
      if (invite.status === "expired") {
        saveFile(filePath, file);
        throw new Error("Pairing invite has expired");
      }
      if (invite.usedAt) {
        throw new Error("Pairing invite has already been used");
      }
      invite.usedAt = now;
      invite.usedByDeviceId = usedByDeviceId;
      invite.status = "used";
      saveFile(filePath, file);
      return invite;
    },
  };
}
