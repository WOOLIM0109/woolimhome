export function missingFontsFromMessage(message: string) {
  if (!message.startsWith("MISSING_FONTS:")) return [];
  return [...new Set(message
    .slice("MISSING_FONTS:".length)
    .replace(/^.*?:\s*/, "")
    .replace(/[.]$/, "")
    .split(",")
    .map((font) => font.trim())
    .filter(Boolean))].slice(0, 100);
}
