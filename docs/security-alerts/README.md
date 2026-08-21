# Vulnerability alerts in Telegram

GitHub Dependabot watches the dependencies and the
`.github/workflows/security-alerts.yml` workflow posts what it finds to a
Telegram channel:

- daily — only what appeared in the last 24 hours
- Mondays — the full list of open alerts

When there is nothing to report the workflow stays silent.

This repository is consumed by `FullSail-Frontend` as a git dependency:

```
"@fullsailfinance/switchboard-sui-sdk-v2": "git+https://github.com/LFBuild/switchboard-sui.git#main"
```

Dependabot **does not scan** git dependencies — there is no registry package to
attach an advisory to. Vulnerabilities in this fork are therefore invisible to
the audit run in `FullSail-Frontend`, which is why they have to be watched here.

---

## Setup

Four steps, all in the web UI — nothing to change in the repository.

### 1. Enable Dependabot

`Settings → Code security` → enable **Dependency graph** and **Dependabot alerts**.

Give it 5–10 minutes for the initial scan, then check `Security → Dependabot`.

### 2. Create the bot and the channel

If alerts for other repositories are already set up, the same bot and channel can
be reused — every message names the repository it came from. In that case skip
this step and go straight to the secrets.

1. In Telegram: **@BotFather** → `/newbot` → keep the token

2. Create a channel and add the bot as an **administrator** with the
   **Manage posts** and **Channel message access** rights

3. Find the `chat_id`:

   **3.1.** Post any message in the channel — it must happen **after** the bot
   was added. Updates are not backfilled, so a message sent earlier will not
   reveal the `chat_id`.

   **3.2.** Open `https://api.telegram.org/bot<TOKEN>/getUpdates`

   **3.3.** Take `channel_post.chat.id` from the response — it looks like `-100…`
   If the response is empty, post again: updates are kept for 24 hours.

Check that the bot can post:

```bash
curl -s "https://api.telegram.org/bot<TOKEN>/sendMessage" \
  -d chat_id="<CHAT_ID>" -d text="test"
```

`{"ok":true,…}` means everything is wired up.

### 3. Create a token for reading alerts

The built-in `GITHUB_TOKEN` **has no access** to Dependabot alerts and answers
`403 Resource not accessible by integration`. A personal token is required.

`Settings → Developer settings → Personal access tokens → Fine-grained tokens`:

| Field | Value |
| --- | --- |
| Resource owner | `LFBuild` |
| Repository access | Only select repositories → `switchboard-sui` |
| Repository permissions | **Dependabot alerts: Read-only** — and nothing else |
| Expiration | up to a year |

A token issued for another repository will not work: fine-grained tokens are
bound to an explicit repository list.

### 4. Add the secrets

`Settings → Secrets and variables → Actions` → **Repository secrets**:

| Secret | Value |
| --- | --- |
| `AUDIT_ALERTS_BOT_TOKEN` | bot token from @BotFather |
| `AUDIT_ALERTS_CHAT_ID` | channel id, looks like `-100…` |
| `AUDIT_ALERTS_GH_TOKEN` | fine-grained token from step 3 |

**Repository** secrets, not Environment ones: environment secrets require the job
to declare `environment:`, which this workflow has no use for.

---

## Verifying

`Actions → Security alerts → Run workflow` with **Report every open alert**
checked — the full list arrives without waiting for new findings.

Every step is visible in the log: how many alerts were fetched, which mode the
message was built in and what Telegram answered.

⚠️ Scheduled runs only happen **on the default branch** — that is a GitHub rule,
not a setting. Until the workflow is merged into `main` the cron will never fire
and the only way to run it is manually.

---

## How it works

### Schedule

| When | What it sends |
| --- | --- |
| Daily 07:00 UTC | only alerts created in the last 24 hours |
| Monday 08:00 UTC | the full list of open alerts |
| Manual | full list or new only, depending on the checkbox |

With nothing to report the workflow finishes green and sends nothing. That is
deliberate: a daily "no vulnerabilities found" stops being read within a week.

Mondays get both messages — the daily one and the digest. If that is noisy, drop
the daily cron or move the digest to another day.

### Message format

```
Open vulnerabilities — LFBuild/switchboard-sui
5 in 3 packages · high 3 · moderate 1 · low 1

🟠 axios — 3 advisories
   axios prototype pollution in HTTP adapter and more
   https://github.com/advisories/GHSA-…

🟡 uuid
   uuid has predictable results when given a non-cryptographic RNG
   https://github.com/advisories/GHSA-…

The remaining vulnerabilities are listed here:
https://github.com/LFBuild/switchboard-sui/security/dependabot
```

- **Grouped by package.** One vulnerable version can carry dozens of advisories.
  Without grouping the channel would be flooded.
- **At most five packages** plus a link to the full list, so the message length
  stays predictable no matter how many findings there are.
- **Summaries are cut at 150 characters.** GitHub allows up to 1024 and Telegram
  rejects messages longer than 4096 — without the cut a notification would
  eventually fail to send at all.
- **The `(dev)` marker** means the package sits in `devDependencies`. Careful:
  its absence does **not** mean the code reaches consumers. `scope` only answers
  the question of which section declares the dependency.

---

## Muting a vulnerability

Sometimes an alert needs silencing: a false positive, code that is never called,
or a fix already in progress that should not be re-announced every week.

GitHub has a built-in mechanism for that — **Dismiss**:

`Security → Dependabot` → open the alert → **Dismiss** with one of the reasons:

| Reason | When |
| --- | --- |
| `fix_started` | already being fixed |
| `inaccurate` | false positive |
| `no_bandwidth` | no time now, will return to it |
| `not_used` | the vulnerable code is never called |
| `tolerable_risk` | the risk is acceptable |

The alert then moves to the `dismissed` state, and since the script only keeps
`open` ones, dismissed alerts **disappear automatically** from both the daily
messages and the digest. No code changes needed.

---

## Maintenance

### The GitHub token expires

A fine-grained token lives at most a year. Once it expires the **Fetch alerts**
step fails with `401` — the workflow turns red rather than failing silently.
Reissue the token and update `AUDIT_ALERTS_GH_TOKEN`.

### Messages stopped arriving

Check in this order:

1. **Actions → Security alerts** — did the workflow run at all? Scheduled
   workflows are disabled automatically after 60 days without repository
   activity. For a fork that is edited rarely this is a realistic scenario.
2. The **Build message** step — does the log show the message text or
   `no new vulnerabilities - nothing to send`?
3. The **Send to Telegram** step — on failure it prints Telegram's error code and
   description. `chat not found` means a wrong `chat_id`; `not enough rights`
   means the bot lost its administrator rights.

### Bot or channel changed

Updating the secrets is enough, the workflow needs no changes.

---

## What this does not cover

**A clean audit here does not mean a clean audit downstream.** Dependabot checks
the `yarn.lock` of this repository, while `FullSail-Frontend` resolves its own.
The fork does not bundle its dependencies — `dist` imports them — so the versions
that actually ship are decided by the consumer's lockfile, not by this one.

Both sides need watching: here, that the fork itself is healthy; in
`FullSail-Frontend`, that its lockfile has not frozen a vulnerable version.
