/**
 * Sanitization utilities for on-chain data
 *
 * On-chain data (validator monikers, contract responses, etc.) is untrusted
 * and may contain prompt injection attempts or malicious content.
 */

/**
 * Sanitize a string by removing control characters and escaping HTML special characters.
 */
export const sanitizeString = (input: string): string => {
  // Remove control characters (U+0000-U+001F except \n, U+007F DEL, U+0080-U+009F C1 controls)
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional control char removal for security sanitization
  const cleaned = input.replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, "");
  // Escape HTML special characters
  return cleaned
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/\[/g, "&#x5B;")
    .replace(/\]/g, "&#x5D;");
};

const MAX_SANITIZE_DEPTH = 20;

/**
 * Recursively sanitize all string values in an object or array.
 * Depth-limited to prevent stack overflow from maliciously nested on-chain data.
 */
export const sanitizeOnChainData = (data: unknown, depth = 0): unknown => {
  if (typeof data === "string") {
    return sanitizeString(data);
  }
  if (depth >= MAX_SANITIZE_DEPTH) {
    return "[TRUNCATED]";
  }
  if (Array.isArray(data)) {
    return data.map((item) => sanitizeOnChainData(item, depth + 1));
  }
  if (data !== null && typeof data === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      result[sanitizeString(key)] = sanitizeOnChainData(value, depth + 1);
    }
    return result;
  }
  return data;
};

// Cyrillic → Latin homoglyph mapping (visual lookalikes)
const CYRILLIC_TO_LATIN: Record<string, string> = {
  "\u0410": "A", // А → A
  "\u0412": "B", // В → B
  "\u0421": "C", // С → C
  "\u0415": "E", // Е → E
  "\u041D": "H", // Н → H
  "\u0406": "I", // І → I
  "\u0408": "J", // Ј → J
  "\u041A": "K", // К → K
  "\u041C": "M", // М → M
  "\u041E": "O", // О → O
  "\u0420": "P", // Р → P
  "\u0405": "S", // Ѕ → S
  "\u0422": "T", // Т → T
  "\u0425": "X", // Х → X
  "\u0430": "a", // а → a
  "\u0441": "c", // с → c
  "\u0435": "e", // е → e
  "\u04BB": "h", // һ → h
  "\u0456": "i", // і → i
  "\u0458": "j", // ј → j
  "\u043E": "o", // о → o
  "\u0440": "p", // р → p
  "\u0455": "s", // ѕ → s
  "\u0443": "y", // у → y
  "\u0445": "x", // х → x
};

// Greek → Latin homoglyph mapping (visual lookalikes)
const GREEK_TO_LATIN: Record<string, string> = {
  "\u0391": "A", // Α → A
  "\u0392": "B", // Β → B
  "\u0395": "E", // Ε → E
  "\u0396": "Z", // Ζ → Z
  "\u0397": "H", // Η → H
  "\u0399": "I", // Ι → I
  "\u039A": "K", // Κ → K
  "\u039C": "M", // Μ → M
  "\u039D": "N", // Ν → N
  "\u039F": "O", // Ο → O
  "\u03A1": "P", // Ρ → P
  "\u03A4": "T", // Τ → T
  "\u03A5": "Y", // Υ → Y
  "\u03A7": "X", // Χ → X
  "\u03BF": "o", // ο → o
  "\u03B1": "a", // α → a (close visual match in many fonts)
  "\u03B5": "e", // ε → e (close visual match in some fonts)
  "\u03B9": "i", // ι → i
  "\u03BA": "k", // κ → k
  "\u03BD": "v", // ν → v
  "\u03C1": "p", // ρ → p
  "\u03C5": "u", // υ → u
  "\u03C7": "x", // χ → x
};

// Merged homoglyph map covering both Cyrillic and Greek lookalikes
const HOMOGLYPH_MAP: Record<string, string> = {
  ...CYRILLIC_TO_LATIN,
  ...GREEK_TO_LATIN,
};

// Latin letter ranges: A-Z, a-z (basic) + extended Latin blocks
const LATIN_RE = /[A-Za-z\u00C0-\u024F]/;
// Non-Latin suspect ranges: Cyrillic (U+0400-U+04FF) + Greek (U+0370-U+03FF)
const NON_LATIN_SUSPECT_RE = /[\u0370-\u03FF\u0400-\u04FF]/;

/**
 * Detect mixed-script strings (Latin + Cyrillic/Greek) and replace homoglyphs
 * with their Latin equivalents. Appends a warning suffix.
 * Pure non-Latin or pure-Latin strings are returned unchanged.
 */
export const flagHomoglyphs = (input: string): string => {
  if (!LATIN_RE.test(input) || !NON_LATIN_SUSPECT_RE.test(input)) {
    return input;
  }
  // Replace non-Latin lookalikes with Latin equivalents
  let replaced = "";
  for (const ch of input) {
    replaced += HOMOGLYPH_MAP[ch] ?? ch;
  }
  return `${replaced} [⚠ MIXED-SCRIPT: homoglyphs replaced with Latin equivalents]`;
};

/**
 * Wrap untrusted data with boundary markers to signal to LLMs
 * that this data comes from an untrusted on-chain source.
 *
 * Defense-in-depth: sanitizeOnChainData removes control characters and
 * HTML-escapes strings, then JSON.stringify serializes the result with
 * boundary markers for LLM context separation.
 */
export const wrapUntrustedData = (data: unknown, source: string): string => {
  const sanitized = sanitizeOnChainData(data);
  return (
    `[UNTRUSTED ON-CHAIN DATA from ${source}]\n` +
    `${JSON.stringify(sanitized, null, 2)}\n` +
    `[END UNTRUSTED DATA]`
  );
};
