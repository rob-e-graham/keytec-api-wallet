# Keytec API Wallet Prototype Build

## Product Summary

Keytec API Wallet is a local-first API credential vault and runtime injection prototype for the FAMTEC/ARCHAI tool ecosystem.

The product goal is simple:

Store once -> attach to a project -> inject at runtime -> never expose

The prototype replaces fragile `.env` workflows with a local keychain-backed CLI and a browser-based operational console.

## Screenshots

The repository includes fresh prototype screenshots in:

```text
docs/screenshots/
```

Desktop dashboard:

![Keytec dashboard desktop](./docs/screenshots/keytec-dashboard-desktop.png)

Token handle table:

![Keytec token handles desktop](./docs/screenshots/keytec-tokens-desktop.png)

Instruction mode:

![Keytec instruction mode](./docs/screenshots/keytec-instruction-mode.png)

Mobile preview:

<img src="./docs/screenshots/keytec-mobile-dashboard.png" alt="Keytec mobile dashboard" width="320">

## Current Prototype State

The build includes:

- Node.js and TypeScript CLI
- macOS Keychain integration through the system `security` command
- Provider token add, get, remove, and masked display flows
- Project profile creation, listing, and provider attachment
- Runtime environment injection through `famtec run <profile> -- <command>`
- GitHub Actions Secrets sync command scaffold
- Local browser dashboard served by `web/server.js`
- macOS app-wrapper build script for `/Users/robgraham/Desktop/APPS/Keytec API Wallet`
- ARCHAI/FAMTEC-style UI shell for the prototype console

## Folder Structure

```text
bin/
  famtec.js
dist/
  cli.js
scripts/
  build_macos_browser_app.sh
  make_icon.py
src/
  cli.ts
  cli.js
tests/
  cli.test.js
web/
  index.html
  server.js
README.md
SECURITY.md
KEYTEC_API_WALLET_BUILD.md
package.json
package-lock.json
tsconfig.json
```

## CLI Commands

### Token Management

```bash
famtec add <provider>
famtec get <provider>
famtec remove <provider>
```

Provider names are normalised into environment variable handles. For example:

```bash
famtec add openai
```

stores the value under:

```text
OPENAI_API_KEY
```

### Project Profiles

```bash
famtec profile create <name>
famtec profile attach <name> <provider>
famtec profile list
```

Profiles are stored as local metadata in:

```text
~/.famtec/profiles.json
```

The file stores provider handles only. It does not store secret values.

### Runtime Injection

```bash
famtec run <profile> -- <command>
```

Example:

```bash
famtec run archai -- npm run dev
```

Execution flow:

1. Read profile handles from local metadata.
2. Load matching secret values from macOS Keychain.
3. Inject values into the child process environment.
4. Run the user command.
5. Let the process exit without writing secrets to disk.

### Debug Environment View

```bash
famtec env <profile>
```

This command shows masked values only.

### GitHub Sync

```bash
famtec github connect
famtec github sync <profile> owner/repo
```

GitHub sync is explicit and manual in the prototype. Nothing leaves the machine unless the user runs the sync command.

## Browser Console

The local dashboard is served by:

```bash
node web/server.js
```

The server exposes:

```text
/health
/api/status
/index.html
```

The dashboard reads local status only. It does not expose secret values.

The UI has been styled to follow the ARCHAI/FAMTEC visual system:

- black infrastructure console
- warm serif headings
- monospaced operational metadata
- thin bordered panels
- muted text hierarchy
- green FAMTEC accent
- cyan runtime/status accents
- no purple product styling
- no rounded SaaS cards

## macOS App Wrapper

The local browser app bundle is generated with:

```bash
./scripts/build_macos_browser_app.sh "/Users/robgraham/Desktop/APPS/Keytec API Wallet"
```

The generated app is:

```text
/Users/robgraham/Desktop/APPS/Keytec API Wallet/Keytec API Wallet.app
```

The app wrapper:

1. Starts the local Node dashboard server on a stable localhost port.
2. Opens Google Chrome in app mode against the local server.
3. Uses a dedicated Chrome profile under `~/Library/Application Support/Keytec API Wallet`.
4. Writes logs to `~/Library/Logs/Keytec API Wallet`.

## Security Model

### Principles

- No plaintext credential storage
- No secret values in the browser UI
- No secret values in profile metadata
- No cloud backend required
- No account required
- Runtime injection only

### macOS Keychain Storage

The prototype stores credentials in macOS Keychain with:

```text
service: famtec
account: <PROVIDER_ENV_HANDLE>
```

Example:

```text
service: famtec
account: OPENAI_API_KEY
```

### Profile Metadata

Profiles map project names to provider handles:

```json
{
  "profiles": {
    "archai": {
      "providers": ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"]
    }
  }
}
```

This metadata is safe to inspect because it contains names only, not credential values.

## OpenClaw Boundary

OpenClaw may support onboarding, documentation, billing, and support flows.

OpenClaw must not:

- read vault contents
- access keychain values
- store API keys
- interact with secret storage

Allowed data:

- sanitised errors
- CLI usage commands
- documentation
- non-secret build logs

## Verification

The prototype currently passes:

```bash
npm run check
```

This runs:

```bash
npm run build
npm test
```

Additional checks used during the prototype pass:

```bash
node -e "const fs=require('fs'); const html=fs.readFileSync('web/index.html','utf8'); const m=html.match(/<script>([\\s\\S]*)<\\/script>/); new Function(m[1]); console.log('script ok')"
plutil -lint "/Users/robgraham/Desktop/APPS/Keytec API Wallet/Keytec API Wallet.app/Contents/Info.plist"
bash -n "/Users/robgraham/Desktop/APPS/Keytec API Wallet/Keytec API Wallet.app/Contents/MacOS/Keytec API Wallet"
```

## Prototype Distribution Target

Primary folder:

```text
/Users/robgraham/Desktop/APPS/Keytec API Wallet
```

Recommended GitHub repository name:

```text
keytec-api-wallet
```

Recommended public description:

```text
Local-first API credential wallet and runtime injection prototype.
```

## MVP Definition

A successful MVP allows a developer to:

1. Add a token once.
2. Create a project profile.
3. Attach the token handle to that profile.
4. Run the project without a `.env` file.

Example:

```bash
famtec add openai
famtec profile create my-app
famtec profile attach my-app openai
famtec run my-app -- npm run dev
```

## Future Work

- Complete GitHub Actions Secrets sync implementation
- Add installer and npm package distribution
- Add pre-commit secret detection
- Add token health monitoring
- Add provider-specific validity checks
- Add team vault design later, without weakening local-first MVP
- Add signed macOS app distribution if the browser wrapper becomes a formal product

## Philosophy

Security tools fail when they add friction.

Keytec succeeds when the secure path is faster than doing the risky thing.
