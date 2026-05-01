import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir, platform } from "node:os";
import { spawnSync } from "node:child_process";

const root = dirname(fileURLToPath(import.meta.url));
const projectDir = process.env.FAMTEC_PROJECT_DIR || join(root, "..", "..");
const port = Number(process.env.FAMTEC_SERVER_PORT || 48741);
const appName = process.env.FAMTEC_APP_NAME || "FAMTEC Token Vault";

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
  const safePath = pathname.replace(/^\/+/, "").replaceAll("..", "");
  const filePath = join(root, safePath);

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
  const profilesPath = join(homedir(), ".famtec", "profiles.json");
  const profiles = readProfiles(profilesPath);
  const securityTool = spawnSync("security", ["help"], { encoding: "utf8" });

  return {
    app: appName,
    service: "famtec",
    projectDir,
    platform: platform(),
    version: readPackageVersion(packagePath),
    cliReady: existsSync(join(projectDir, "bin", "famtec.js")),
    keychainReady: platform() === "darwin" && securityTool.status === 0,
    profilesPath,
    profiles,
    commands: [
      "famtec add openai",
      "famtec profile create my-app",
      "famtec profile attach my-app openai",
      "famtec run my-app -- npm run dev",
      "famtec github sync my-app owner/repo"
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

function sendJson(response, payload) {
  response.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(payload));
}
