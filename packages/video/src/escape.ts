export function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function escapeCssFontFamily(name: string): string {
  const sanitized = name.replace(/['"\\;{}()<>&]/g, "").trim();
  if (sanitized.length === 0) {
    return "sans-serif";
  }
  return `'${sanitized}'`;
}

export function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
