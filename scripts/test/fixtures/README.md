# Fixtures

`valid/cycle1/foo/` is a minimal passing submission used by the CLI tests
(`test/validate-cli.test.mjs`). The five PNGs are 1×1 transparent images; the
manifest mirrors the portal schema.

## Smoke-running against real PRs

See `docs/superpowers/plans/2026-07-13-submission-ci-validation.md` Task 11:
`gh pr checkout <n>`, then
`CHANGED_PATHS="$(git diff --name-only main...HEAD)" node scripts/validate.mjs structural`.
