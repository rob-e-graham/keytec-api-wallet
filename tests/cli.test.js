import test from "node:test";
import assert from "node:assert/strict";
import { maskSecret, normalizeProvider } from "../src/cli.js";

test("normalizes provider names into environment variable keys", () => {
  assert.equal(normalizeProvider("openai"), "OPENAI_API_KEY");
  assert.equal(normalizeProvider("anthropic_api_key"), "ANTHROPIC_API_KEY");
  assert.equal(normalizeProvider("GitHub Token"), "GITHUB_TOKEN");
});

test("masks secrets without exposing the full value", () => {
  assert.equal(maskSecret("short"), "*****");
  assert.equal(maskSecret("sk-1234567890abcdef"), "sk-1***********cdef");
});
