import { runLiveExport } from "./live-export.ts";

async function main(): Promise<void> {
  const exitCode = await runLiveExport(process.argv.slice(2), {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  });
  process.exitCode = exitCode;
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      code: "LIVE_EXPORT_INTERNAL_ERROR",
      message: error instanceof Error ? error.message : String(error),
    })}\n`,
  );
  process.exitCode = 1;
});
