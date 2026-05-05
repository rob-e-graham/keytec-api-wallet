import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir, platform } from "node:os";

const root = dirname(fileURLToPath(import.meta.url));
const projectDir = process.env.FAMTEC_PROJECT_DIR || join(root, "..");
const port = Number(process.env.FAMTEC_SERVER_PORT || 48741);
const appName = process.env.FAMTEC_APP_NAME || "Keytec API Wallet";
const keychainReady = platform() === "darwin";

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

function sendJson(response, payload) {
  response.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(payload));
}
