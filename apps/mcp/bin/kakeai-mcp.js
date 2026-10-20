#!/usr/bin/env node
// The workspace runs TypeScript sources directly, so the installed bin registers
// the tsx ESM loader before importing the real entrypoint. stdout stays reserved
// for the MCP stdio transport; this launcher writes nothing.
import { register } from "tsx/esm/api";

register();
await import("../src/bin.ts");
