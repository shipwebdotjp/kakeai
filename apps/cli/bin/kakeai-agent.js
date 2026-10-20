#!/usr/bin/env node
// The workspace runs TypeScript sources directly, so the installed bin registers
// the tsx ESM loader before importing the real entrypoint. stdout is reserved
// for command output; this launcher writes nothing.
import { register } from "tsx/esm/api";

register();
await import("../src/bin.ts");
