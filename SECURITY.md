# Security Policy

## Supported Versions

Only the [latest release](https://github.com/trysky1/Cliprename-desktop-public/releases/latest)
is supported. The app updates itself in-app (**Settings → Check for updates**), so
please make sure you are on the latest version before reporting.

## Reporting a Vulnerability

Please report vulnerabilities **privately** via GitHub's
["Report a vulnerability"](https://github.com/trysky1/Cliprename-desktop-public/security/advisories/new)
form. **Do not open a public issue** for security problems.

We will acknowledge your report within 7 days.

## Repository security controls

- CI scans every tracked file and every reachable historical Git blob for common
  credential formats. A clean current checkout is not enough: deleted secrets
  remain downloadable from public history.
- GitHub Actions are pinned to immutable commit SHAs and receive only the
  permissions each workflow needs.
- The private-source clone token is fine-grained, read-only, and is not persisted
  in the runner's Git configuration after checkout.
- Release-management inputs accept only `vMAJOR.MINOR.PATCH` tags before they can
  create, promote, or delete releases.

If a secret is ever committed, immediately revoke or rotate it. Removing the file
or rewriting Git history does not make an already exposed credential safe again.
