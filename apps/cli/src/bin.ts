import { CLI_ERROR_CODES } from "./errors.ts";
import { runCli } from "./run.ts";

async function main(): Promise<void> {
  const exitCode = await runCli(process.argv.slice(2), {
    stdout: (text) => {
      process.stdout.write(text);
    },
    stderr: (text) => {
      process.stderr.write(text);
    },
  });
  process.exitCode = exitCode;
}

main().catch(() => {
  // Never print a stack trace: stdout is command output only, stderr is JSON.
  process.stderr.write(`${JSON.stringify({ code: CLI_ERROR_CODES.INTERNAL_ERROR })}\n`);
  process.exitCode = 1;
});
