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
 * This module exposes six composable stages (plus {@link decodeHtmlEntities}
 * as a standalone utility):
 *
 * 1. {@link cleanThaiDocxText}  — strip leaked markup, invisible characters,
 *    normalize to NFC, tidy whitespace and space ไม้ยมก (ๆ) correctly.
 * 2. {@link cleanHtmlAndSpecialEntities} — turn an HTML fragment into plain
 *    text: remove tags and decode named/numeric entities (`&nbsp;`, `&#39;`,
 *    ...).
 * 3. {@link fixThaiFloatingVowels} — re-attach floating combining marks and
 *    restore the canonical Thai cluster stacking order.
 * 4. {@link fixThaiBottomVowels} — repair lower vowels (`ุ ู`) under the
 *    descender consonants `ญ ฐ` (the "ตัดเชิง" cases).
 * 5. {@link sanitizeOpenXmlNodes} — produce output that is safe to inject into
 *    an OpenXML (`<w:t>` / attribute) node.
 * 6. {@link fixMaiYamokSpacing} — normalize the spacing around the
 *    reduplication marker ไม้ยมก (ๆ) to one space on each side.
 *
 * {@link diagnoseThaiText} analyzes a string and reports every category of
 * corruption these stages can repair — a read-only counterpart to the repairs.
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

/**
 * SARA AM (ำ, U+0E33) spelled as its two-part form NIKKAHIT + SARA AA
 * (ํ + า, U+0E4D U+0E32). Unicode never recomposes this sequence on its own:
 * U+0E33 has no canonical decomposition, so NFC/NFD/NFKC all leave the pair
 * untouched — it must be composed explicitly.
 */
const SEPARATED_SARA_AM_RE = /\u0E4D\u0E32/g;

/**
 * A word glued directly to the reduplication marker ไม้ยมก (ๆ, U+0E46), e.g.
 * `ดีๆ`. The Royal Institute convention used by this library puts one space on
 * each side of ๆ (`ดี ๆ`). Also collapses any horizontal whitespace run
 * between the word and ๆ.
 */
const YAMOK_AFTER_WORD_RE = new RegExp(`([^\\s\\u0E46])[ \\t]*\\u0E46`, 'g');

/** Excess spaces between ๆ and the following word (` ๆ   ครับ` → ` ๆ ครับ`). */
const YAMOK_SPACES_BEFORE_NEXT_RE = new RegExp(
  `([ \\t])?(\\u0E46)[ \\t]+(?=[${THAI_CHAR_CLASS}])`,
  'g',
);

/** A word glued directly behind ๆ (` ๆครับ` → ` ๆ ครับ`). */
const YAMOK_GLUED_NEXT_RE = new RegExp(`(\\u0E46)(?=[${THAI_CHAR_CLASS}])`, 'g');

/**
 * Horizontal whitespace that {@link cleanThaiDocxText}'s cleanup stage
 * collapses: runs of two or more spaces/tabs, lone tabs and spaces that trail
 * a line.
 */
const WHITESPACE_ISSUE_RE = /[ \t]{2,}|\t|[ \t]+(?=\r?\n)/g;

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
 * 6. **ไม้ยมก (ๆ) spacing** — one space on each side of the reduplication
 *    marker (`ดีๆ` → `ดี ๆ`) via {@link fixMaiYamokSpacing}.
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
  text = collapseWhitespace(text);
  return fixMaiYamokSpacing(text);
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
 * Drops marks that are duplicated inside a single cluster run — most commonly
 * a doubled tone mark (`ดี๊๊` → `ดี๊`). Only *identical* repeats are removed
 * (the first occurrence is kept): no cluster can ever apply the same mark
 * twice, while the same mark in two neighbouring clusters (`ก่่ก่`) is left
 * alone.
 */
function removeDuplicateMarks(text: string): string {
  if (!text) return text;
  return text.replace(THAI_MARK_RUN_RE, (run) => {
    if (run.length < 2) return run;
    const seen = new Set<string>();
    let output = '';
    for (const char of run) {
      if (seen.has(char)) continue;
      seen.add(char);
      output += char;
    }
    return output;
  });
}

/**
 * Repairs "floating" Thai vowel signs and tone marks so every cluster stacks in
 * the canonical Unicode order.
 *
 * Five repairs are applied:
 *
 * 1. **Compose** SARA AM (ำ, U+0E33) that was spelled as its two-part form
 *    NIKKAHIT + SARA AA (`ํ` + `า` → `ำ`). Unicode never recomposes this
 *    sequence by itself — U+0E33 has no canonical decomposition, so NFC
 *    leaves the pair untouched.
 * 2. **Re-attach** combining marks that were separated from their Thai base by
 *    spaces (`ก ัน` → `กัน`) or zero-width characters (which are stripped
 *    first).
 * 3. **Relocate orphaned marks** that lost their base to the left
 *    (`ัน` → `นั`).
 * 4. **Drop duplicated marks** inside a single cluster — most commonly a
 *    doubled tone mark (`ดี๊๊` → `ดี๊`).
 * 5. **Reorder** marks within each cluster so upper/lower vowels precede
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
 * fixThaiFloatingVowels('ก\u0E4D\u0E32'); // => 'กำ' (SARA AM recomposed)
 * fixThaiFloatingVowels('ดี๊๊');    // => 'ดี๊' (duplicate tone mark dropped)
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
  // The compose must run before relocateOrphanMarks: that pass would otherwise
  // move an orphan ํ behind the following า, producing าํ instead of ำ.
  text = text.replace(SEPARATED_SARA_AM_RE, '\u0E33');
  text = reattachSeparatedMarks(text);
  text = relocateOrphanMarks(text);
  text = removeDuplicateMarks(text);
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
/* Stage 2c — fixMaiYamokSpacing                                               */
/* -------------------------------------------------------------------------- */

/**
 * Normalizes spacing around the reduplication marker ไม้ยมก (ๆ, U+0E46) to the
 * Royal Institute convention of one space on each side:
 *
 * - `ดีๆ` → `ดี ๆ` (word glued in front of ๆ)
 * - `ดีๆครับ` → `ดี ๆ ครับ` (word glued behind ๆ)
 * - `ดี   ๆ` → `ดี ๆ` (excess spaces collapsed)
 *
 * Line breaks are never bridged (`ดี\nๆ` is left alone) and punctuation next to
 * ๆ keeps its place (`ดี ๆ.` stays `ดี ๆ.`). Only spaces and tabs are bridged
 * or collapsed — chain {@link cleanThaiDocxText} first when the text may also
 * contain exotic whitespace (`\u00A0`, ...).
 *
 * @param input - Text that may contain glued or over-spaced ๆ.
 * @returns The text with normalized ๆ spacing. Returns `''` for empty input.
 *
 * @example
 * ```ts
 * fixMaiYamokSpacing('ดีๆครับ');    // => 'ดี ๆ ครับ'
 * fixMaiYamokSpacing('ดี   ๆครับ'); // => 'ดี ๆ ครับ'
 * fixMaiYamokSpacing('ดี ๆ.');     // => 'ดี ๆ.' (unchanged)
 * ```
 *
 * @remarks
 * Runs as the last step of {@link cleanThaiDocxText}'s pipeline.
 * {@link fixThaiFloatingVowels} intentionally leaves spacing alone.
 */
export function fixMaiYamokSpacing(input: string): string {
  if (!input) return '';

  return input
    .replace(YAMOK_AFTER_WORD_RE, '$1 \u0E46')
    .replace(YAMOK_SPACES_BEFORE_NEXT_RE, '$1$2 ')
    .replace(YAMOK_GLUED_NEXT_RE, '$1 ');
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
/* Diagnostics — diagnoseThaiText                                              */
/* -------------------------------------------------------------------------- */

/**
 * Every corruption category {@link diagnoseThaiText} detects. Each one maps to
 * a repair in the pipeline.
 */
export type ThaiDiagnosticIssueType =
  /** HTML entities (`&nbsp;`, `&#39;`, ...) — decoded by {@link cleanThaiDocxText}. */
  | 'htmlEntities'
  /** Leaked HTML/XML markup (`<p>`, comments, doctypes) — stripped by {@link cleanThaiDocxText}. */
  | 'htmlTags'
  /** Zero-width / invisible characters — removed. */
  | 'invisibleChars'
  /** C0/C1 control characters, illegal in XML — removed. */
  | 'controlChars'
  /** Unpaired UTF-16 surrogates — removed. */
  | 'loneSurrogates'
  /** Runs of spaces/tabs (incl. trailing spaces) — collapsed. */
  | 'duplicateWhitespace'
  /** Text that is not in Unicode NFC form — NFC-normalized. */
  | 'needsNfc'
  /** SARA AM spelled as NIKKAHIT + SARA AA (`ํ` + `า`) — composed to `ำ`. */
  | 'separatedSaraAm'
  /** Combining marks separated from their base by spaces — re-attached. */
  | 'floatingMarks'
  /** Combining marks with no base on their left — moved behind the next consonant. */
  | 'orphanMarks'
  /** Duplicated marks inside one cluster (e.g. a doubled tone mark) — removed. */
  | 'duplicateMarks'
  /** Mark runs stacked out of the canonical order (e.g. `ท่ี`) — sorted. */
  | 'stackOrderViolations'
  /** Missing or excess spaces around ไม้ยมก (ๆ) — normalized. */
  | 'maiYamokSpacing';

/** One located occurrence of an issue. */
export interface ThaiDiagnosticSample {
  /**
   * UTF-16 index of the match. Issues detected on a repaired intermediate
   * stage (the Thai mark repairs) report indices relative to that stage, not
   * to the original input.
   */
  index: number;
  /** The matched text itself — may be invisible (e.g. `\u200B`). */
  match: string;
  /**
   * The match inside its surrounding context: the match is wrapped in `[...]`,
   * invisible/control characters are rendered as `\uXXXX` escapes and `…`
   * marks truncated edges.
   */
  excerpt: string;
}

/** A detected issue together with its occurrences. */
export interface ThaiDiagnosticIssue {
  /** Machine-readable category. */
  type: ThaiDiagnosticIssueType;
  /** Human-readable explanation of the issue and its repair. */
  message: string;
  /** Number of occurrences in the whole text. */
  count: number;
  /** The first few occurrences (up to five), earliest first. */
  samples: ThaiDiagnosticSample[];
}

/** Report returned by {@link diagnoseThaiText}. */
export interface ThaiCleanDiagnostic {
  /** UTF-16 length of the input string. */
  length: number;
  /** `true` when no issue was found. */
  isClean: boolean;
  /** Sum of every issue's `count`. */
  issueCount: number;
  /** Occurrences per category — every category is present, `0` when not found. */
  counts: Readonly<Record<ThaiDiagnosticIssueType, number>>;
  /** Only the categories that were found, in detection order. */
  issues: readonly ThaiDiagnosticIssue[];
  /**
   * The input after the full repair pipeline
   * (`cleanThaiDocxText` → `fixThaiFloatingVowels` → `fixThaiBottomVowels`).
   */
  cleaned: string;
}

/** Number of samples attached to each detected issue. */
const DIAGNOSTIC_SAMPLE_LIMIT = 5;

/** Detection order of every {@link ThaiDiagnosticIssueType}. */
const DIAGNOSTIC_ORDER: readonly ThaiDiagnosticIssueType[] = [
  'htmlEntities',
  'htmlTags',
  'invisibleChars',
  'controlChars',
  'loneSurrogates',
  'duplicateWhitespace',
  'needsNfc',
  'separatedSaraAm',
  'floatingMarks',
  'orphanMarks',
  'duplicateMarks',
  'stackOrderViolations',
  'maiYamokSpacing',
];

/** Explanation per issue type. */
const DIAGNOSTIC_MESSAGES: Readonly<Record<ThaiDiagnosticIssueType, string>> = Object.freeze({
  htmlEntities: 'HTML entities — decoded by cleanThaiDocxText.',
  htmlTags: 'Leaked HTML/XML markup — stripped by cleanThaiDocxText.',
  invisibleChars: 'Zero-width/invisible characters — removed (they break Word syllable rendering).',
  controlChars: 'Control characters that are illegal in XML — removed.',
  loneSurrogates: 'Unpaired UTF-16 surrogates — removed.',
  duplicateWhitespace: 'Runs of spaces/tabs (incl. trailing spaces) — collapsed to one space.',
  needsNfc: 'Text is not in Unicode NFC form — NFC-normalized.',
  separatedSaraAm:
    'SARA AM spelled as NIKKAHIT + SARA AA (ํ + า); NFC never recomposes it — composed to ำ.',
  floatingMarks: 'Combining marks separated from their base by spaces — re-attached.',
  orphanMarks: 'Combining marks with no base on their left — moved behind the next consonant.',
  duplicateMarks: 'Duplicated marks inside one cluster (e.g. a doubled tone mark) — removed.',
  stackOrderViolations: 'Mark runs stacked out of canonical order (e.g. ท่ี) — sorted.',
  maiYamokSpacing: 'Spacing around ไม้ยมก (ๆ) — normalized to one space on each side.',
});

/** A match reduced to what diagnostics need. */
interface LocatedMatch {
  index: number;
  match: string;
}

const toLocated = (matches: RegExpExecArray[]): LocatedMatch[] =>
  matches.map((match) => ({ index: match.index, match: match[0] }));

/** Collects every match of `re` in `text` using a fresh, lastIndex-free clone. */
function collectMatches(re: RegExp, text: string): RegExpExecArray[] {
  if (!text) return [];
  const local = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  const matches: RegExpExecArray[] = [];
  let match: RegExpExecArray | null;
  while ((match = local.exec(text)) !== null) {
    matches.push(match);
  }
  return matches;
}

/** Characters rendered as `\uXXXX` escapes inside diagnostic excerpts. */
const EXCERPT_ESCAPE_RE = new RegExp(`${INVISIBLE_CLASS}|${CONTROL_CHARS_CLASS}|\\r|\\n|\\t`, 'g');

/** Escapes invisible characters and line breaks so an excerpt stays one line. */
function escapeUnprintable(text: string): string {
  return text.replace(EXCERPT_ESCAPE_RE, (char) => {
    const code = char.codePointAt(0) ?? 0;
    return `\\u${code.toString(16).toUpperCase().padStart(4, '0')}`;
  });
}

/** Builds the excerpt of a match, wrapping the match itself in `[...]`. */
function makeExcerpt(text: string, index: number, matchLength: number): string {
  const CONTEXT = 16;
  const start = Math.max(0, index - CONTEXT);
  const end = Math.min(text.length, index + matchLength + CONTEXT);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return (
    prefix +
    escapeUnprintable(text.slice(start, index)) +
    `[${escapeUnprintable(text.slice(index, index + matchLength))}]` +
    escapeUnprintable(text.slice(index + matchLength, end)) +
    suffix
  );
}

/** The first {@link DIAGNOSTIC_SAMPLE_LIMIT} samples of a match list. */
function makeSamples(text: string, matches: LocatedMatch[]): ThaiDiagnosticSample[] {
  return matches.slice(0, DIAGNOSTIC_SAMPLE_LIMIT).map(({ index, match }) => ({
    index,
    match,
    excerpt: makeExcerpt(text, index, match.length),
  }));
}

/** Whether an entity reference decodes (mirrors {@link decodeHtmlEntities}). */
function isDecodableEntity(match: RegExpExecArray): boolean {
  const [, name, decimal, hex] = match;
  if (name !== undefined) return NAMED_ENTITIES[name] !== undefined;
  const codePoint = decimal !== undefined ? Number.parseInt(decimal, 10) : Number.parseInt(hex, 16);
  return (
    Number.isInteger(codePoint) &&
    codePoint > 0 &&
    codePoint <= 0x10ffff &&
    !(codePoint >= 0xd800 && codePoint <= 0xdfff)
  );
}

/** Orphan marks with a usable base ahead — the ones the orphan pass repairs. */
function collectRepairableOrphans(text: string): RegExpExecArray[] {
  return collectMatches(ORPHAN_MARK_RE, text).filter((match) => {
    const afterMarks = match.index + match[0].length;
    const target = /^[ \t]*([\u0E00-\u0E7F])/.exec(text.slice(afterMarks));
    return target !== null && isThaiChar(target[1]) && !isThaiMark(target[1]);
  });
}

/** Mark runs containing duplicated marks, plus how many marks would be dropped. */
function collectDuplicateMarkRuns(text: string): { runs: RegExpExecArray[]; removed: number } {
  const runs: RegExpExecArray[] = [];
  let removed = 0;
  for (const match of collectMatches(THAI_MARK_RUN_RE, text)) {
    const unique = new Set(match[0]).size;
    if (unique < match[0].length) {
      removed += match[0].length - unique;
      runs.push(match);
    }
  }
  return { runs, removed };
}

/** Mark runs whose ranks are not in non-decreasing canonical order. */
function collectUnorderedMarkRuns(text: string): RegExpExecArray[] {
  return collectMatches(THAI_MARK_RUN_RE, text).filter((match) => {
    let previous = -1;
    for (const char of match[0]) {
      const rank = markRank(char);
      if (rank < previous) return true;
      previous = rank;
    }
    return false;
  });
}

/** ๆ positions that are not separated from their surroundings by one space. */
function collectMaiYamokIssues(text: string): LocatedMatch[] {
  const issues: LocatedMatch[] = [];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '\u0E46') continue;
    const before = index > 0 ? text[index - 1] : '';
    const after = index + 1 < text.length ? text[index + 1] : '';
    const gluedBefore = before !== '' && !/\s/.test(before);
    const gluedAfter = THAI_CHAR_RE.test(after);
    if (gluedBefore || gluedAfter) issues.push({ index, match: '\u0E46' });
  }
  return issues;
}

/**
 * Analyzes text and reports every category of corruption the pipeline can
 * repair — without modifying the input.
 *
 * Detection mirrors the repair pipeline stage by stage, so one defect is never
 * reported twice: `ก ัน` counts once as a floating mark (not also as an orphan
 * mark), `ดี   ๆ` counts as excess whitespace (not as a ไม้ยมก spacing issue)
 * and `ํา` counts as a separated SARA AM (not as an orphan nikkahit).
 *
 * @param text - Raw text to analyze (HTML leaks, copy/paste artifacts and all).
 * @returns A {@link ThaiCleanDiagnostic}: per-category occurrence counts,
 *   located samples and the fully repaired `cleaned` text.
 *
 * @example
 * ```ts
 * const report = diagnoseThaiText('สวัสดี\u200Bครับ ดีๆ กำ');
 * report.isClean;                // => false
 * report.counts.invisibleChars;  // => 1
 * report.counts.maiYamokSpacing; // => 1
 * report.counts.separatedSaraAm; // => 1
 * report.issues[0].samples[0];   // => { index: 6, match: '\u200B', excerpt: ... }
 * report.cleaned;                // => 'สวัสดีครับ ดี ๆ กำ'
 * ```
 */
export function diagnoseThaiText(text: string): ThaiCleanDiagnostic {
  const counts: Record<ThaiDiagnosticIssueType, number> = {
    htmlEntities: 0,
    htmlTags: 0,
    invisibleChars: 0,
    controlChars: 0,
    loneSurrogates: 0,
    duplicateWhitespace: 0,
    needsNfc: 0,
    separatedSaraAm: 0,
    floatingMarks: 0,
    orphanMarks: 0,
    duplicateMarks: 0,
    stackOrderViolations: 0,
    maiYamokSpacing: 0,
  };
  const found = new Map<ThaiDiagnosticIssueType, LocatedMatch[]>();
  const locate = (
    type: ThaiDiagnosticIssueType,
    matches: LocatedMatch[],
    count: number = matches.length,
  ): void => {
    if (count === 0) return;
    counts[type] = count;
    found.set(type, matches);
  };

  if (text) {
    // --- Garbage measured on the raw input ---------------------------------
    locate(
      'htmlEntities',
      toLocated(collectMatches(NAMED_OR_NUMERIC_ENTITY_RE, text).filter(isDecodableEntity)),
    );
    locate('htmlTags', toLocated(collectMatches(HTML_TAG_RE, text)));
    locate('invisibleChars', toLocated(collectMatches(new RegExp(INVISIBLE_CLASS, 'g'), text)));
    locate('controlChars', toLocated(collectMatches(new RegExp(CONTROL_CHARS_CLASS, 'g'), text)));
    locate(
      'loneSurrogates',
      toLocated(
        [...collectMatches(LONE_HIGH_SURROGATE_RE, text), ...collectMatches(LONE_LOW_SURROGATE_RE, text)].sort(
          (a, b) => a.index - b.index,
        ),
      ),
    );
    locate('duplicateWhitespace', toLocated(collectMatches(WHITESPACE_ISSUE_RE, text)));
    if (text.normalize('NFC') !== text) {
      counts.needsNfc = 1;
      found.set('needsNfc', []);
    }

    // --- Thai cluster issues, mirrored stage by stage ----------------------
    let stage = removeUnsafeChars(decodeHtmlEntities(text));

    locate('separatedSaraAm', toLocated(collectMatches(SEPARATED_SARA_AM_RE, stage)));
    stage = stage.replace(SEPARATED_SARA_AM_RE, '\u0E33');

    locate('floatingMarks', toLocated(collectMatches(MARK_BEFORE_MARK_RE, stage)));
    stage = reattachSeparatedMarks(stage);

    locate('orphanMarks', toLocated(collectRepairableOrphans(stage)));
    stage = relocateOrphanMarks(stage);

    const { runs: duplicateRuns, removed } = collectDuplicateMarkRuns(stage);
    locate('duplicateMarks', toLocated(duplicateRuns), removed);
    stage = removeDuplicateMarks(stage);

    locate('stackOrderViolations', toLocated(collectUnorderedMarkRuns(stage)));

    locate('maiYamokSpacing', collectMaiYamokIssues(stage));
  }

  const issues: ThaiDiagnosticIssue[] = DIAGNOSTIC_ORDER.filter((type) => counts[type] > 0).map(
    (type) => ({
      type,
      message: DIAGNOSTIC_MESSAGES[type],
      count: counts[type],
      samples: makeSamples(text, found.get(type) ?? []),
    }),
  );
  const issueCount = DIAGNOSTIC_ORDER.reduce((total, type) => total + counts[type], 0);

  return {
    length: text.length,
    isClean: issueCount === 0,
    issueCount,
    counts: Object.freeze({ ...counts }),
    issues,
    cleaned: fixThaiBottomVowels(fixThaiFloatingVowels(cleanThaiDocxText(text))),
  };
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
  fixMaiYamokSpacing,
  sanitizeOpenXmlNodes,
  diagnoseThaiText,
} as const;

export default docxThaiCleaner;
