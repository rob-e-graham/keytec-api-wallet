import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProfiles, main, maskSecret, normalizeProvider, saveProfiles } from "../src/cli.js";

async function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "famtec-test-"));
  const previousHome = process.env.FAMTEC_HOME;
  process.env.FAMTEC_HOME = dir;
  try {
    return await fn(dir);
  } finally {
    if (previousHome === undefined) delete process.env.FAMTEC_HOME;
    else process.env.FAMTEC_HOME = previousHome;
    rmSync(dir, { recursive: true, force: true });
  }
}

async function captureConsole(fn) {
  const messages = [];
  const originalLog = console.log;
  console.log = (...args) => {
    messages.push(args.join(" "));
  };
  try {
    await fn();
  } finally {
    console.log = originalLog;
  }
  return messages;
}

// --- normalizeProvider ---

test("normalizes provider names into environment variable keys", () => {
  assert.equal(normalizeProvider("openai"), "OPENAI_API_KEY");
  assert.equal(normalizeProvider("anthropic_api_key"), "ANTHROPIC_API_KEY");
  assert.equal(normalizeProvider("GitHub Token"), "GITHUB_TOKEN");
});

test("normalizes Together AI and DeepSeek to correct key names", () => {
  assert.equal(normalizeProvider("together"), "TOGETHER_API_KEY");
  assert.equal(normalizeProvider("TOGETHER_API_KEY"), "TOGETHER_API_KEY");
  assert.equal(normalizeProvider("deepseek"), "DEEPSEEK_API_KEY");
  assert.equal(normalizeProvider("DEEPSEEK_API_KEY"), "DEEPSEEK_API_KEY");
});

test("throws when provider is empty", () => {
  assert.throws(() => normalizeProvider(""), /provider is required/);
  assert.throws(() => normalizeProvider(undefined), /provider is required/);
  assert.throws(() => normalizeProvider("   "), /provider is required/);
});

// --- maskSecret ---

test("masks secrets without exposing the full value", () => {
  assert.equal(maskSecret("short"), "*****");
  assert.equal(maskSecret("sk-1234567890abcdef"), "sk-1***********cdef");
});

test("returns empty string for empty secret", () => {
  assert.equal(maskSecret(""), "");
});

test("fully masks secrets of 8 chars or fewer", () => {
  assert.equal(maskSecret("12345678"), "********");
});

// --- loadProfiles / saveProfiles ---

test("loadProfiles returns empty store when file does not exist", async () => {
  await withTempDir(() => {
    const data = loadProfiles();
    assert.deepEqual(data, { profiles: {} });
  });
});

test("saveProfiles and loadProfiles round-trip correctly", async () => {
  await withTempDir(() => {
    const data = {
      profiles: {
        openclaw: { providers: ["TOGETHER_API_KEY", "DEEPSEEK_API_KEY"] },
        "my-app": { providers: ["OPENAI_API_KEY"] }
      }
    };
    saveProfiles(data);
    const loaded = loadProfiles();
    assert.deepEqual(loaded, data);
  });
});

test("loadProfiles returns empty store for malformed JSON", async () => {
  await withTempDir((dir) => {
    writeFileSync(join(dir, "profiles.json"), "not-valid-json");
    assert.deepEqual(loadProfiles(), { profiles: {} });
  });
});

test("loadProfiles returns empty store for JSON missing profiles key", async () => {
  await withTempDir((dir) => {
    writeFileSync(join(dir, "profiles.json"), JSON.stringify({ other: {} }));
    const data = loadProfiles();
    assert.deepEqual(data, { profiles: {} });
  });
});

test("loadProfiles sanitizes malformed profile entries", async () => {
  await withTempDir((dir) => {
    writeFileSync(join(dir, "profiles.json"), JSON.stringify({
      profiles: {
        ok: { providers: ["OPENAI_API_KEY", 123, null] },
        broken: { providers: "OPENAI_API_KEY" }
      }
    }));
    assert.deepEqual(loadProfiles(), {
      profiles: {
        ok: { providers: ["OPENAI_API_KEY"] },
        broken: { providers: [] }
      }
    });
  });
});

// --- profile command flows ---

test("main can create and attach a profile", async () => {
  await withTempDir(async () => {
    const messages = await captureConsole(async () => {
      await main(["profile", "create", "openclaw"]);
      await main(["profile", "attach", "openclaw", "together"]);
      await main(["profile", "attach", "openclaw", "deepseek"]);
      await main(["profile", "attach", "openclaw", "deepseek"]);
    });

    assert.deepEqual(loadProfiles(), {
      profiles: {
        openclaw: { providers: ["TOGETHER_API_KEY", "DEEPSEEK_API_KEY"] }
      }
    });
    assert.equal(messages[0], "Created profile openclaw.");
    assert.equal(messages[1], "Attached TOGETHER_API_KEY to openclaw.");
    assert.equal(messages[2], "Attached DEEPSEEK_API_KEY to openclaw.");
  });
});

test("main profile list prints created profiles", async () => {
  await withTempDir(async () => {
    saveProfiles({
      profiles: {
        openclaw: { providers: ["TOGETHER_API_KEY", "DEEPSEEK_API_KEY"] },
        empty: { providers: [] }
      }
    });

    const messages = await captureConsole(async () => {
      await main(["profile", "list"]);
    });

    assert.deepEqual(messages, [
      "empty: no tokens attached",
      "openclaw: TOGETHER_API_KEY, DEEPSEEK_API_KEY"
    ]);
  });
});
