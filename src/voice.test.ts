import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { VoiceConfig } from "./config.js";
import { CommandVoiceService, VoiceCommandError } from "./voice.js";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bryti-voice-test-"));
}

function baseVoiceConfig(overrides: Partial<VoiceConfig> = {}): VoiceConfig {
  return {
    enabled: true,
    transcribe_command: [],
    synthesize_command: [],
    reply_with_voice: true,
    keep_temp_files: false,
    command_timeout_ms: 1000,
    synthesized_audio_extension: ".ogg",
    max_tts_chars: 2500,
    ...overrides,
  };
}

function voiceTempDir(dataDir: string): string {
  return path.join(dataDir, "files", "voice");
}

function voiceTempFiles(dataDir: string): string[] {
  const dir = voiceTempDir(dataDir);
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
}

describe("CommandVoiceService", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("transcribes audio using the configured command", async () => {
    const tempDir = makeTmpDir();
    tempDirs.push(tempDir);
    const inputPath = path.join(tempDir, "input.ogg");
    fs.writeFileSync(inputPath, "fake audio");

    const service = new CommandVoiceService(tempDir, baseVoiceConfig({
      transcribe_command: [
        process.execPath,
        "-e",
        "const fs=require('node:fs'); fs.writeFileSync(process.argv.at(-1), 'hello transcript');",
        "{input}",
        "--output",
        "{output}",
      ],
    }));

    const transcript = await service.transcribe([{ path: inputPath, mimeType: "audio/ogg" }]);
    expect(transcript).toBe("hello transcript");
  });

  it("synthesizes text into an output audio file", async () => {
    const tempDir = makeTmpDir();
    tempDirs.push(tempDir);

    const service = new CommandVoiceService(tempDir, baseVoiceConfig({
      synthesize_command: [
        process.execPath,
        "-e",
        "const fs=require('node:fs'); const inPath=process.argv[1]; const outPath=process.argv.at(-1); fs.writeFileSync(outPath, fs.readFileSync(inPath, 'utf8'));",
        "{input}",
        "--output",
        "{output}",
      ],
    }));

    const outputPath = await service.synthesize("hello world");
    expect(fs.existsSync(outputPath)).toBe(true);
    expect(fs.readFileSync(outputPath, "utf-8")).toBe("hello world");
  });

  it("removes helper txt temp files when keep_temp_files is false", async () => {
    const tempDir = makeTmpDir();
    tempDirs.push(tempDir);
    const inputPath = path.join(tempDir, "input.ogg");
    fs.writeFileSync(inputPath, "fake audio");

    const service = new CommandVoiceService(tempDir, baseVoiceConfig({
      transcribe_command: [
        process.execPath,
        "-e",
        "const fs=require('node:fs'); fs.writeFileSync(process.argv.at(-1), 'hello transcript');",
        "{input}",
        "--output",
        "{output}",
      ],
      synthesize_command: [
        process.execPath,
        "-e",
        "const fs=require('node:fs'); const inPath=process.argv[1]; const outPath=process.argv.at(-1); fs.writeFileSync(outPath, fs.readFileSync(inPath, 'utf8'));",
        "{input}",
        "--output",
        "{output}",
      ],
    }));

    await expect(service.transcribe([{ path: inputPath, mimeType: "audio/ogg" }])).resolves.toBe("hello transcript");
    const outputPath = await service.synthesize("hello world");

    expect(fs.existsSync(outputPath)).toBe(true);
    expect(voiceTempFiles(tempDir).every((file) => !file.endsWith(".txt"))).toBe(true);
  });

  it("keeps helper txt temp files when keep_temp_files is true", async () => {
    const tempDir = makeTmpDir();
    tempDirs.push(tempDir);
    const inputPath = path.join(tempDir, "input.ogg");
    fs.writeFileSync(inputPath, "fake audio");

    const service = new CommandVoiceService(tempDir, baseVoiceConfig({
      keep_temp_files: true,
      transcribe_command: [
        process.execPath,
        "-e",
        "const fs=require('node:fs'); fs.writeFileSync(process.argv.at(-1), 'hello transcript');",
        "{input}",
        "--output",
        "{output}",
      ],
      synthesize_command: [
        process.execPath,
        "-e",
        "const fs=require('node:fs'); const inPath=process.argv[1]; const outPath=process.argv.at(-1); fs.writeFileSync(outPath, fs.readFileSync(inPath, 'utf8'));",
        "{input}",
        "--output",
        "{output}",
      ],
    }));

    await expect(service.transcribe([{ path: inputPath, mimeType: "audio/ogg" }])).resolves.toBe("hello transcript");
    const outputPath = await service.synthesize("hello world");
    const files = voiceTempFiles(tempDir);

    expect(fs.existsSync(outputPath)).toBe(true);
    expect(files.filter((file) => file.endsWith(".txt"))).toHaveLength(2);
  });

  it("truncates synthesized text to max_tts_chars", async () => {
    const tempDir = makeTmpDir();
    tempDirs.push(tempDir);

    const service = new CommandVoiceService(tempDir, baseVoiceConfig({
      max_tts_chars: 5,
      synthesize_command: [
        process.execPath,
        "-e",
        "const fs=require('node:fs'); const inPath=process.argv[1]; const outPath=process.argv.at(-1); fs.writeFileSync(outPath, fs.readFileSync(inPath, 'utf8'));",
        "{input}",
        "--output",
        "{output}",
      ],
    }));

    const outputPath = await service.synthesize("hello world");
    expect(fs.readFileSync(outputPath, "utf-8")).toBe("hello…");
  });

  it("throws on empty transcription input", async () => {
    const tempDir = makeTmpDir();
    tempDirs.push(tempDir);
    const service = new CommandVoiceService(tempDir, baseVoiceConfig());

    await expect(service.transcribe([])).rejects.toThrow(VoiceCommandError);
  });

  it("times out long-running commands", async () => {
    const tempDir = makeTmpDir();
    tempDirs.push(tempDir);
    const inputPath = path.join(tempDir, "input.ogg");
    fs.writeFileSync(inputPath, "fake audio");

    const service = new CommandVoiceService(tempDir, baseVoiceConfig({
      command_timeout_ms: 50,
      transcribe_command: [
        process.execPath,
        "-e",
        "setTimeout(() => {}, 1000)",
        "{input}",
        "--output",
        "{output}",
      ],
    }));

    await expect(service.transcribe([{ path: inputPath, mimeType: "audio/ogg" }])).rejects.toThrow(/timed out/);
  });
});
