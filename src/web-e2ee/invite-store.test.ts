import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import { createInviteStore, invitesPath } from "./invite-store.js";

describe("web-e2ee invite store", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync("/tmp/bryti-web-e2ee-invites-");
  });

  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("persists hashed invites but never plaintext codes", async () => {
    const store = createInviteStore(tempDir);
    const created = await store.create(10);
    const raw = fs.readFileSync(invitesPath(tempDir), "utf-8");

    expect(created.code).toMatch(/^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){3}$/);
    expect(raw).not.toContain(created.code);
    expect(raw).toContain("sha256:");
  });

  it("consumes invites only once", async () => {
    const store = createInviteStore(tempDir);
    const created = await store.create(10);
    const consumed = await store.consume(created.code, "wed_test");

    expect(consumed.status).toBe("used");
    expect(consumed.usedByDeviceId).toBe("wed_test");
    await expect(store.consume(created.code)).rejects.toThrow("already been used");
  });

  it("rejects expired invites", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const store = createInviteStore(tempDir);
    const created = await store.create(1);

    vi.setSystemTime(new Date("2026-01-01T00:02:00.000Z"));
    await expect(store.consume(created.code)).rejects.toThrow("expired");
  });

  it("survives restart with pending invite state", async () => {
    const created = await createInviteStore(tempDir).create(10);
    const reloaded = createInviteStore(tempDir).list();

    expect(reloaded).toHaveLength(1);
    expect(reloaded[0].status).toBe("pending");
    expect(reloaded[0].usedAt).toBeNull();
    expect(reloaded[0].inviteId).toBe(created.inviteId);
  });
});
