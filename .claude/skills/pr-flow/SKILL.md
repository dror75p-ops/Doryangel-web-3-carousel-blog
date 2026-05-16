---
name: pr-flow
description: Encodes the DoryAngel branch-and-PR workflow — create branch `claude/<short-desc>`, push, open a PR via gh, hand the PR URL back to the user, wait for merge. Use when the user says "open a PR", "ship it", "commit and push this", or after any non-trivial change is staged. Skip for trivial one-line tweaks ONLY if the user explicitly says "just push it".
---

# pr-flow

You are a senior release engineer who enforces this repo's branch-and-PR policy without exception. Your job is to take a staged or just-completed change and ship it through the DoryAngel-standard flow: feature branch → commits → PR → hand URL back to the user → wait for merge.

## When this applies

ALWAYS use PR flow for:
- Any change touching `index.html` UI, styles, copy, or layout
- Any change touching `scripts/*.js`, `.github/workflows/*.yml`, `content/blog/posts-index.json`
- Any new file or directory
- Any change to skills, settings, or `.claude/` config
- Anything the user describes as "feature", "fix a bug", "redesign", "add"

## Exceptions (direct-to-main allowed)

1. **Trivial one-line tweak** AND the user explicitly said "just push it" or "push straight to main". Examples: fixing a typo, bumping a date string. If they did not say it, DO NOT skip the PR flow.
2. **Auto-publish bot commits** via `.github/workflows/blog-autopublish.yml` and `refresh-images.yml`. Those run on their own and commit to main as the DoryAngel Bot — never override them.

If unsure, use PR flow.

## Branch naming

`claude/<short-kebab-description>`

Examples:
- `claude/add-localbusiness-jsonld`
- `claude/fix-seo-title-suffix`
- `claude/retell-payload-debug`

Keep under ~40 chars. Lowercase, kebab-case, no spaces, no special characters.

## Procedure

1. **Confirm scope.** State to the user what you are about to ship — one sentence — and on what branch. Do NOT push without that line.

2. **Create or switch to the branch.**
   ```bash
   git checkout -b claude/<desc>   # or: git checkout claude/<desc>
   ```

3. **Stage only relevant files.** Never `git add -A` or `git add .` without naming the paths. Avoid `.env`, credentials, large binaries.

4. **Commit.** Follow the repo's existing commit-message style (see recent `git log` for tone — short imperative subject, optional body explaining "why"). End the message with the session URL line per the harness convention.

5. **Push with `-u`.**
   ```bash
   git push -u origin claude/<desc>
   ```
   On network error, retry up to 4 times with exponential backoff (2s, 4s, 8s, 16s). Never use `--force` unless the user has explicitly asked AND the branch is your own feature branch (NEVER force-push to main).

6. **Open the PR via GitHub MCP** (`mcp__github__create_pull_request`). Do NOT use `gh` CLI — it is not available in this environment. PR body template:

   ```markdown
   ## Summary
   - <bullet 1>
   - <bullet 2>

   ## Test plan
   - [ ] <how to verify in a browser / locally>
   - [ ] <regression check>

   <session URL>
   ```

7. **Hand the PR URL back to the user** in this exact form:
   > PR opened: <URL> — review on mobile and merge when ready.

8. **Wait.** Do not push more commits to the same branch unless the user asks. Do not open additional PRs. Do not create new files outside scope.

## Do NOT

- Force-push to `main` or any shared branch (warn the user if asked).
- Edit `git config`.
- Use `--no-verify`, `--no-gpg-sign`, or skip hooks.
- Amend a commit after a pre-commit hook fails — create a NEW commit with the fix instead.
- Open a PR without confirming the change scope with the user first.
- Use `gh` CLI — this environment does not have it. Use `mcp__github__*` tools.

## After merge

The user will merge in the GitHub mobile app. Once merged:
- Confirm completion with one short sentence.
- Do not delete the branch yourself unless the user asks.
- If a follow-up is needed, start a new `claude/<desc>` branch — do not reuse merged branches.

## References

- `/home/user/Doryangel-web-3-carousel-blog/CLAUDE.md` — section "Workflow rules"
- `git log --oneline -20` — current commit style examples
