# Working on GitHub - which flow when

> **About this document.** Tilman's quick guide to the GitHub side of the plugin: which button or
> workflow to use for which situation, and what it does. Present tense. Update it in the same
> change that adds or changes a flow. The detailed steps behind each flow are in `RELEASING.md`.

**The idea:** the claude.ai project prepares the work (requirements, design), a cloud session
implements it on its own branch and pushes, GitHub checks and builds every push, Tilman tests the
build on the Supernote and merges. Releases are made from Tilman's computer with
`scripts/release.ps1`.

## Where things are

| Tab on GitHub | What you find there |
|---|---|
| **Code** | the files; the branch menu (top left) to switch or create a branch; `.` opens the browser editor |
| **Pull requests** | one per branch that should go into `main`: its commits, its changes ("Files changed"), its CI result and the merge button |
| **Actions** | every run of every workflow; **beta** is listed on the left, started by hand |
| **Releases** (right column on Code) | releases and betas (pre-releases), each with its `.snplg` |
| **Issues** | bug reports, ideas and questions (forms) |
| **Security** | private vulnerability reports (`SECURITY.md`) |

## I want to ...

### ... start a new feature or fix

1. Prepare in the claude.ai project: requirements, design.
2. Start a cloud session. It creates its own branch (`feature/<name>` or `fix/<issue>-<name>`) and
   pushes to it.
3. Without a cloud session: **Code** → branch menu → type the name → "Create branch … from main".

### ... see what the newest push of a branch contains and test it

Every push is checked and built automatically (workflow **check**, about 15 minutes).

1. **Actions** → the run with the branch name and commit message.
2. The run's summary page shows **"Manuscript <label> - what to test"**: the commits with their
   Device test steps (the newest push marked NEW, commits without steps flagged ⚠) and the new
   CHANGELOG lines.
3. Bottom of the page, **Artifacts**: `manuscript-<label>` - download, unzip, install the `.snplg`
   on the Supernote over the current plugin. The zip also holds `TESTING.md` (the same notes).

A red run: open it, the red step shows the error. Send it to the cloud session. "Re-run failed
jobs" (top right) repeats a run that failed for a passing reason (e.g. a download).

### ... look at the changes of a branch

Open (or create) its **pull request**: GitHub offers "Compare & pull request" after a push, or
**Pull requests** → New → base `main`, compare `<branch>`. Then:

- **Files changed**: every changed line; comment on a line to note something for the cloud session.
- **Commits**: each commit with its message and Device test block.
- **Checks**: the CI result for the newest push.

### ... bring the newest `main` into a branch

On the branch's pull request: **Update branch** (merges `main` into it). Or tell the cloud session:
"merge origin/main into this branch, run the checks, push". Not both at the same time - while a
cloud session is working, let it do it.

### ... make a small change myself without the local setup

Open the repository, switch to the branch, press **`.`** - the browser editor opens. Edit, then
"Commit & Push" in its source-control panel, onto the branch (never onto `main`). CI checks and
builds it like any push.

### ... merge a finished branch into `main`

When the device tests from "what to test" passed and the pull request shows a green check:

1. Pull request → **Merge pull request** → choose **Create a merge commit** (not squash, not
   rebase - they would lose the Device test steps of the single commits) → Confirm.
2. **Delete branch**.
3. The push to `main` is checked and built again; that run is the gate for a release.

Locally the same is `git merge --no-ff` (`RELEASING.md` §2).

### ... let others test the next release (beta)

When the release is complete on `main` and the version being worked on (`nextVersion`) is set:

**Actions** → **beta** → **Run workflow** (branch `main`) → Run workflow. About 20 minutes later
**Releases** has the pre-release "Manuscript x.y.z beta N" with the `.snplg` and `TESTING.md`.
Share its link. Each further run makes the next beta number. Details: `RELEASING.md` §4 "Betas".

### ... set the version being worked on

When work on the next release starts (right after a release), locally on `main`:

```powershell
npm run next-version -- 0.4.0
git commit -am "Set next version 0.4.0" -m "Device test: none - version only."
git push
```

From then on test builds are labelled `0.4.0-alpha+…` and the beta workflow makes betas of 0.4.0.
It refuses a version that is not above the current one. A cloud session working on a branch picks
up the new `nextVersion` the next time it merges `main`.

### ... release

Locally, on `main`, after CI on `main` is green: `./scripts/release.ps1 -DryRun`, then
`./scripts/release.ps1`. It builds, waits for the device check, then pushes and publishes the
release. Answer `N` to stop; it prints the two commands that undo its commit and tag.
Details: `RELEASING.md` §5.

### ... handle a bug report

**Issues** → the report → label `needs-info` or `confirmed` (`RELEASING.md` §7). The fix's commit
or pull request says `Fixes #<number>`; GitHub closes the issue when it reaches `main`.

## What runs by itself

| When | Workflow | What it does |
|---|---|---|
| every push to a branch, every pull request | **check**, job `check` | `npm run check` |
| after that, on a push | **check**, job `build` | builds the `.snplg` (Windows), "what to test" in the summary, artifact for 30 days |
| a tag is pushed | nothing | the release commit was already checked when it reached `main` |

## Words

- **Artifact**: a file a run keeps (30 days for builds); always downloaded as a zip.
- **Pull request**: the proposal to merge a branch into `main`, with its changes and checks.
- **Merge commit**: how a branch joins `main` here; keeps all its commits as they are.
- **Pre-release** (beta): a release on the Releases page that never becomes "Latest".
- **Tag**: a fixed name for one commit, e.g. `v0.3.0` (release) or `v0.3.0-beta.1` (beta).
- **Label** of a build: the version it shows, e.g. `0.3.0-alpha+a1b2c3d` (test build),
  `0.3.0-beta+…` (beta), `0.3.0` (release).
