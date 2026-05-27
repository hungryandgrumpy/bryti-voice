import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cmdWebE2EEInvite } from "./cli.js";
import { invitesPath } from "./web-e2ee/invite-store.js";

describe("CLI web-e2ee invite", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync("/tmp/bryti-cli-web-e2ee-");
    fs.writeFileSync(
      path.join(tempDir, "config.yml"),
      [
        'agent:',
        '  model: "test/local"',
        'telegram:',
        '  token: ""',
        '  allowed_users: []',
        'whatsapp:',
        '  enabled: false',
        '  allowed_users: []',
        'web_e2ee:',
        '  enabled: true',
        '  public_origin: "https://chat.example.test"',
        '  pairing:',
        '    invite_ttl_minutes: 15',
        'models:',
        '  providers:',
        '    - name: "test"',
        '      base_url: "http://127.0.0.1:1234"',
        '      api: "openai"',
        '      api_key: "test-key"',
        '      models: []',
      ].join("\n"),
      "utf-8",
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("prints one plaintext invite code and persists hash-only state", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const created = await cmdWebE2EEInvite(tempDir);
    const output = log.mock.calls.flat().join("\n");
    const rawInvites = fs.readFileSync(invitesPath(tempDir), "utf-8");

    expect(created.code).toMatch(/^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){3}$/);
    expect(output).toContain(created.code);
    expect(output.indexOf(created.code)).toBe(output.lastIndexOf(created.code));
    expect(output).toContain(created.expiresAt);
    expect(fs.existsSync(invitesPath(tempDir))).toBe(true);
    expect(rawInvites).not.toContain(created.code);
    expect(rawInvites).toContain("sha256:");
  });
});
