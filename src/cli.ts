import { spawn, spawnSync } from "node:child_process";
import { constants, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir, platform } from "node:os";
import readline from "node:readline";
import { Writable } from "node:stream";

const KEYCHAIN_SERVICE = "famtec";

type ProfileStore = {
  profiles: Record<string, { providers: string[] }>;
};

type ListedToken = {
  provider: string;
  attachedProfiles: string[];
};

export async function main(argv: string[]): Promise<void> {
  const [command, ...args] = argv;

  switch (command) {
    case "add":
      return addToken(args);
    case "get":
      return getToken(args);
    case "list":
      return listTokens();
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

const KNOWN_TOKEN_NAMES = new Set([
  "GITHUB_TOKEN",
  "TOGETHER_API_KEY",
  "DEEPSEEK_API_KEY"
]);

export function normalizeProvider(provider?: string): string {
  const trimmed = provider?.trim();
  if (!trimmed) throw new Error("provider is required");
  const normalized = trimmed.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  return normalized.endsWith("_API_KEY") || KNOWN_TOKEN_NAMES.has(normalized)
    ? normalized
    : `${normalized}_API_KEY`;
}

export function maskSecret(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "*".repeat(value.length);
  return `${value.slice(0, 4)}${"*".repeat(Math.min(12, value.length - 8))}${value.slice(-4)}`;
}

export function loadProfiles(): ProfileStore {
  const profilesFile = getProfilesFile();
  if (!existsSync(profilesFile)) return { profiles: {} };
  try {
    const parsed = JSON.parse(readFileSync(profilesFile, "utf8")) as unknown;
    return normalizeProfileStore(parsed);
  } catch {
    return { profiles: {} };
  }
}

export function saveProfiles(data: ProfileStore): void {
  const profilesFile = getProfilesFile();
  mkdirSync(dirname(profilesFile), { recursive: true, mode: 0o700 });
  writeFileSync(profilesFile, `${JSON.stringify(normalizeProfileStore(data), null, 2)}\n`, { mode: 0o600 });
}

async function addToken(args: string[]): Promise<void> {
  const provider = normalizeProvider(args[0]);
  const value = process.env.FAMTEC_SECRET || await promptSecret(`Enter ${provider}: `);
  if (!value) throw new Error("secret value cannot be empty");
  keychainSet(provider, value);
  console.log(`Stored ${provider} in macOS Keychain.`);
}

async function getToken(args: string[]): Promise<void> {
  const provider = normalizeProvider(args[0]);
  const value = keychainGet(provider);
  console.log(args.includes("--show") ? value : `${provider}=${maskSecret(value)}`);
}

async function removeToken(args: string[]): Promise<void> {
  const provider = normalizeProvider(args[0]);
  keychainDelete(provider);
  detachProviderEverywhere(provider);
  console.log(`Removed ${provider}.`);
}

function listTokens(): void {
  const tokens = listKnownTokens();
  if (!tokens.length) {
    console.log("No token handles attached to profiles yet. Run: famtec profile attach <name> <provider>");
    return;
  }

  for (const token of tokens) {
    const attached = token.attachedProfiles.length ? token.attachedProfiles.join(", ") : "unattached";
    console.log(`${token.provider}  (${attached}; profile-handle only)`);
  }
}

async function profileCommand(args: string[]): Promise<void> {
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

function createProfile(args: string[]): void {
  const name = requireProfileName(args[0]);
  const data = loadProfiles();
  data.profiles[name] ||= { providers: [] };
  saveProfiles(data);
  console.log(`Created profile ${name}.`);
}

function attachProfile(args: string[]): void {
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

function listProfiles(): void {
  const entries = Object.entries(loadProfiles().profiles).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) {
    console.log("No profiles yet.");
    return;
  }
  for (const [name, profile] of entries) {
    const providers = profile.providers.length ? profile.providers.join(", ") : "no tokens attached";
    console.log(`${name}: ${providers}`);
  }
}

async function runProfile(args: string[]): Promise<void> {
  const delimiter = args.indexOf("--");
  if (args.length < 2 || delimiter === args.length - 1) {
    throw new Error("usage: famtec run <profile> -- <command>");
  }

  const profileName = requireProfileName(args[0]);
  const commandStart = delimiter === -1 ? 1 : delimiter + 1;
  const command = args[commandStart];
  const commandArgs = args.slice(commandStart + 1);
  const env = await buildProfileEnv(profileName);

  await new Promise<void>((resolve, reject) => {
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

async function printEnv(args: string[]): Promise<void> {
  const profileName = requireProfileName(args[0]);
  const env = await buildProfileEnv(profileName);
  for (const [key, value] of Object.entries(env)) {
    console.log(`${key}=${maskSecret(value)}`);
  }
}

async function githubCommand(args: string[]): Promise<void> {
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

async function githubConnect(_args: string[]): Promise<void> {
  const token = process.env.GITHUB_TOKEN || await promptSecret("Enter GitHub token: ");
  if (!token) throw new Error("GitHub token cannot be empty");
  keychainSet("GITHUB_TOKEN", token);
  console.log("Stored GITHUB_TOKEN in macOS Keychain.");
}

async function githubSync(args: string[]): Promise<void> {
  const profileName = requireProfileName(args[0]);
  const repo = args[1];
  if (!repo || !/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    throw new Error("usage: famtec github sync <profile> owner/repo");
  }
  assertGhAvailable();
  const env = await buildProfileEnv(profileName);
  const githubToken = process.env.GITHUB_TOKEN || await keychainGetOptional("GITHUB_TOKEN");
  if (!githubToken) throw new Error("run famtec github connect or set GITHUB_TOKEN first");

  for (const [name, value] of Object.entries(env)) {
    await ghSecretSet(repo, name, value, githubToken);
    console.log(`Synced ${name} to ${repo}.`);
  }
}

async function buildProfileEnv(profileName: string): Promise<Record<string, string>> {
  const data = loadProfiles();
  const profile = data.profiles[profileName];
  if (!profile) throw new Error(`profile "${profileName}" does not exist`);
  const env: Record<string, string> = {};
  for (const provider of profile.providers) {
    env[provider] = keychainGet(provider);
  }
  return env;
}

function keychainSet(account: string, secret: string): void {
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

function keychainGet(account: string): string {
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

async function keychainGetOptional(account: string): Promise<string> {
  try {
    return keychainGet(account);
  } catch {
    return "";
  }
}

function keychainDelete(account: string): void {
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

function detachProviderEverywhere(provider: string): void {
  const data = loadProfiles();
  for (const profile of Object.values(data.profiles)) {
    profile.providers = profile.providers.filter((item) => item !== provider);
  }
  saveProfiles(data);
}

function requireProfileName(name?: string): string {
  if (!name || !/^[a-zA-Z0-9._-]+$/.test(name)) {
    throw new Error("profile name must contain only letters, numbers, dots, underscores, or hyphens");
  }
  return name;
}

async function promptSecret(label: string): Promise<string> {
  if (!process.stdin.isTTY) {
    return readFileSync(0, "utf8").trim();
  }

  const mutableStdout = new WritableMask();
  const rl = readline.createInterface({
    input: process.stdin,
    output: mutableStdout,
    terminal: true
  });

  const answerPromise = new Promise<string>((resolve) => rl.question(label, resolve));
  mutableStdout.muted = true;
  const answer = await answerPromise;
  rl.close();
  process.stdout.write("\n");
  return answer.trim();
}

class WritableMask extends Writable {
  muted = false;

  _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    if (!this.muted) {
      process.stdout.write(chunk.toString());
    }
    callback();
  }
}

function assertGhAvailable(): void {
  const result = spawnSync("gh", ["--version"], { encoding: "utf8" });
  if (result.status !== 0) throw new Error("GitHub sync requires the GitHub CLI: https://cli.github.com/");
}

async function ghSecretSet(repo: string, name: string, value: string, githubToken: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
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

function assertMacos(): void {
  if (platform() !== "darwin") {
    throw new Error("macOS Keychain support is required for this MVP");
  }
}

function cleanSecurityError(stderr: string): string {
  return stderr.trim().replace(/^security: /, "") || "macOS Keychain command failed";
}

function getConfigDir(): string {
  return process.env.FAMTEC_HOME || join(homedir(), ".famtec");
}

function getProfilesFile(): string {
  return join(getConfigDir(), "profiles.json");
}

function normalizeProfileStore(data: unknown): ProfileStore {
  if (!data || typeof data !== "object" || !("profiles" in data)) {
    return { profiles: {} };
  }

  const rawProfiles = (data as { profiles?: unknown }).profiles;
  if (!rawProfiles || typeof rawProfiles !== "object") {
    return { profiles: {} };
  }

  const profiles: Record<string, { providers: string[] }> = {};
  for (const [name, profile] of Object.entries(rawProfiles as Record<string, unknown>)) {
    const rawProviders = (profile as { providers?: unknown })?.providers;
    const providers = Array.isArray(rawProviders)
      ? rawProviders.filter((item): item is string => typeof item === "string")
      : [];
    profiles[name] = { providers };
  }
  return { profiles };
}

function listKnownTokens(): ListedToken[] {
  const data = loadProfiles();
  const attachedProfiles = new Map<string, string[]>();

  for (const [profileName, profile] of Object.entries(data.profiles)) {
    for (const provider of profile.providers) {
      const current = attachedProfiles.get(provider) || [];
      current.push(profileName);
      attachedProfiles.set(provider, current);
    }
  }

  return [...attachedProfiles.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map((provider) => ({
      provider,
      attachedProfiles: [...(attachedProfiles.get(provider) || [])].sort((a, b) => a.localeCompare(b))
    }));
}

function printHelp(): void {
  console.log(`FAMTEC Token Vault

Usage:
  famtec add <provider>
  famtec get <provider> [--show]
  famtec list                      # profile handles only
  famtec remove <provider>
  famtec profile create <name>
  famtec profile attach <name> <provider>
  famtec profile list
  famtec run <profile> -- <command>
  famtec env <profile>
  famtec github connect
  famtec github sync <profile> owner/repo

Providers (examples):
  openai, anthropic, together, deepseek, github

Examples:
  famtec add together
  famtec add deepseek
  famtec profile create openclaw
  famtec profile attach openclaw together
  famtec profile attach openclaw deepseek
  famtec list                      # profile handles only
  famtec run openclaw -- npm run dev`);
}

function printVersion(): void {
  const packagePath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as { version: string };
  console.log(packageJson.version);
}

export async function assertExecutable(path: string): Promise<void> {
  await access(path, constants.X_OK);
}
