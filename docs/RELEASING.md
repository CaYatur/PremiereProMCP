# Releasing

Releases are automatic: **merging a pull request into `main` publishes a
release.** Nothing is bumped or tagged by hand.

## What a PR needs

1. **A CHANGELOG entry** under `## [Unreleased]` at the top of
   `CHANGELOG.md`. That text becomes the release notes. A release is refused
   if the section is missing or empty.
2. **A bump label** (optional):
   - `release:patch`: the default when no label is set (fixes)
   - `release:minor`: new tools or options
   - `release:major`: breaking changes
   - `no-release`: merge without releasing (docs, CI, chores)

## What happens on merge

`.github/workflows/release.yml` runs on Windows:

1. `scripts/release-prepare.mjs` bumps the version in `package.json`,
   `bridge/`, `server/` and `shared/package.json`, `package-lock.json`,
   `plugin/manifest.json` and `server/src/index.ts`. It turns
   `## [Unreleased]` into `## [x.y.z] — date`, opens a fresh empty
   `[Unreleased]`, adds the tag link, and writes the release notes.
2. `npm run check` runs.
3. A `Release vx.y.z` commit and a `vx.y.z` tag are made.
4. `installer/build-release.ps1` builds `PPMCP-Setup-x.y.z.zip`.
5. The commit and tag are pushed to `main` together (`--atomic`), and a
   GitHub release `PPMCP vx.y.z — <PR title>` is published with the ZIP and
   the notes, marked Latest.

If a step fails, nothing is pushed or published. Fix the cause and re-run the
workflow from the Actions tab.

## Dry run on every PR

While a PR is open, the same workflow runs as **release dry run** on the PR's
merge preview. It bumps the version, runs the checks and builds the ZIP, then
uploads the ZIP as a run artifact instead of pushing or publishing. If the dry
run is green, the merge will release. `npm run check` also runs
`scripts/test-release-prepare.mjs`, which tests the version and CHANGELOG
step on a scratch copy.

## By hand

To preview the changes locally without committing:

```bash
node scripts/release-prepare.mjs --bump minor --notes-out notes.md
git diff
git checkout -- .
```

`npm run release:win` still builds the ZIP from the working tree.
