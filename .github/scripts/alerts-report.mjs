#!/usr/bin/env node
// Turns the Dependabot alerts API response into a Telegram message.
//
//   gh api ... --paginate | node alerts-report.mjs [--since <iso>] [--digest]
//
// Without --digest only alerts created after --since are reported, so the daily
// run stays quiet until something actually changes. Prints nothing when there is
// nothing to report, and the workflow then skips the Telegram call.

import { readFileSync } from "node:fs";

const TOP_PACKAGES = 5;
// A GitHub advisory summary may be up to 1024 characters and Telegram caps a
// message at 4096. Truncating keeps the message around 1400 for any input.
const SUMMARY_LIMIT = 150;

const args = process.argv.slice(2);
const digest = args.includes("--digest");
const since =
  !digest && args.includes("--since") ? new Date(args[args.indexOf("--since") + 1]) : null;

const alerts = JSON.parse(readFileSync(0, "utf8"))
  .filter((a) => a.state === "open")
  .filter((a) => !since || new Date(a.created_at) > since);

if (alerts.length === 0) process.exit(0);

const rank = { critical: 0, high: 1, moderate: 2, low: 3 };
const icon = { critical: "🔴", high: "🟠", moderate: "🟡", low: "⚪️" };
const severityOf = (a) => a.security_advisory?.severity ?? "unknown";

// A single vulnerable version can carry dozens of advisories — next has 21 —
// so collapse them into one block per package.
const groups = new Map();
for (const a of alerts) {
  const name = a.dependency?.package?.name ?? "unknown";
  if (!groups.has(name)) groups.set(name, []);
  groups.get(name).push(a);
}

const worstOf = (group) =>
  group.reduce(
    (acc, a) => ((rank[severityOf(a)] ?? 9) < (rank[severityOf(acc)] ?? 9) ? a : acc),
    group[0],
  );

const ordered = [...groups.entries()].sort(
  (a, b) =>
    (rank[severityOf(worstOf(a[1]))] ?? 9) - (rank[severityOf(worstOf(b[1]))] ?? 9) ||
    b[1].length - a[1].length,
);

const counts = {};
for (const a of alerts) counts[severityOf(a)] = (counts[severityOf(a)] ?? 0) + 1;

const repo = process.env.GITHUB_REPOSITORY ?? "repo";
const lines = [
  digest ? `Open vulnerabilities — ${repo}` : `New vulnerabilities — ${repo}`,
  `${alerts.length} in ${groups.size} packages · ` +
    Object.entries(counts)
      .sort((a, b) => (rank[a[0]] ?? 9) - (rank[b[0]] ?? 9))
      .map(([severity, n]) => `${severity} ${n}`)
      .join(" · "),
  "",
];

for (const [name, group] of ordered.slice(0, TOP_PACKAGES)) {
  const worst = worstOf(group);
  const ghsa = worst.security_advisory?.ghsa_id;
  const dev = worst.dependency?.scope === "development" ? " (dev)" : "";
  const summary = (worst.security_advisory?.summary ?? "").slice(0, SUMMARY_LIMIT);

  lines.push(
    `${icon[severityOf(worst)] ?? "•"} ${name}${dev}` +
      (group.length > 1 ? ` — ${group.length} advisories` : ""),
  );
  lines.push(`   ${summary}${group.length > 1 ? " and more" : ""}`);
  if (ghsa) lines.push(`   https://github.com/advisories/${ghsa}`);
  lines.push("");
}

lines.push("The remaining vulnerabilities are listed here:");
lines.push(`https://github.com/${repo}/security/dependabot`);

process.stdout.write(lines.join("\n"));
