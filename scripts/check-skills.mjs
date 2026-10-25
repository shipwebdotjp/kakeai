// Verifies that the pinned skills CLI discovers both published skills.
// Invalid or missing frontmatter makes the CLI fail, which fails this check.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const expectedSkills = ["kakeai-production", "kakeai-composition"];

let skillsCli;
try {
  const require = createRequire(import.meta.url);
  const packagePath = require.resolve("skills/package.json");
  const packageJson = require(packagePath);
  const bin =
    typeof packageJson.bin === "string" ? packageJson.bin : packageJson.bin?.skills;
  if (!bin) throw new Error("skills package has no skills bin");
  skillsCli = resolve(dirname(packagePath), bin);
} catch (error) {
  console.error(
    `Could not resolve the pinned skills CLI. Run npm ci first. (${error.message})`,
  );
  process.exit(1);
}

const result = spawnSync(process.execPath, [skillsCli, "add", "./skills", "--list"], {
  cwd: root,
  encoding: "utf8",
  env: { ...process.env, CI: "1", NO_COLOR: "1" },
  timeout: 60_000,
});

if (result.error) {
  const detail =
    result.error.code === "ETIMEDOUT" ? "timed out after 60 seconds" : result.error.message;
  console.error(`Could not run the skills CLI: ${detail}`);
  process.exit(1);
}

const ansiPattern = new RegExp("\\u001b\\[[0-?]*[ -/]*[@-~]", "g");
const stdout = (result.stdout ?? "").replace(ansiPattern, "");
const stderr = (result.stderr ?? "").replace(ansiPattern, "");
const output = `${stdout}\n${stderr}`;

if (result.status !== 0) {
  console.error(output.trim());
  console.error(
    `skills add ./skills --list failed (status=${result.status}, signal=${result.signal ?? "none"}); inspect the output above.`,
  );
  process.exit(1);
}

// skills@1.7.4 does not allow --json with --list, so parse the list headings
// and verify both the reported count and the exact skill names.
const discovered = new Set(
  stdout
    .split(/\r?\n/u)
    .map((line) => line.replace(/^[\s│|]+/u, "").trim())
    .filter(Boolean),
);
const missing = expectedSkills.filter((name) => !discovered.has(name));

if (missing.length > 0) {
  console.error(output.trim());
  console.error(`Skills not discovered: ${missing.join(", ")}`);
  process.exit(1);
}

const countMatch = stdout.match(/Found\s+(\d+)\s+skills?/u);
if (!countMatch) {
  console.error(output.trim());
  console.error("Could not find the skill count in the skills CLI output.");
  process.exit(1);
}

if (Number(countMatch[1]) !== expectedSkills.length) {
  console.error(output.trim());
  console.error(
    `Expected ${expectedSkills.length} skills, but the CLI reported ${countMatch[1]}.`,
  );
  process.exit(1);
}

console.log(`Discovered ${expectedSkills.length} skills: ${expectedSkills.join(", ")}`);
