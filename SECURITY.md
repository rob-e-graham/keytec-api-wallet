# Security Policy

Keytec API Wallet is designed around local-first secret handling.

## Guarantees In The MVP

- Secret values are stored in macOS Keychain.
- Profile metadata never includes secret values.
- Debug commands mask secret values by default.
- Runtime injection passes secrets only to the child process environment.
- The CLI does not transmit secrets except when the user explicitly runs `famtec github sync`.

## Non-Goals In The MVP

- Shared team vaults.
- Cloud backup.
- Cross-device sync.
- Linux or Windows secure storage.

## Reporting Issues

Please avoid posting real tokens in issues, logs, screenshots, or discussions. If a key may have been exposed, rotate it at the provider immediately.

For private security or licensing contact, email [rob@fineartmedia.tech](mailto:rob@fineartmedia.tech).

Project website: [fineartmedia.tech](https://fineartmedia.tech).
