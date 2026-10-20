/**
 * docx-thai-cleaner
 * -----------------
 * Production-grade Thai text sanitizer for `.docx` / OpenXML pipelines.
 *
 * Real-world Thai text destined for Word documents is usually corrupted on the
 * way in — scraped HTML leaks tags into paragraphs, copy/paste inserts
 * zero-width spaces that split syllables, and mangled sources scramble the
 * stacking order of Thai vowel signs and tone marks.
 *
 * This module exposes five composable stages (plus {@link decodeHtmlEntities}
 * as a standalone utility):
 *
 * 1. {@link cleanThaiDocxText}  — strip leaked markup, invisible characters,
 *    normalize to NFC and tidy whitespace.
 * 2. {@link cleanHtmlAndSpecialEntities} — turn an HTML fragment into plain
 *    text: remove tags and decode named/numeric entities (`&nbsp;`, `&#39;`,
 *    ...).
 * 3. {@link fixThaiFloatingVowels} — re-attach floating combining marks and
 *    restore the canonical Thai cluster stacking order.
 * 4. {@link fixThaiBottomVowels} — repair lower vowels (`ุ ู`) under the
 *    descender consonants `ญ ฐ` (the "ตัดเชิง" cases).
 * 5. {@link sanitizeOpenXmlNodes} — produce output that is safe to inject into
 *    an OpenXML (`<w:t>` / attribute) node.
 *
 * @packageDocumentation
 */

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Options accepted by {@link sanitizeOpenXmlNodes}.
 */
export interface SanitizeOpenXmlOptions {
  /**
   * Strip every tag from the input and treat the whole string as plain text.
   *
   * Use this when the payload contains leaked HTML (`<div>`, `<br/>`, ...) and
   * only the visible text should reach the document.
   *
   * When `false` (default), well-formed markup is preserved and only the text
   * between tags is cleaned and escaped.
   *
   * @default false
   */
  stripMarkup?: boolean;
  /**
   * Repair floating Thai vowel/tone marks and normalize their stacking order
   * inside text segments.
   *
   * @default true
   */
  fixVowels?: boolean;
  /**
   * Collapse runs of horizontal whitespace, trim lines and limit blank lines to
   * one inside text segments (mirrors {@link cleanThaiDocxText}).
   *
   * Disable when you need to preserve exact spacing such as
   * `xml:space="preserve"` runs.
   *
   * @default true
   */
  collapseWhitespace?: boolean;
  /**
   * XML-escape text segments (`&`, `<`, `>`, `"`, `'`) so the result can be
   * injected into an element body or an attribute value.
   *
   * @default true
   */
  escape?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Invisible, zero-width and bidi-control characters that are routinely glued
 * into Thai text by HTML paste, OCR and PDF extraction and that break Word's
 * syllable rendering:
 *
 * | Char  | Name                        |
 * | ----- | --------------------------- |
 * | U+00AD | SOFT HYPHEN                |
 * | U+061C | ARABIC LETTER MARK         |
 * | U+180E | MONGOLIAN VOWEL SEPARATOR  |
 * | U+200B | ZERO WIDTH SPACE           |
 * | U+200C | ZERO WIDTH NON-JOINER      |
 * | U+200D | ZERO WIDTH JOINER          |
 * | U+200E | LEFT-TO-RIGHT MARK         |
 * | U+200F | RIGHT-TO-LEFT MARK         |
 * | U+202A..U+202E | BIDI EMBEDDING/override |
 * | U+2060 | WORD JOINER                |
 * | U+2066..U+2069 | BIDI ISOLATES        |
 * | U+FEFF | ZERO WIDTH NO-BREAK SPACE (BOM) |
 *
 * Exported so callers can build their own matchers or audit inputs.
 */
export const INVISIBLE_CHARS =
  '\u00AD' +
  '\u061C' +
  '\u180E' +
  '\u200B' +
  '\u200C' +
  '\u200D' +
  '\u200E' +
  '\u200F' +
  '\u202A\u202B\u202C\u202D\u202E' +
  '\u2060' +
  '\u2066\u2067\u2068\u2069' +
  '\uFEFF';

/** Character class source for {@link INVISIBLE_CHARS}. */
const INVISIBLE_CLASS = `[${INVISIBLE_CHARS}]`;

/**
 * C0/C1 control characters and Unicode non-characters that are illegal in both
 * XML 1.0 and well-formed Unicode text. Tab, LF and CR are intentionally kept.
 */
const CONTROL_CHARS_CLASS =
  '[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F\\uFFFE\\uFFFF]';

/** Lone (unpaired) surrogates, which produce ill-formed UTF-16 output. */
const LONE_HIGH_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g;
const LONE_LOW_SURROGATE_RE = /(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * Any Thai-block character that is a combining mark (Unicode category `Mn`/`Mc`):
 * vowel signs (U+0E31, U+0E34–U+0E3A) and tone-related marks (U+0E47–U+0E4E).
 * Verified against the Thai block: U+0E33 (SARA AM) and U+0E30 (SARA A) are
 * spacing characters and must never be reordered as marks.
 */
const THAI_MARK_CLASS = '\\u0E31\\u0E34-\\u0E3A\\u0E47-\\u0E4E';

/** Any Thai-block character (U+0E00–U+0E7F), spacing or combining. */
const THAI_CHAR_CLASS = '\\u0E00-\\u0E7F';

/**
 * Canonical stacking rank for Thai combining marks inside a cluster.
 *
 * The correct logical order (Unicode Standard, Thai orthography) is:
 *
 * ```
 * base consonant
 *   + upper vowel (ั ิ ึ ื)     -> U+0E31, U+0E34..U+0E37
 *   + lower vowel (ุ ู)      -> U+0E38, U+0E39, U+0E3A
 *   + mai taikhu (็)          -> U+0E47
 *   + tone marks (่ ้ ๊ ๋)    -> U+0E48..U+0E4B
 *   + thanthakhat/nikkahit (์ ํ ๎) -> U+0E4C..U+0E4E
 * ```
 *
 * Unknown marks fall back to rank 0 and keep their relative position because
 * the sort is stable.
 */
const MARK_RANKS: Readonly<Record<number, number>> = Object.freeze({
  0x0e31: 0, // MAI HAN AKAT
  0x0e34: 0, // SARA I
  0x0e35: 0, // SARA II
  0x0e36: 0, // SARA UE
  0x0e37: 0, // SARA UEE
  0x0e38: 1, // SARA U  (below)
  0x0e39: 1, // SARA UU (below)
  0x0e3a: 1, // PHINTHU (below)
  0x0e47: 2, // MAI TAIKHU
  0x0e48: 3, // MAI EK
  0x0e49: 3, // MAI THO
  0x0e4a: 3, // MAI TRI
  0x0e4b: 3, // MAI CHATTAWA
  0x0e4c: 4, // THANTHAKHAT
  0x0e4d: 4, // NIKKAHIT
  0x0e4e: 4, // YAMAKKAN
});

/**
 * Matches leaked markup: comments, CDATA, processing instructions, doctypes and
 * ordinary tags. Only structurally tag-shaped sequences are matched, so a
 * mathematical `a < b` survives untouched.
 */
const HTML_TAG_RE =
  /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<![^>]*>|<\/?[A-Za-z][^<>]*>/g;

/**
 * Matches well-formed-looking markup segments for {@link sanitizeOpenXmlNodes}.
 * Quoted attribute values may contain `>`, everything else may not. Attribute
 * content uses single-character alternatives so matching stays linear even on
 * malformed input (no nested quantifier backtracking).
 */
const MARKUP_SEGMENT_RE =
  /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<![^>]*>|<\/?[A-Za-z_][A-Za-z0-9_:.-]*(?:[ \t\r\n]+(?:[^<>"']|"[^"]*"|'[^']*')*)?[ \t\r\n]*\/?>/g;

/** HTML named entities mapped to their characters (decoded in text segments). */
const NAMED_ENTITIES: Readonly<Record<string, string>> = Object.freeze({
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00A0',
  ensp: '\u2002',
  emsp: '\u2003',
  thinsp: '\u2009',
  shy: '\u00AD',
  hellip: '\u2026',
  mdash: '\u2014',
  ndash: '\u2013',
  middot: '\u00B7',
  bull: '\u2022',
  copy: '\u00A9',
  reg: '\u00AE',
  trade: '\u2122',
  laquo: '\u00AB',
  raquo: '\u00BB',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201C',
  rdquo: '\u201D',
  sect: '\u00A7',
  para: '\u00B6',
  deg: '\u00B0',
  plusmn: '\u00B1',
  times: '\u00D7',
  divide: '\u00F7',
  cent: '\u00A2',
  pound: '\u00A3',
  yen: '\u00A5',
  euro: '\u20AC',
});

/**
 * HTML-only entities that appear inside *markup* segments. XML only knows
 * `amp lt gt quot apos` plus numeric references, so these are rewritten to
 * numeric character references instead of being expanded (expanding them would
 * inject raw `<`/`"` into tags and break well-formedness).
 */
const XML_KNOWN_ENTITY_NAMES = new Set(['amp', 'lt', 'gt', 'quot', 'apos']);

const MARKUP_ENTITY_RE = new RegExp(
  `&(${Object.keys(NAMED_ENTITIES)
    .filter((name) => !XML_KNOWN_ENTITY_NAMES.has(name))
    .join('|')});`,
  'gi',
);

const NAMED_OR_NUMERIC_ENTITY_RE = /&(?:([A-Za-z]+)|#(\d+)|#[xX]([0-9A-Fa-f]+));/g;

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                              */
/* -------------------------------------------------------------------------- */

const THAI_MARK_RE = new RegExp(`[${THAI_MARK_CLASS}]`);
const THAI_CHAR_RE = new RegExp(`[${THAI_CHAR_CLASS}]`);
const THAI_MARK_RUN_RE = new RegExp(`[${THAI_MARK_CLASS}]+`, 'g');
const ORPHAN_MARK_RE = new RegExp(`(?<![${THAI_CHAR_CLASS}])([${THAI_MARK_CLASS}]+)`, 'g');
const MARK_BEFORE_MARK_RE = new RegExp(
  `([${THAI_CHAR_CLASS}])[^\\S\\n]+(?=[${THAI_MARK_CLASS}])`,
  'g',
);

/**
 * Thai consonants with a descender ("เชิง") hanging below the baseline —
 * ญ (U+0E0D FO FAN) and ฐ (U+0E10 THO THAN). When a lower vowel follows, fonts
 * cut the descender and shift the vowel right; corrupted sources instead try
 * to encode that shift manually (see {@link fixThaiBottomVowels}).
 */
const THAI_DESCENDER_CLASS = '\\u0E0D\\u0E10';

/** Lower vowels rendered beneath the base: SARA U (\u0E38) and SARA UU (\u0E39). */
const THAI_LOWER_VOWEL_CLASS = '\\u0E38\\u0E39';

/**
 * A lower vowel stored *before* its base consonant — always a corruption,
 * because `ุ`/`ู` are combining marks and can never stand on their own.
 * The vowel must be unattached (start of string or preceded by a non-Thai
 * character) and the target must be a Thai base character, never another mark:
 * `คุณ` (base + vowel + consonant) must not be mistaken for this pattern.
 */
const LOWER_VOWEL_BEFORE_BASE_RE = new RegExp(
  `(?<![${THAI_CHAR_CLASS}])([${THAI_LOWER_VOWEL_CLASS}])[\\t ]*(?![${THAI_MARK_CLASS}])([${THAI_CHAR_CLASS}])`,
  'g',
);

/** A lower vowel detached from a descender consonant by horizontal space. */
const DESCENDER_DETACHED_LOWER_RE = new RegExp(
  `([${THAI_DESCENDER_CLASS}])[\\t ]+(?=[${THAI_LOWER_VOWEL_CLASS}])`,
  'g',
);

const isThaiMark = (char: string): boolean => THAI_MARK_RE.test(char);

const isThaiChar = (char: string): boolean => THAI_CHAR_RE.test(char);

/**
 * Removes every invisible, control and lone-surrogate character.
 * Runs *before* normalization so ill-formed input never reaches `normalize()`.
 */
function removeUnsafeChars(text: string): string {
  if (!text) return text;
  return text
    .replace(new RegExp(INVISIBLE_CLASS, 'g'), '')
    .replace(new RegExp(CONTROL_CHARS_CLASS, 'g'), '')
    .replace(LONE_HIGH_SURROGATE_RE, '')
    .replace(LONE_LOW_SURROGATE_RE, '');
}

/**
 * Decodes HTML entities into the characters they represent — the curated set
 * of named entities (`&nbsp;`, `&amp;`, `&quot;`, `&lt;`, `&gt;`, `&#39;`,
 * `&apos;` plus typographic `&mdash;`, `&hellip;`, ...) and numeric references
 * in decimal (`&#39;`) and hex (`&#x27;`) form.
 *
 * Decoding runs in a **single pass** — exactly once per HTML parsing layer, as
 * the WHATWG HTML Standard prescribes — so `&amp;#39;` correctly becomes the
 * literal text `&#39;` instead of an apostrophe. Unknown named entities are
 * left untouched (for {@link sanitizeOpenXmlNodes}'s escaper to neutralize).
 *
 * @param input - Text that may contain HTML entities.
 * @returns The decoded text. `&nbsp;` becomes U+00A0 NO-BREAK SPACE, which
 *   {@link cleanHtmlAndSpecialEntities} and the whitespace cleanup stages turn
 *   into an ordinary space.
 *
 * @example
 * ```ts
 * decodeHtmlEntities('Tom &amp; Jerry &lt;3 &#65;'); // => 'Tom & Jerry <3 A'
 * decodeHtmlEntities('&amp;#39;');                   // => '&#39;' (single decode)
 * ```
 */
export function decodeHtmlEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(NAMED_OR_NUMERIC_ENTITY_RE, (whole, name, decimal, hex) => {
    if (name !== undefined) {
      const mapped = NAMED_ENTITIES[name];
      return mapped === undefined ? whole : mapped;
    }
    const codePoint = decimal !== undefined ? Number.parseInt(decimal, 10) : Number.parseInt(hex, 16);
    if (!Number.isInteger(codePoint) || codePoint <= 0 || codePoint > 0x10ffff) return whole;
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) return whole; // lone surrogate
    return String.fromCodePoint(codePoint);
  });
}

/**
 * Tidies spacing: normalizes newlines, collapses runs of horizontal whitespace
 * to a single space, trims around line breaks, limits blank lines to one and
 * trims the outer edges.
 */
function collapseWhitespace(text: string): string {
  return text
    .replace(/\r\n|\r/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Escapes a string for use in an XML text node or attribute value. */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Stable rank lookup for a Thai combining mark. */
function markRank(char: string): number {
  return MARK_RANKS[char.codePointAt(0) ?? 0] ?? 0;
}

/* -------------------------------------------------------------------------- */
/* Stage 1 — cleanThaiDocxText                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Cleans raw Thai text destined for a Word document.
 *
 * Pipeline, in order:
 *
 * 1. **Decode HTML entities** — `&nbsp;`, `&amp;`, `&#39;`, `&#x200B;`, ... are
 *    expanded exactly once via {@link decodeHtmlEntities} (unknown names are
 *    preserved literally).
 * 2. **Strip leaked markup** — HTML/XML comments, CDATA, doctypes, processing
 *    instructions and tags such as `<p>`, `<span class="x">` are removed.
 *    Because entities are decoded first, escaped markup (`&lt;b&gt;`) is also
 *    recognized and stripped as markup.
 * 3. **Drop invisible/illegal characters** — every entry of
 *    {@link INVISIBLE_CHARS} (`\u200B`, `\u00AD`, `\uFEFF`, ZWNJ/ZWJ,
 *    bidi controls), C0/C1 controls (except tab/LF/CR), Unicode
 *    non-characters and lone surrogates.
 * 4. **Unicode NFC normalization** so precomposed and decomposed forms of the
 *    same text compare equal.
 * 5. **Whitespace cleanup** — CRLF → LF, runs of spaces/tabs → one space,
 *    trimmed lines, at most one blank line, trimmed ends.
 *
 * @param input - Raw text (HTML leaks, copy/paste artifacts and all).
 * @returns The cleaned text. Returns `''` for empty input.
 *
 * @example
 * ```ts
 * cleanThaiDocxText('<p>สวัสดี​ครับ</p>'); // => 'สวัสดีครับ'
 * ```
 *
 * @remarks
 * Floating vowel/tone-mark repair is intentionally *not* part of this stage —
 * chain {@link fixThaiFloatingVowels} when you also need cluster repair.
 */
export function cleanThaiDocxText(input: string): string {
  if (!input) return '';

  let text = decodeHtmlEntities(input);
  text = text.replace(HTML_TAG_RE, '');
  text = removeUnsafeChars(text);
  text = text.normalize('NFC');
  return collapseWhitespace(text);
}

/* -------------------------------------------------------------------------- */
/* Stage 1b — cleanHtmlAndSpecialEntities                                      */
/* -------------------------------------------------------------------------- */

/**
 * Removes HTML markup and decodes HTML entities, returning plain text — the
 * right first stage when the payload is a CMS/HTML fragment rather than raw
 * text.
 *
 * - Real tags, comments, doctypes and CDATA are stripped (`<p>x</p>` → `x`).
 *   Escaped tags present in the source are *decoded to literal text*, exactly
 *   as a browser would render them (`&lt;b&gt;` → `<b>`).
 * - Named entities (`&nbsp;`, `&amp;`, `&quot;`, `&#39;`, `&apos;` plus
 *   typographic `&mdash;`, `&hellip;`, `&lsquo;`, ...) and numeric references
 *   (decimal `&#39;` and hex `&#x27;`) are decoded **once** — `&amp;#39;`
 *   correctly yields the literal text `&#39;`.
 * - Non-breaking spaces (`&nbsp;`, `&#160;`, `&#xA0;`) become ordinary spaces,
 *   and runs of whitespace are collapsed and trimmed.
 *
 * @param input - Text containing HTML fragments and/or entities.
 * @returns The plain-text result. Returns `''` for empty input.
 *
 * @example
 * ```ts
 * cleanHtmlAndSpecialEntities('<p>ราคา&nbsp;1,000&nbsp;บาท&nbsp;&amp;&nbsp;ลด 50%</p>');
 * // => 'ราคา 1,000 บาท & ลด 50%'
 *
 * cleanHtmlAndSpecialEntities('&lt;p&gt;ตัวอักษร&lt;/p&gt;');
 * // => '<p>ตัวอักษร</p>'  (escaped tags decode to literal text)
 * ```
 *
 * @remarks
 * The decoder covers a curated set of named entities plus every valid numeric
 * reference; unknown names are left untouched for the caller (or for
 * {@link sanitizeOpenXmlNodes}'s escaper) to neutralize. When the result must
 * also survive Thai mark corruption, chain {@link fixThaiFloatingVowels}.
 */
export function cleanHtmlAndSpecialEntities(input: string): string {
  if (!input) return '';

  let text = input.replace(HTML_TAG_RE, '');
  text = decodeHtmlEntities(text);
  text = text.replace(/\u00A0/g, ' ');
  return collapseWhitespace(text);
}

/* -------------------------------------------------------------------------- */
/* Stage 2 — fixThaiFloatingVowels                                             */
/* -------------------------------------------------------------------------- */

/**
 * Re-attaches marks that were pushed away from their base by inserted spaces
 * (`ก ัน` → `กัน`). Whitespace runs are only bridged when a Thai character
 * precedes them and a Thai mark follows, so valid text (`สวัสดี ครับ`) and
 * line breaks are never collapsed.
 */
function reattachSeparatedMarks(text: string): string {
  if (!text) return text;
  return text.replace(MARK_BEFORE_MARK_RE, '$1');
}

/**
 * Moves orphaned combining marks — marks that begin the string or follow a
 * non-Thai character — behind the next Thai letter in the same token
 * (`ัน` → `นั`). Best effort: when no suitable base follows before a line
 * break or punctuation, the mark is left in place.
 */
function relocateOrphanMarks(text: string): string {
  if (!text) return text;

  let output = '';
  let cursor = 0;
  let match: RegExpExecArray | null;

  ORPHAN_MARK_RE.lastIndex = 0;
  while ((match = ORPHAN_MARK_RE.exec(text)) !== null) {
    const start = match.index;
    const marks = match[1];
    const afterMarks = start + marks.length;

    // The intended base must be the very next Thai character, possibly with
    // spaces/tabs in between — never across a line break or punctuation.
    const target = /^[ \t]*([\u0E00-\u0E7F])/u.exec(text.slice(afterMarks));
    if (!target || !isThaiChar(target[1]) || isThaiMark(target[1])) continue;

    const afterTarget = afterMarks + target[0].length;
    output += text.slice(cursor, start) + target[1] + marks;
    cursor = afterTarget;
    ORPHAN_MARK_RE.lastIndex = afterTarget;
  }

  return output + text.slice(cursor);
}

/**
 * Sorts every run of Thai combining marks into the canonical stacking order
 * (vowels → mai taikhu → tone marks → thanthakhat) with a stable sort.
 *
 * Correctly ordered clusters are returned unchanged because their ranks are
 * already non-decreasing. Spacing characters such as `ำ` (U+0E33) are not marks
 * and are never moved (`น้ำ` keeps its tone mark *before* `ำ`).
 */
function reorderMarkStacks(text: string): string {
  if (!text) return text;
  return text.replace(THAI_MARK_RUN_RE, (run) => {
    if (run.length < 2) return run;
    const ranked = Array.from(run, (char, index) => ({ char, index, rank: markRank(char) }));
    ranked.sort((a, b) => a.rank - b.rank || a.index - b.index);
    return ranked.map((entry) => entry.char).join('');
  });
}

/**
 * Repairs "floating" Thai vowel signs and tone marks so every cluster stacks in
 * the canonical Unicode order.
 *
 * Three repairs are applied:
 *
 * 1. **Re-attach** combining marks that were separated from their Thai base by
 *    spaces (`ก ัน` → `กัน`) or zero-width characters (which are stripped
 *    first).
 * 2. **Relocate orphaned marks** that lost their base to the left
 *    (`ัน` → `นั`).
 * 3. **Reorder** marks within each cluster so upper/lower vowels precede
 *    mai taikhu, which precedes tone marks, which precede thanthakhat
 *    (`ท่ี` → `ที่`, `ป๊ั` → `ปั๊`).
 *
 * Correctly written text — including tricky sequences such as `เมื่อ`, `เดี๋ยว`
 * and `น้ำ` (where the tone mark precedes the spacing character `ำ`) — passes
 * through unchanged.
 *
 * @param input - Text that may contain scrambled Thai clusters.
 * @returns The repaired text. Returns `''` for empty input.
 *
 * @example
 * ```ts
 * fixThaiFloatingVowels('ก ัน');    // => 'กัน'
 * fixThaiFloatingVowels('ท่ี');     // => 'ที่'
 * fixThaiFloatingVowels('สวัสดี');  // => 'สวัสดี' (unchanged)
 * ```
 *
 * @remarks
 * Preposed vowels (`เ แ โ ใ ไ`) are *not* reordered: a consonant directly
 * followed by `เ` is legitimate across word boundaries (e.g. `...กินเขา`), so
 * any such rewrite would be ambiguous.
 */
export function fixThaiFloatingVowels(input: string): string {
  if (!input) return '';

  let text = removeUnsafeChars(input);
  text = text.normalize('NFC');
  text = reattachSeparatedMarks(text);
  text = relocateOrphanMarks(text);
  text = reorderMarkStacks(text);
  return text;
}

/* -------------------------------------------------------------------------- */
/* Stage 2b — fixThaiBottomVowels                                              */
/* -------------------------------------------------------------------------- */

/**
 * Repairs lower vowels (`ุ` U+0E38, `ู` U+0E39) beneath the descender
 * consonants `ญ` (U+0E0D) and `ฐ` (U+0E10) — the "ตัดเชิง" (descender-cut)
 * cases.
 *
 * In correct Thai the vowel is stored directly after its consonant; the font
 * then cuts the descender and shifts the vowel right (a pure OpenType glyph
 * operation). Real words such as `กตัญญู` therefore keep the plain sequence
 * `ญ + ู` and pass through unchanged.
 *
 * Sources that "cut the descender" manually produce corrupted sequences, all
 * of which are repaired here:
 *
 * 1. **Zero-width shift spacers** glued between consonant and vowel
 *    (`\u200B` used to fake the right-shift) — removed together with every
 *    other invisible character.
 * 2. **Vowels stored before their base** (`ุญ` → `ญุ`).
 * 3. **Vowels detached from their base by spaces** (`กตัญ ู` → `กตัญู`).
 * 4. **Scrambled stacking** — once marks share a cluster they are sorted into
 *    canonical order (lower vowels → `็` → tone marks), so `ญ ู ่` becomes
 *    `ญู่` (vowel U+0E38 has combining class 103, tones U+0E48..4B class 107).
 *
 * The repair is deliberately scoped to *bottom* vowels — floating upper
 * vowels and tones are left to {@link fixThaiFloatingVowels}, which can be
 * chained for a complete repair. Text without lower vowels (e.g. `คุณ`,
 * `น้ำ`, `เมื่อ`) is never modified.
 *
 * @param input - Text that may contain corrupted lower-vowel clusters.
 * @returns The repaired text. Returns `''` for empty input.
 *
 * @example
 * ```ts
 * fixThaiBottomVowels('กตัญ ู');          // => 'กตัญู'
 * fixThaiBottomVowels('ญ\u200Bุ');           // => 'ญุ'
 * fixThaiBottomVowels('กตัญ ู ้');          // => 'กตัญู่' (vowel before tone)
 * fixThaiBottomVowels('กตัญญู');           // => 'กตัญญู' (unchanged)
 * ```
 */
export function fixThaiBottomVowels(input: string): string {
  if (!input) return '';

  let text = removeUnsafeChars(input);
  text = text.normalize('NFC');
  text = text.replace(LOWER_VOWEL_BEFORE_BASE_RE, '$2$1');
  text = text.replace(DESCENDER_DETACHED_LOWER_RE, '$1');
  text = reattachSeparatedMarks(text);
  text = reorderMarkStacks(text);
  return text;
}

/* -------------------------------------------------------------------------- */
/* Stage 3 — sanitizeOpenXmlNodes                                              */
/* -------------------------------------------------------------------------- */

/**
 * Sanitizes a string so it can be injected into an OpenXML (`.docx`) node such
 * as `<w:t xml:space="preserve">...</w:t>` or an attribute value without
 * breaking the document.
 *
 * Behavior:
 *
 * - Characters that are illegal in XML 1.0 (controls, lone surrogates) and
 *   invisible/zero-width characters are removed everywhere, then the input is
 *   NFC-normalized.
 * - **Plain text input** (no tags): each text segment is entity-decoded,
 *   Thai-cluster-repaired, whitespace-collapsed and XML-escaped — so
 *   `A & B` becomes `A &amp; B` and `5 < 6` becomes `5 &lt; 6`.
 * - **Markup input**: well-formed tags (comments, doctypes, elements) are
 *   preserved untouched while only the text between them is processed. Existing
 *   valid XML references (`&amp;`, `&#160;`, ...) are never double-escaped;
 *   stray `&` characters inside tags are escaped and non-XML HTML entities such
 *   as `&nbsp;` are rewritten to numeric references.
 * - With `stripMarkup: true`, all tags are removed first and the entire result
 *   is treated as plain text (ideal for HTML-tainted payloads).
 *
 * @param xmlString - Plain text or an OpenXML/HTML fragment.
 * @param options - See {@link SanitizeOpenXmlOptions}.
 * @returns A string that is safe to place inside an XML node.
 *
 * @example
 * ```ts
 * sanitizeOpenXmlNodes('ยอดรวม 1,200 & 3,500');
 * // => 'ยอดรวม 1,200 &amp; 3,500'
 *
 * sanitizeOpenXmlNodes('<w:t>ก้ั</w:t>');
 * // => '<w:t>กั้</w:t>'  (text repaired, markup preserved)
 *
 * sanitizeOpenXmlNodes('<p>สวัสดี</p>', { stripMarkup: true });
 * // => 'สวัสดี'
 * ```
 */
export function sanitizeOpenXmlNodes(xmlString: string, options: SanitizeOpenXmlOptions = {}): string {
  if (!xmlString) return '';

  const { stripMarkup = false, fixVowels = true, collapseWhitespace: collapse = true, escape = true } =
    options;

  // Pass 1: remove XML-illegal and invisible characters from the whole input
  // (markup included), then normalize.
  let text = removeUnsafeChars(xmlString);
  text = text.normalize('NFC');

  if (stripMarkup) {
    const cleaned = fixVowels ? fixThaiFloatingVowels(cleanThaiDocxText(text)) : cleanThaiDocxText(text);
    return escape ? escapeXml(cleaned) : cleaned;
  }

  const processTextSegment = (raw: string): string => {
    let segment = decodeHtmlEntities(raw);
    segment = removeUnsafeChars(segment);
    segment = segment.normalize('NFC');
    if (fixVowels) segment = fixThaiFloatingVowels(segment);
    if (collapse) segment = collapseWhitespace(segment);
    return escape ? escapeXml(segment) : segment;
  };

  const processMarkupSegment = (raw: string): string => {
    // Rewrite HTML-only entities to numeric references (safe inside tags), then
    // escape any ampersand that does not start a valid XML reference.
    const withNumericRefs = raw.replace(MARKUP_ENTITY_RE, (whole, name: string) => {
      const codePoint = NAMED_ENTITIES[name.toLowerCase()]?.codePointAt(0);
      return codePoint === undefined ? whole : `&#${codePoint};`;
    });
    return withNumericRefs.replace(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#[xX][0-9A-Fa-f]+;)/g, '&amp;');
  };

  const parts: string[] = [];
  let cursor = 0;
  MARKUP_SEGMENT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MARKUP_SEGMENT_RE.exec(text)) !== null) {
    if (match.index > cursor) parts.push(processTextSegment(text.slice(cursor, match.index)));
    parts.push(processMarkupSegment(match[0]));
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) parts.push(processTextSegment(text.slice(cursor)));

  return parts.join('');
}

/* -------------------------------------------------------------------------- */
/* Exports                                                                     */
/* -------------------------------------------------------------------------- */

export const docxThaiCleaner = {
  decodeHtmlEntities,
  cleanThaiDocxText,
  cleanHtmlAndSpecialEntities,
  fixThaiFloatingVowels,
  fixThaiBottomVowels,
  sanitizeOpenXmlNodes,
} as const;

export default docxThaiCleaner;
