# Security Operations

[Documentation Index](../README.md)

This document describes repository security automation and alert handling for
VoxMesh.

## GitHub Security Services

The repository enables:

- CodeQL default setup with the Extended query suite
- JavaScript, TypeScript, and GitHub Actions analysis
- Dependabot vulnerability alerts and security update pull requests
- secret scanning
- secret scanning push protection

GitHub features that are unavailable for the current repository or account tier
must not be represented as enabled.

## GitHub Actions Hardening

Every workflow must:

- declare the minimum required `GITHUB_TOKEN` permissions
- pin third-party and GitHub-authored actions to full commit SHAs
- include the corresponding release tag in a comment for maintainability
- avoid exposing provider credentials to pull request workflows

Before updating a pinned action, resolve the intended signed release tag to its
current commit, review the upstream release, update the SHA and tag comment
together, and validate the workflow through a pull request.

The repository should enable mandatory SHA pinning only after every workflow on
the default branch uses full commit SHAs. Enabling the policy before that
migration would prevent the remediation workflow itself from running.

## Dependency Alert Triage

Every Dependabot alert must be reviewed against both the dependency graph and
the actual application call path.

- Upgrade dependencies when a maintained compatible release is available.
- Dismiss only when the vulnerable feature is demonstrably not used, the alert
  is inaccurate, or an explicitly accepted risk is documented.
- Use GitHub's structured dismissal reason and include concrete reachability
  evidence.
- Do not dismiss an alert solely because exploitation is inconvenient.

`esbuild` is transitive build tooling in VoxMesh. The application does not call
the affected esbuild development-server `serve` API; Vite and tsup are invoked
through their documented commands. The corresponding low-severity alert may be
dismissed as unused unless that direct API is introduced.

## Secret Handling

Provider API keys must never be committed. Secret scanning and push protection
supplement, but do not replace:

- write-only configuration APIs
- log and diagnostics redaction
- local database and backup protection
- review of generated files and test fixtures

Any secret alert requires immediate credential revocation or rotation before
repository cleanup. Rewriting Git history alone does not invalidate an exposed
credential.

## Validation

Security remediation pull requests must run:

- repository formatting and workflow syntax checks
- applicable unit and integration tests
- production builds
- browser end-to-end tests
- CodeQL and Dependabot checks on GitHub

After merge, confirm the associated alerts are closed and enable any repository
policy that depended on the remediation, such as mandatory action SHA pinning.
