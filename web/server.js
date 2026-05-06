import { createServer } from "node:http";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir, platform } from "node:os";
import { spawnSync } from "node:child_process";

const root = dirname(fileURLToPath(import.meta.url));
const projectDir = process.env.FAMTEC_PROJECT_DIR || join(root, "..");
const port = Number(process.env.FAMTEC_SERVER_PORT || 48741);
const appName = process.env.FAMTEC_APP_NAME || "Keytec API Wallet";
const keychainReady = platform() === "darwin" && spawnSync("security", ["help"], { encoding: "utf8" }).status === 0;
const KEYCHAIN_SERVICE = "famtec";

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

createServer((request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);

  if (url.pathname === "/health") {
    sendJson(response, { ok: true });
    return;
  }

  if (url.pathname === "/api/status") {
    sendJson(response, getStatus());
    return;
  }

  if (url.pathname === "/api/token" && request.method === "POST") {
    readBody(request, (body) => {
      try {
        const { provider, secret, profile } = JSON.parse(body);
        const key = normalizeProvider(provider);
        if (!secret) return sendError(response, 400, "secret is required");
        const result = spawnSync("security", [
          "add-generic-password", "-U", "-s", KEYCHAIN_SERVICE, "-a", key, "-w", secret
        ], { encoding: "utf8" });
        if (result.status !== 0) return sendError(response, 500, cleanError(result.stderr));
        if (profile) attachProviderToProfile(profile, key);
        sendJson(response, { ok: true, provider: key });
      } catch (err) {
        sendError(response, 400, err.message || "invalid request");
      }
    });
    return;
  }

  if (url.pathname === "/api/token" && request.method === "DELETE") {
    readBody(request, (body) => {
      try {
        const { provider } = JSON.parse(body);
        const key = normalizeProvider(provider);
        spawnSync("security", ["delete-generic-password", "-s", KEYCHAIN_SERVICE, "-a", key], { encoding: "utf8" });
        const data = readProfileStore();
        for (const profile of Object.values(data.profiles)) {
          profile.providers = profile.providers.filter((p) => p !== key);
        }
        writeProfileStore(data);
        sendJson(response, { ok: true });
      } catch (err) {
        sendError(response, 400, err.message || "invalid request");
      }
    });
    return;
  }

  if (url.pathname === "/api/profile" && request.method === "POST") {
    readBody(request, (body) => {
      try {
        const { name } = JSON.parse(body);
        if (!name || !/^[a-zA-Z0-9._-]+$/.test(name)) return sendError(response, 400, "invalid profile name");
        const data = readProfileStore();
        data.profiles[name] ||= { providers: [] };
        writeProfileStore(data);
        sendJson(response, { ok: true, name });
      } catch (err) {
        sendError(response, 400, err.message || "invalid request");
      }
    });
    return;
  }

  if (url.pathname === "/api/profile" && request.method === "DELETE") {
    readBody(request, (body) => {
      try {
        const { name } = JSON.parse(body);
        if (!name) return sendError(response, 400, "name is required");
        const data = readProfileStore();
        delete data.profiles[name];
        writeProfileStore(data);
        sendJson(response, { ok: true });
      } catch (err) {
        sendError(response, 400, err.message || "invalid request");
      }
    });
    return;
  }

  if (url.pathname === "/api/profile/attach" && request.method === "POST") {
    readBody(request, (body) => {
      try {
        const { profile, provider } = JSON.parse(body);
        if (!profile) return sendError(response, 400, "profile is required");
        const key = normalizeProvider(provider);
        attachProviderToProfile(profile, key);
        sendJson(response, { ok: true });
      } catch (err) {
        sendError(response, 400, err.message || "invalid request");
      }
    });
    return;
  }

  const profileEnvMatch = url.pathname.match(/^\/api\/profile\/([^/]+)\/env$/);
  if (profileEnvMatch && request.method === "GET") {
    const name = decodeURIComponent(profileEnvMatch[1]);
    if (!keychainReady) return sendError(response, 503, "keychain not available");
    const data = readProfileStore();
    const profile = data.profiles[name];
    if (!profile) return sendError(response, 404, `profile "${name}" not found`);
    const env = {};
    for (const provider of profile.providers) {
      const result = spawnSync("security", [
        "find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", provider, "-w"
      ], { encoding: "utf8" });
      if (result.status === 0) env[provider] = result.stdout.replace(/\n$/, "");
    }
    sendJson(response, { ok: true, profile: name, env });
    return;
  }

  if (url.pathname === "/api/profile/detach" && request.method === "POST") {
    readBody(request, (body) => {
      try {
        const { profile, provider } = JSON.parse(body);
        const key = normalizeProvider(provider);
        const data = readProfileStore();
        if (data.profiles[profile]) {
          data.profiles[profile].providers = data.profiles[profile].providers.filter((p) => p !== key);
          writeProfileStore(data);
        }
        sendJson(response, { ok: true });
      } catch (err) {
        sendError(response, 400, err.message || "invalid request");
      }
    });
    return;
  }

  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = pathname.replace(/^\/+/, "");
  const filePath = resolve(root, safePath);

  if (filePath !== root && !filePath.startsWith(root + sep)) {
    response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  if (!existsSync(filePath)) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "content-type": contentTypes[extname(filePath)] || "application/octet-stream",
    "cache-control": "no-store"
  });
  response.end(readFileSync(filePath));
}).listen(port, "127.0.0.1", () => {
  console.log(`${appName} dashboard running at http://127.0.0.1:${port}`);
});

function getStatus() {
  const packagePath = join(projectDir, "package.json");
  const profilesPath = getProfilesFile();
  const profiles = readProfiles(profilesPath);
  const tokens = listTokens(profiles);

  return {
    app: appName,
    service: "famtec",
    projectDir,
    platform: platform(),
    version: readPackageVersion(packagePath),
    cliReady: existsSync(join(projectDir, "bin", "famtec.js")),
    keychainReady,
    profilesPath,
    profiles,
    tokens,
    commands: [
      "famtec add together",
      "famtec add deepseek",
      "famtec profile create openclaw",
      "famtec profile attach openclaw together",
      "famtec profile attach openclaw deepseek",
      "famtec list",
      "famtec run openclaw -- npm run dev",
      "famtec github sync openclaw owner/repo"
    ]
  };
}

function readPackageVersion(packagePath) {
  try {
    return JSON.parse(readFileSync(packagePath, "utf8")).version || "0.1.0";
  } catch {
    return "0.1.0";
  }
}

function readProfiles(profilesPath) {
  try {
    const data = JSON.parse(readFileSync(profilesPath, "utf8"));
    return Object.entries(data.profiles || {}).map(([name, profile]) => ({
      name,
      providers: Array.isArray(profile.providers) ? profile.providers : []
    }));
  } catch {
    return [];
  }
}

function listTokens(profiles) {
  const attachedProfiles = new Map();
  for (const profile of profiles) {
    for (const provider of profile.providers) {
      const current = attachedProfiles.get(provider) || [];
      current.push(profile.name);
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

function getConfigDir() {
  return process.env.FAMTEC_HOME || join(homedir(), ".famtec");
}

function getProfilesFile() {
  return join(getConfigDir(), "profiles.json");
}

function readProfileStore() {
  try {
    const data = JSON.parse(readFileSync(getProfilesFile(), "utf8"));
    if (!data || typeof data.profiles !== "object") return { profiles: {} };
    return data;
  } catch {
    return { profiles: {} };
  }
}

function writeProfileStore(data) {
  const file = getProfilesFile();
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
}

function attachProviderToProfile(profileName, provider) {
  const data = readProfileStore();
  data.profiles[profileName] ||= { providers: [] };
  if (!data.profiles[profileName].providers.includes(provider)) {
    data.profiles[profileName].providers.push(provider);
  }
  writeProfileStore(data);
}

function normalizeProvider(provider) {
  const trimmed = String(provider || "").trim();
  if (!trimmed) throw new Error("provider is required");
  const normalized = trimmed.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  const known = new Set(["GITHUB_TOKEN", "TOGETHER_API_KEY", "DEEPSEEK_API_KEY"]);
  return normalized.endsWith("_API_KEY") || known.has(normalized)
    ? normalized
    : `${normalized}_API_KEY`;
}

function cleanError(stderr) {
  return String(stderr || "").trim().replace(/^security: /, "") || "Keychain command failed";
}

function readBody(request, callback) {
  let body = "";
  request.on("data", (chunk) => { body += chunk.toString(); });
  request.on("end", () => callback(body));
}

function sendJson(response, payload) {
  response.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function sendError(response, status, message) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({ ok: false, error: message }));
}
