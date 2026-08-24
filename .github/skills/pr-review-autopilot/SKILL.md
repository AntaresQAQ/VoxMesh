---
name: pr-review-autopilot
description: "Continuously shepherd a GitHub pull request through Copilot review until stable and clean, then automatically merge it. Use only when the user explicitly authorizes commit, push, and merge for the specified PR while asking for continuous review monitoring, or invokes the skill with those same operation-specific authorizations. Do not trigger for a one-time request to inspect or resolve comments."
---

# PR Review Autopilot

Own one pull request from review through merge for this repository. Continue
looping until the current PR head has completed CI and GitHub Copilot review,
no unresolved or new actionable comments remain, and the PR is merged.

## Authorization

Use this skill only when the user has explicitly authorized each of these
operations for the specified PR:

- edit the PR branch
- run tests, builds, lint, type checks, and E2E checks
- create focused commits
- push the branch
- reply to and resolve review threads
- wait for repeated GitHub Copilot reviews
- merge the PR after the stable-clean gate passes

Naming this skill alone does not override repository rules that require
operation-specific confirmation. The invocation must explicitly authorize
commit, push, and merge for this PR. Otherwise, do not use this skill and do
not infer authorization.

Do not amend, rebase, force-push, or merge a different PR. Follow repository
instructions and any stricter current-session rules. Include repository- or
session-required commit trailers.

## Inputs

Determine from the user request or current branch:

- repository owner/name
- pull request number
- PR head branch and SHA
- base branch
- repository validation command
- repository merge method

If the PR is not explicit, resolve it from the current branch with `gh pr
view`. Stop only if multiple PRs are genuinely ambiguous.

## Core Invariants

1. Never claim completion while a review or required check for the current head
   is pending.
2. Never merge with an unresolved review thread, failing required check,
   conflict, draft state, or blocking review decision.
3. Never treat an old clean review as valid after pushing a new commit. The
   clean review must cover the current head SHA.
4. Inspect review summaries as well as published threads. GitHub Copilot may
   place useful findings under **Suppressed comments** without creating a
   thread.
5. Fix valid findings at the root cause. For incorrect, stale, or conflicting
   findings, reply with concrete evidence before resolving.
6. Preserve user changes and keep fixes scoped to the PR.
7. Use targeted validation while iterating and the repository's full required
   validation before each final push intended for merge.
8. A successful workflow/check run is not proof that no comments were added.
   Always fetch reviews and threads after the Copilot review job completes.

## Tool Strategy

Prefer GitHub MCP reads when available. If an MCP server requires an identity
or permission bootstrap step, use that server's documented context operation.
Otherwise, verify the authenticated CLI identity with `gh auth status`.

For GitHub writes, use GitHub MCP first when available. Enterprise Managed User
tokens may return `403 Unauthorized`; on that exact failure, immediately fall
back to authenticated `gh` commands:

```bash
gh api graphql \
  -f query='mutation($thread:ID!,$body:String!){
    addPullRequestReviewThreadReply(
      input:{pullRequestReviewThreadId:$thread,body:$body}
    ){comment{id}}
  }' \
  -f thread='PRRT_...' \
  -f body='Reply text'

gh api graphql \
  -f query='mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}' \
  -f id='PRRT_...'
```

Use blocking workflow waits instead of manual polling:

```bash
gh pr checks PR --repo OWNER/REPO --watch --interval 10
gh run watch RUN_ID --repo OWNER/REPO --exit-status
```

If a wait exceeds the command timeout, read the same background shell session;
do not restart the command.

## Review-to-Merge State Machine

### 1. Establish the Current Head

Read:

- PR metadata and current head SHA
- mergeability/draft state
- required checks
- review threads
- issue/PR comments
- submitted reviews

Record the head SHA. Every subsequent clean decision applies only to this SHA.

Useful commands:

```bash
gh pr view PR --repo OWNER/REPO \
  --json number,state,isDraft,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,headRefOid,headRefName,baseRefName,url
```

### 2. Collect All Findings

Fetch all pages of:

- unresolved review threads
- regular PR comments
- review decisions
- latest GitHub Copilot review body

Classify each finding:

- valid functional/security/compatibility issue
- test or accessibility gap required by repository rules
- documentation inconsistency
- stale/outdated finding already fixed
- incorrect finding contradicted by current code/tests

Also inspect **Suppressed comments** in the latest Copilot review. Fix valid
suppressed findings proactively; they often become published threads in the
next review.

### 3. Implement Fixes

For valid findings:

- read the affected implementation and related contracts/tests
- make surgical changes
- add focused regression coverage
- update directly related documentation

For stale or incorrect findings:

- verify current code and tests
- prepare a concise evidence-based reply
- do not make a harmful change merely to satisfy the wording

### 4. Validate

Run:

1. focused tests for changed behavior
2. format/lint/type checks covering changed files
3. the repository's full required validation before pushing the review batch

If validation fails:

- fix failures caused by the PR
- investigate pre-existing/infrastructure failures
- retry transient CI/infrastructure failures once
- never resolve a thread or merge while relevant failures remain

### 5. Commit and Push

Create focused English Conventional Commit commits. Include required trailers.
Do not amend or rewrite history.

```bash
git add <scoped-files>
git commit -m "fix: address PR review feedback" \
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>" \
  -m "Copilot-Session: <current-session-id>"
git push
```

Verify local `HEAD` equals the upstream head.

### 6. Reply and Resolve

For every published thread:

1. reply with the fixing commit SHA and concise behavior/test evidence
2. resolve the thread only after the fix is pushed

For a stale or incorrect comment, explain why with current source/test
evidence, then resolve it.

Do not resolve unaddressed human requests for changes.

### 7. Wait for CI and Copilot Re-review

After every push:

1. wait for all required PR checks
2. discover the newest Copilot review workflow for the current branch/head
3. wait for that workflow to complete

Example:

```bash
gh pr checks PR --repo OWNER/REPO --watch --interval 10

HEAD_SHA=$(gh pr view PR --repo OWNER/REPO \
  --json headRefOid --jq .headRefOid)
HEAD_BRANCH=$(gh pr view PR --repo OWNER/REPO \
  --json headRefName --jq .headRefName)

gh run list --repo OWNER/REPO \
  --branch "$HEAD_BRANCH" \
  --commit "$HEAD_SHA" \
  --limit 20 \
  --json databaseId,name,workflowName,status,conclusion,headSha \
  --jq '[.[] |
    select(
      ((.name // "") | ascii_downcase | contains("copilot")) or
      ((.workflowName // "") | ascii_downcase | contains("copilot"))
    )
  ][0]'

gh run watch RUN_ID --repo OWNER/REPO --exit-status
```

If no automatic Copilot review starts for the current head within a reasonable
interval, request one using the GitHub review tool or repository-supported
mechanism, then wait for it.

### 8. Re-read After Review Completion

Only after the Copilot job completes, fetch again:

- review threads
- reviews
- PR comments
- check runs
- current head SHA

If the head changed unexpectedly, restart from step 1.

If any new actionable thread or valid suppressed finding exists, return to step 2. There is no maximum review-round count.

### 9. Stable-Clean Gate

The PR is stable-clean only when all conditions hold for the same current head:

- PR is open and not draft
- merge state is clean/mergeable
- every required CI, E2E, and security check succeeded
- the latest Copilot review workflow completed successfully
- the latest review was submitted against the current head
- no unresolved review threads exist
- no unaddressed regular comments exist
- no valid actionable suppressed comments remain
- local worktree is clean
- local `HEAD` equals upstream

Fetch threads and reviews one final time after all workflows finish. Do not
merge based solely on `gh pr checks`.

### 10. Merge

Use the repository's established merge strategy. If no explicit repository
rule exists, inspect recent main history; prefer squash when merged PRs appear
as one Conventional Commit each.

Immediately before merging, re-read PR metadata and checks. Then merge:

```bash
gh pr merge PR --repo OWNER/REPO --squash \
  --subject "type: concise title (#PR)"
```

Include required merge-message trailers when applicable.

Verify:

```bash
gh pr view PR --repo OWNER/REPO \
  --json state,mergedAt,mergeCommit,url
```

The task is complete only when the PR state is `MERGED`.

## Conflict and Failure Handling

- If the branch is behind but conflict-free, use the repository-supported
  update-branch operation or merge the latest base into the PR branch.
- Never rebase or force-push unless separately authorized.
- If conflicts require semantic decisions, resolve them using repository
  behavior and tests; ask only when no safe interpretation exists.
- If a human reviewer explicitly blocks merge after all automated fixes, stop
  and report the exact blocker.
- If GitHub is unavailable, retain the clean local state and report that merge
  is blocked; do not claim success.

## Completion Report

Report only:

- PR number and URL
- fix commit SHA(s)
- number of resolved threads
- final local/full validation result
- final GitHub CI/Copilot review result
- merge commit SHA

Do not offer optional next steps after a successful merge.
