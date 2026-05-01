import { spawn, spawnSync } from "node:child_process";
import { constants, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir, platform } from "node:os";
import readline from "node:readline";
import { Writable } from "node:stream";

const KEYCHAIN_SERVICE = "famtec";
const CONFIG_DIR = process.env.FAMTEC_HOME || join(homedir(), ".famtec");
const PROFILES_FILE = join(CONFIG_DIR, "profiles.json");

export async function main(argv) {
  const [command, ...args] = argv;

  switch (command) {
    case "add":
      return addToken(args);
    case "get":
      return getToken(args);
    case "remove":
      return removeToken(args);
    case "profile":
      return profileCommand(args);
    case "run":
      return runProfile(args);
    case "env":
      return printEnv(args);
    case "github":
      return githubCommand(args);
    case "help":
    case "--help":
    case "-h":
    case undefined:
      return printHelp();
    case "version":
    case "--version":
    case "-v":
      return printVersion();
    default:
      throw new Error(`unknown command "${command}". Run "famtec help".`);
  }
}

export function normalizeProvider(provider) {
  const trimmed = provider?.trim();
  if (!trimmed) throw new Error("provider is required");
  const normalized = trimmed.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  return normalized.endsWith("_API_KEY") || normalized === "GITHUB_TOKEN"
    ? normalized
    : `${normalized}_API_KEY`;
}

export function maskSecret(value) {
  if (!value) return "";
  if (value.length <= 8) return "*".repeat(value.length);
  return `${value.slice(0, 4)}${"*".repeat(Math.min(12, value.length - 8))}${value.slice(-4)}`;
}

export function loadProfiles() {
  if (!existsSync(PROFILES_FILE)) return { profiles: {} };
  const parsed = JSON.parse(readFileSync(PROFILES_FILE, "utf8"));
  if (!parsed || typeof parsed !== "object" || !parsed.profiles) return { profiles: {} };
  return parsed;
}

export function saveProfiles(data) {
  mkdirSync(dirname(PROFILES_FILE), { recursive: true, mode: 0o700 });
  writeFileSync(PROFILES_FILE, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
}

async function addToken(args) {
  const provider = normalizeProvider(args[0]);
  const value = process.env.FAMTEC_SECRET || await promptSecret(`Enter ${provider}: `);
  if (!value) throw new Error("secret value cannot be empty");
  await keychainSet(provider, value);
  console.log(`Stored ${provider} in macOS Keychain.`);
}

async function getToken(args) {
  const provider = normalizeProvider(args[0]);
  const value = await keychainGet(provider);
  console.log(args.includes("--show") ? value : `${provider}=${maskSecret(value)}`);
}

async function removeToken(args) {
  const provider = normalizeProvider(args[0]);
  await keychainDelete(provider);
  detachProviderEverywhere(provider);
  console.log(`Removed ${provider}.`);
}

async function profileCommand(args) {
  const [subcommand, ...rest] = args;
  switch (subcommand) {
    case "create":
      return createProfile(rest);
    case "attach":
      return attachProfile(rest);
    case "list":
      return listProfiles();
    default:
      throw new Error("usage: famtec profile <create|attach|list>");
  }
}

function createProfile(args) {
  const name = requireProfileName(args[0]);
  const data = loadProfiles();
  data.profiles[name] ||= { providers: [] };
  saveProfiles(data);
  console.log(`Created profile ${name}.`);
}

function attachProfile(args) {
  const name = requireProfileName(args[0]);
  const provider = normalizeProvider(args[1]);
  const data = loadProfiles();
  data.profiles[name] ||= { providers: [] };
  if (!data.profiles[name].providers.includes(provider)) {
    data.profiles[name].providers.push(provider);
  }
  saveProfiles(data);
  console.log(`Attached ${provider} to ${name}.`);
}

function listProfiles() {
  const entries = Object.entries(loadProfiles().profiles);
  if (entries.length === 0) {
    console.log("No profiles yet.");
    return;
  }
  for (const [name, profile] of entries) {
    const providers = profile.providers.length ? profile.providers.join(", ") : "no tokens attached";
    console.log(`${name}: ${providers}`);
  }
}

async function runProfile(args) {
  const delimiter = args.indexOf("--");
  if (args.length < 2 || delimiter === args.length - 1) {
    throw new Error("usage: famtec run <profile> -- <command>");
  }

  const profileName = requireProfileName(args[0]);
  const commandStart = delimiter === -1 ? 1 : delimiter + 1;
  const command = args[commandStart];
  const commandArgs = args.slice(commandStart + 1);
  const env = await buildProfileEnv(profileName);

  await new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      stdio: "inherit",
      env: { ...process.env, ...env },
      shell: false
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      for (const key of Object.keys(env)) delete env[key];
      if (signal) reject(new Error(`command exited from signal ${signal}`));
      else if (code === 0) resolve();
      else reject(new Error(`command exited with code ${code}`));
    });
  });
}

async function printEnv(args) {
  const profileName = requireProfileName(args[0]);
  const env = await buildProfileEnv(profileName);
  for (const [key, value] of Object.entries(env)) {
    console.log(`${key}=${maskSecret(value)}`);
  }
}

async function githubCommand(args) {
  const [subcommand, ...rest] = args;
  switch (subcommand) {
    case "connect":
      return githubConnect(rest);
    case "sync":
      return githubSync(rest);
    default:
      throw new Error("usage: famtec github <connect|sync>");
  }
}

async function githubConnect(args) {
  const token = process.env.GITHUB_TOKEN || await promptSecret("Enter GitHub token: ");
  if (!token) throw new Error("GitHub token cannot be empty");
  await keychainSet("GITHUB_TOKEN", token);
  console.log("Stored GITHUB_TOKEN in macOS Keychain.");
}

async function githubSync(args) {
  const profileName = requireProfileName(args[0]);
  const repo = args[1];
  if (!repo || !/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    throw new Error("usage: famtec github sync <profile> owner/repo");
  }
  await assertGhAvailable();
  const env = await buildProfileEnv(profileName);
  const githubToken = process.env.GITHUB_TOKEN || await keychainGetOptional("GITHUB_TOKEN");
  if (!githubToken) throw new Error("run famtec github connect or set GITHUB_TOKEN first");

  for (const [name, value] of Object.entries(env)) {
    await ghSecretSet(repo, name, value, githubToken);
    console.log(`Synced ${name} to ${repo}.`);
  }
}

async function buildProfileEnv(profileName) {
  const data = loadProfiles();
  const profile = data.profiles[profileName];
  if (!profile) throw new Error(`profile "${profileName}" does not exist`);
  const env = {};
  for (const provider of profile.providers) {
    env[provider] = await keychainGet(provider);
  }
  return env;
}

async function keychainSet(account, secret) {
  assertMacos();
  const result = spawnSync("security", [
    "add-generic-password",
    "-U",
    "-s",
    KEYCHAIN_SERVICE,
    "-a",
    account,
    "-w",
    secret
  ], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(cleanSecurityError(result.stderr));
}

async function keychainGet(account) {
  assertMacos();
  const result = spawnSync("security", [
    "find-generic-password",
    "-s",
    KEYCHAIN_SERVICE,
    "-a",
    account,
    "-w"
  ], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`missing ${account}; run "famtec add ${account}"`);
  return result.stdout.replace(/\n$/, "");
}

async function keychainGetOptional(account) {
  try {
    return await keychainGet(account);
  } catch {
    return "";
  }
}

async function keychainDelete(account) {
  assertMacos();
  const result = spawnSync("security", [
    "delete-generic-password",
    "-s",
    KEYCHAIN_SERVICE,
    "-a",
    account
  ], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(cleanSecurityError(result.stderr));
}

function detachProviderEverywhere(provider) {
  const data = loadProfiles();
  for (const profile of Object.values(data.profiles)) {
    profile.providers = profile.providers.filter((item) => item !== provider);
  }
  saveProfiles(data);
}

function requireProfileName(name) {
  if (!name || !/^[a-zA-Z0-9._-]+$/.test(name)) {
    throw new Error("profile name must contain only letters, numbers, dots, underscores, or hyphens");
  }
  return name;
}

async function promptSecret(label) {
  if (!process.stdin.isTTY) {
    return readFileSync(0, "utf8").trim();
  }

  const mutableStdout = new WritableMask();
  const rl = readline.createInterface({
    input: process.stdin,
    output: mutableStdout,
    terminal: true
  });

  const answerPromise = new Promise((resolve) => rl.question(label, resolve));
  mutableStdout.muted = true;
  const answer = await answerPromise;
  rl.close();
  process.stdout.write("\n");
  return answer.trim();
}

class WritableMask extends Writable {
  muted = false;

  _write(chunk, _encoding, callback) {
    if (!this.muted) {
      process.stdout.write(chunk.toString());
    }
    callback();
  }
}

async function assertGhAvailable() {
  const result = spawnSync("gh", ["--version"], { encoding: "utf8" });
  if (result.status !== 0) throw new Error("GitHub sync requires the GitHub CLI: https://cli.github.com/");
}

async function ghSecretSet(repo, name, value, githubToken) {
  await new Promise((resolve, reject) => {
    const child = spawn("gh", ["secret", "set", name, "--repo", repo, "--body-file", "-"], {
      stdio: ["pipe", "ignore", "pipe"],
      env: { ...process.env, GH_TOKEN: githubToken }
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `gh secret set failed for ${name}`));
    });
    child.stdin.end(value);
  });
}

function assertMacos() {
  if (platform() !== "darwin") {
    throw new Error("macOS Keychain support is required for this MVP");
  }
}

function cleanSecurityError(stderr) {
  return stderr.trim().replace(/^security: /, "") || "macOS Keychain command failed";
}

function printHelp() {
  console.log(`FAMTEC Token Vault

Usage:
  famtec add <provider>
  famtec get <provider> [--show]
  famtec remove <provider>
  famtec profile create <name>
  famtec profile attach <name> <provider>
  famtec profile list
  famtec run <profile> -- <command>
  famtec env <profile>
  famtec github connect
  famtec github sync <profile> owner/repo

Examples:
  famtec add openai
  famtec profile create my-app
  famtec profile attach my-app openai
  famtec run my-app -- npm run dev`);
}

function printVersion() {
  const packagePath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  console.log(packageJson.version);
}

export async function assertExecutable(path) {
  await access(path, constants.X_OK);
}
