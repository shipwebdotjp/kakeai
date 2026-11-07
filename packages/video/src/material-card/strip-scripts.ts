import { CompositionCompileError } from "../compile-error";

const SCRIPT_PATTERN = /<script\b[^>]*>[\s\S]*?<\/script>/gi;
const SCRIPT_REMAINS = /<script\b/i;
const DANGEROUS_TAGS = /<(?:iframe|object|embed|base|form|link)\b/i;
const EVENT_ATTRIBUTE = /(?:^|[\s/"'`])on[a-z]+\s*=/i;
const SRCDOC_ATTRIBUTE = /\ssrcdoc\s*=/i;

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal: string) => String.fromCharCode(Number(decimal)))
    .replace(/&colon;/gi, ":")
    .replace(/&equals;/gi, "=")
    .replace(/&sol;/gi, "/")
    .replace(/&tab;/gi, "\t")
    .replace(/&newline;/gi, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
}

/** Removes scripts and event attributes from a compiled card. */
export function stripScripts(html: string): string {
  return html
    .replace(SCRIPT_PATTERN, "")
    .replace(/\s+on[a-z]+\s*(?:=|&#x3d;|&#61;)\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(
      /\s+(?:href|src|srcset|xlink:href|formaction|action)\s*=\s*(?:"[^"]*javascript:[^"]*"|'[^']*javascript:[^']*'|[^\s>]*javascript[^\s>]*)/gi,
      "",
    )
    .replace(/\ssrcdoc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}

export function assertStaticHtml(html: string, sceneId: string): void {
  const normalizedHtml = decodeBasicEntities(html).toLowerCase();
  const compact = normalizedHtml.replace(/[\s\u0000-\u001f]+/g, "");
  if (
    SCRIPT_REMAINS.test(html) ||
    SCRIPT_REMAINS.test(normalizedHtml) ||
    DANGEROUS_TAGS.test(html) ||
    DANGEROUS_TAGS.test(normalizedHtml) ||
    EVENT_ATTRIBUTE.test(html) ||
    EVENT_ATTRIBUTE.test(normalizedHtml) ||
    SRCDOC_ATTRIBUTE.test(html) ||
    SRCDOC_ATTRIBUTE.test(normalizedHtml) ||
    compact.includes("javascript:") ||
    compact.includes("vbscript:") ||
    compact.includes("data:text/html") ||
    compact.includes("data:image/svg+xml")
  ) {
    throw new CompositionCompileError([
      {
        path: ["scenes", sceneId],
        code: "unsafe_material_card",
        message: "静的素材カードに script または危険な属性が残っています。",
      },
    ]);
  }
}
