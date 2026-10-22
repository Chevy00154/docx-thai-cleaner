🌐 Language / ภาษา: **English** | [ภาษาไทย](README.th.md)

# docx-thai-cleaner

[![CI](https://github.com/Chevy00154/docx-thai-cleaner/actions/workflows/ci.yml/badge.svg)](https://github.com/Chevy00154/docx-thai-cleaner/actions/workflows/ci.yml)

> Production-grade Thai text sanitizer for `.docx` / OpenXML pipelines.

`docx-thai-cleaner` takes Thai text that has been mangled by real-world sources —
scraped HTML, PDF extraction, copy/paste from the web, broken OCR — and returns
text that is correct and safe to write into a Word document.

- **Zero runtime dependencies**, fully typed, tree-shakeable.
- **Diagnoses before it cleans** — `diagnoseThaiText` reports every problem it
  finds (tags, zero-width spaces, scrambled marks, split SARA AM, `ๆ` spacing)
  with located samples.
- Ships **ESM + CJS** builds, TypeScript declarations and a small **CLI**.
- Tested with [Vitest](https://vitest.dev/) against realistic Thai strings.
- **GitHub Actions CI** — tests and build on Node.js 18 and 20 for every push to `main`.
- MIT licensed.

## Why Thai text breaks in Word

| Problem | Example | What you get |
| --- | --- | --- |
| Leaked HTML tags inside paragraphs | `<p>สวัสดีครับ</p>` | `สวัสดีครับ` |
| Zero-width space splitting a syllable | `ก​ัน` | `กัน` |
| Soft hyphen / BOM glued into text | `ข้อ­ความ`, `﻿เริ่มต้น` | `ข้อความ`, `เริ่มต้น` |
| Floating vowel sign pushed off its consonant | `ก ัน` | `กัน` |
| Tone mark stacked **before** the vowel | `ท่ี` | `ที่` |
| Raw text injected into `<w:t>` | `ยอด & สว่นลด` | `ยอด &amp; สว่นลด` |
| Lower vowel drifted off a descender consonant | `กตัญ ู` | `กตัญู` |
| SARA AM split into `ํ` + `า` | `กำ` | `กำ` |
| Duplicated tone mark in one cluster | `ดี๊๊` | `ดี๊` |
| Word glued to ไม้ยมก `ๆ` | `เร็วๆ` | `เร็ว ๆ` |

Run `diagnoseThaiText` to get a full report of **every** problem found (see
[Diagnosing a string](#diagnosing-a-string-diagnosethaitext)).

## Installation

```bash
npm install docx-thai-cleaner
```

Requires Node.js ≥ 18.

## Quick start

```ts
import {
  cleanHtmlAndSpecialEntities,
  cleanThaiDocxText,
  diagnoseThaiText,
  fixThaiBottomVowels,
  fixThaiFloatingVowels,
  fixMaiYamokSpacing,
  sanitizeOpenXmlNodes,
} from 'docx-thai-cleaner';

const raw = '<p>สวัสด​ีครับ</p>';

const cleaned = cleanThaiDocxText(raw);        // 'สวัสดีครับ'  (tags, ZWSP, spacing gone)
const repaired = fixThaiFloatingVowels('ท่ี');  // 'ที่'          (canonical stacking order)
const spaced  = fixMaiYamokSpacing('เร็วๆ');    // 'เร็ว ๆ'       (one space each side of ๆ)
const nodeReady = sanitizeOpenXmlNodes('A & B'); // 'A &amp; B'  (safe for <w:t> / attributes)

// Dedicated helpers for HTML fragments and descender vowels (ญ/ฐ):
const plain  = cleanHtmlAndSpecialEntities('<p>&nbsp;ราคา 1,000 บาท</p>'); // 'ราคา 1,000 บาท'
const joined = fixThaiBottomVowels('กตัญ ู');                               // 'กตัญู'

// See exactly what is wrong with a string, without changing it:
const report = diagnoseThaiText('เร็วๆ');
console.log(report.counts.maiYamokSpacing); // 1
console.log(report.cleaned);                // 'เร็ว ๆ'
```

## API

### `decodeHtmlEntities(input: string): string`

Standalone utility (also used internally by every cleaning stage) — decode HTML
entities into the characters they represent, **exactly once** per WHATWG HTML
parsing rules (`&amp;#39;` → literal `&#39;`, never double-decoded):

- named entities (`&nbsp;`, `&amp;`, `&quot;`, `&lt;`, `&gt;`, `&apos;` plus
  typographic `&mdash;`, `&hellip;`, `&lsquo;`, ...)
- numeric references, decimal (`&#39;`) and hex (`&#x27;`)
- unknown names are left untouched

```ts
decodeHtmlEntities('Tom &amp; Jerry &lt;3 &#65;'); // => 'Tom & Jerry <3 A'
```

`&nbsp;` decodes to a real no-break space (U+00A0); the whitespace cleanup in
the stages below turns it into an ordinary space.

### `cleanThaiDocxText(input: string): string`

Stage 1 — content cleanup. Runs, in order:

1. **Decode HTML entities** — `&nbsp;`, `&amp;`, `&#39;`, `&#x200B;`, ... are
   expanded exactly once via `decodeHtmlEntities` (unknown names are kept
   literally).
2. **Strip leaked markup** — comments, CDATA, doctypes, processing instructions
   and tags (`<p>`, `<span class="x">`, `<br/>`, ...). Because entities are
   decoded first, escaped markup (`&lt;b&gt;`) is also recognized and removed.
   A mathematical `5 < 6` is left alone.
3. **Drop invisible/illegal characters** — every character exported as
   `INVISIBLE_CHARS` (ZWSP, ZWNJ, ZWJ, soft hyphen, BOM, bidi controls),
   C0/C1 controls (except tab/LF/CR), Unicode non-characters and lone surrogates.
4. **Unicode NFC normalization** — `e + U+0301` → `é`, Thai text stays stable.
5. **Whitespace cleanup** — CRLF → LF, runs of spaces/tabs → one space, trimmed
   lines, at most one blank line, trimmed ends.
6. **ไม้ยมก (ๆ) spacing** — one space on each side of the reduplication marker
   via `fixMaiYamokSpacing` (`ดีๆ` → `ดี ๆ`, `ดีๆครับ` → `ดี ๆ ครับ`).

```ts
cleanThaiDocxText('<p>สวัสดี   ครับ</p>'); // => 'สวัสดี ครับ'
cleanThaiDocxText('ก​ัน');           // => 'กัน'
cleanThaiDocxText('น้ำ &amp; ดิน');         // => 'น้ำ & ดิน'
cleanThaiDocxText('วิ่งเร็วๆ ครับ');       // => 'วิ่งเร็ว ๆ ครับ'
```

### `cleanHtmlAndSpecialEntities(input: string): string`

Stage 1b — turn an HTML fragment into plain text.

- Real tags, comments, doctypes and CDATA are removed (`<p>x</p>` → `x`).
  Escaped tags in the source are decoded to literal text, exactly as a browser
  renders them (`&lt;b&gt;` → `<b>`).
- Named entities (`&nbsp;`, `&amp;`, `&quot;`, `&#39;`, `&apos;` plus
  typographic `&mdash;`, `&hellip;`, `&lsquo;`, ...) and numeric references
  (decimal `&#39;` and hex `&#x27;`) are decoded **once** — `&amp;#39;`
  correctly yields the literal text `&#39;`.
- `&nbsp;`, `&#160;` and `&#xA0;` become ordinary spaces, then whitespace is
  collapsed and trimmed.

```ts
cleanHtmlAndSpecialEntities('<p>&nbsp;ราคา&nbsp;1,000&nbsp;บาท&nbsp;&amp;&nbsp;ลด 50%</p>');
// => 'ราคา 1,000 บาท & ลด 50%'

cleanHtmlAndSpecialEntities('&lt;p&gt;ตัวอักษร&lt;/p&gt;'); // => '<p>ตัวอักษร</p>'
```

### `fixThaiFloatingVowels(input: string): string`

Stage 2 — Thai cluster repair. Five passes:

1. **Compose SARA AM** that was spelled as its two-part form NIKKAHIT + SARA AA
   (`ํ` + `า` → `ำ`). Unicode's NFC cannot do this — U+0E33 has no canonical
   decomposition, so the pair survives normalization untouched.
2. **Re-attach** combining marks that were pushed away from their Thai base by
   spaces (`ก ัน` → `กัน`) or zero-width characters (stripped first).
3. **Relocate orphaned marks** that lost their base entirely (`ัน` → `นั`).
4. **Drop duplicated marks** inside one cluster — most commonly a doubled tone
   mark (`ดี๊๊` → `ดี๊`).
5. **Reorder** every mark run into the canonical stacking order —
   upper vowels → lower vowels → `็` mai taikhu → tone marks `่ ้ ๊ ๋` →
   `์ ํ ๎` — using a stable sort (`ท่ี` → `ที่`, `ป๊ั` → `ปั๊`).

Correctly written text passes through unchanged, including the tricky cases:
`เมื่อ`, `เดี๋ยว`, `กี่`, and `น้ำ` (whose tone mark legitimately precedes the
spacing character `ำ`).

```ts
fixThaiFloatingVowels('พร ุ่งนี้ ฉ ัน จะ ไป ท ี่ ห้าง');
// => 'พรุ่งนี้ ฉัน จะ ไป ที่ ห้าง'

fixThaiFloatingVowels('กำ');  // => 'กำ'   (ํ + า composed)
fixThaiFloatingVowels('ดี๊๊');   // => 'ดี๊'  (duplicate tone mark dropped)
```

> **Note:** preposed vowels (`เ แ โ ใ ไ`) are never reordered. A consonant
> directly followed by `เ` is legitimate across word boundaries
> (`...กินเขา`), so any such rewrite would be ambiguous.

### `fixThaiBottomVowels(input: string): string`

Stage 2b — repair lower vowels (`ุ` U+0E38, `ู` U+0E39) under the descender
consonants `ญ` (U+0E0D) and `ฐ` (U+0E10) — the *ตัดเชิง* (descender-cut)
cases. In correct Thai the vowel is stored directly after its consonant and
the font cuts the descender and shifts the vowel right, so real words such as
`กตัญญู` pass through unchanged. Sources that fake that shift manually are
repaired:

- zero-width spacers glued between consonant and vowel (`ญ\u200Bุ` → `ญุ`),
- vowels stored before their base (`ุญ` → `ญุ`),
- vowels detached from their base by spaces (`กตัญ ู` → `กตัญู`),
- scrambled stacking — the vowel lands before the tone mark, in canonical
  order (`กตัญ ู ้` → `กตัญู้`).

```ts
fixThaiBottomVowels('กตัญ ู');    // => 'กตัญู'
fixThaiBottomVowels('ก ต ั ญ ู'); // => 'ก ตั ญู' (upper vowels: chain fixThaiFloatingVowels)
fixThaiBottomVowels('กตัญญู');    // => 'กตัญญู' (unchanged)
```

The repair is deliberately scoped to *bottom* vowels; chain
`fixThaiFloatingVowels` for a complete mark repair.

### `fixMaiYamokSpacing(input: string): string`

Stage 2c — normalize the spacing around the reduplication marker **ไม้ยมก**
(`ๆ`, U+0E46) to the Royal Institute convention of **one space on each side**:

- `ดีๆ` → `ดี ๆ` (word glued in front of ๆ)
- `ดีๆครับ` → `ดี ๆ ครับ` (word glued behind ๆ)
- `ดี   ๆ` → `ดี ๆ` (excess spaces collapsed)

Line breaks are never bridged (`ดี\nๆ` is left alone) and punctuation keeps its
place (`ดี ๆ.` stays `ดี ๆ.`). Runs as the last step of
`cleanThaiDocxText`; `fixThaiFloatingVowels` intentionally leaves spacing
alone.

```ts
fixMaiYamokSpacing('ดีๆครับ');    // => 'ดี ๆ ครับ'
fixMaiYamokSpacing('ดี   ๆครับ'); // => 'ดี ๆ ครับ'
fixMaiYamokSpacing('ดี ๆ.');     // => 'ดี ๆ.' (unchanged)
```

### `diagnoseThaiText(input: string): ThaiCleanDiagnostic`

Diagnosing a string — inspect text **without changing it** and get a full
report of every category of corruption the pipeline can repair. Detection
mirrors the repair stages, so a defect is never counted twice (`ก ัน` is one
floating mark, not also an orphan mark; `ดี   ๆ` is excess whitespace, not a
`ๆ`-spacing issue).

```ts
export interface ThaiCleanDiagnostic {
  length: number;                                                       // UTF-16 length of the input
  isClean: boolean;                                                     // true when nothing was found
  issueCount: number;                                                   // sum of every issue's count
  counts: Readonly<Record<ThaiDiagnosticIssueType, number>>;            // occurrences per category
  issues: readonly ThaiDiagnosticIssue[];                               // found categories only
  cleaned: string;                                                      // input after the full repair pipeline
}

export interface ThaiDiagnosticIssue {
  type: ThaiDiagnosticIssueType;   // e.g. 'invisibleChars', 'separatedSaraAm', 'maiYamokSpacing'
  message: string;                 // human-readable explanation + repair
  count: number;                   // occurrences in the whole text
  samples: ThaiDiagnosticSample[]; // up to 5 located examples
}

export interface ThaiDiagnosticSample {
  index: number;   // UTF-16 position of the match
  match: string;   // the matched text (may be invisible, e.g. '\u200B')
  excerpt: string; // the match in context, invisible characters escaped
}
```

`ThaiDiagnosticIssueType` covers: `htmlEntities`, `htmlTags`, `invisibleChars`,
`controlChars`, `loneSurrogates`, `duplicateWhitespace`, `needsNfc`,
`separatedSaraAm`, `floatingMarks`, `orphanMarks`, `duplicateMarks`,
`stackOrderViolations` and `maiYamokSpacing`.

```ts
const report = diagnoseThaiText('สวัสดี​ครับ ดีๆ กำ');

report.isClean;                // => false
report.counts.invisibleChars;  // => 1
report.counts.maiYamokSpacing; // => 1
report.counts.separatedSaraAm; // => 1

report.issues[0].samples[0];   // => { index: 6, match: '\u200B', excerpt: 'สวัสดี[\u200B]ครับ' }
report.cleaned;                // => 'สวัสดีครับ ดี ๆ กำ'
```

A common pattern is to log the report and then ship the repaired text:

```ts
const report = diagnoseThaiText(input);
if (!report.isClean) {
  console.warn('Thai cleanup:', report.issues.map((i) => `${i.type}×${i.count}`));
}
const output = report.cleaned; // ready for a <w:t> node or a docx paragraph
```

### `sanitizeOpenXmlNodes(xmlString, options?): string`

Stage 3 — make a string injectable into an OpenXML node.

```ts
interface SanitizeOpenXmlOptions {
  stripMarkup?: boolean;        // remove all tags, treat input as text   (default: false)
  fixVowels?: boolean;          // repair Thai clusters in text segments  (default: true)
  collapseWhitespace?: boolean; // tidy spacing in text segments          (default: true)
  escape?: boolean;             // XML-escape &, <, >, ", '              (default: true)
}
```

- Characters illegal in XML 1.0 and all invisible characters are removed
  everywhere (markup included), then the input is NFC-normalized.
- **Plain text** input is entity-decoded, repaired, collapsed and escaped:
  `5 < 6` → `5 &lt; 6`.
- **Markup input** keeps well-formed tags byte-for-byte while only the text
  between them is processed. Valid XML references (`&amp;`, `&#160;`) are never
  double-escaped; stray ampersands inside tags are escaped; non-XML HTML
  entities inside attributes (`&nbsp;`) become numeric references.

```ts
sanitizeOpenXmlNodes('<w:r><w:t>ก้ั</w:t></w:r>');
// => '<w:r><w:t>กั้</w:t></w:r>'

sanitizeOpenXmlNodes('<p>แท็ก &amp; ข้อความ</p>', { stripMarkup: true });
// => 'แท็ก &amp; ข้อความ'
```

## Recipes

### Generate a `.docx` with the [`docx`](https://www.npmjs.com/package/docx) library

```ts
import { writeFileSync } from 'node:fs';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { cleanThaiDocxText, fixThaiFloatingVowels } from 'docx-thai-cleaner';

// Text scraped from HTML or an API — tags, ZWSP and scrambled marks included.
const rawParagraphs = ['<p>สวัสดี​ครับ</p>', '<p>ท ี่ คือ คำตอบ</p>'];

const prepare = (text: string): string => fixThaiFloatingVowels(cleanThaiDocxText(text));

const doc = new Document({
  sections: [
    {
      children: rawParagraphs.map(
        (raw) => new Paragraph({ children: [new TextRun(prepare(raw))] }),
      ),
    },
  ],
});

writeFileSync('output.docx', await Packer.toBuffer(doc));
```

`docx` escapes XML for you, so use the cleaning stages — not
`sanitizeOpenXmlNodes` — when you go through its API.

### Turn a CMS/HTML export into clean Thai text

```ts
import {
  cleanHtmlAndSpecialEntities,
  fixThaiBottomVowels,
  fixThaiFloatingVowels,
} from 'docx-thai-cleaner';

const fromCms = '<p>&nbsp;เปล ี ่ยน &amp; กตัญ ู</p>';

const text = fixThaiBottomVowels(fixThaiFloatingVowels(cleanHtmlAndSpecialEntities(fromCms)));
// => 'เปลี่ยน & กตัญู'
```

### Inject sanitized text directly into an OOXML snippet

```ts
import { sanitizeOpenXmlNodes } from 'docx-thai-cleaner';

const userText = 'ยอด & สว่นลด 50%'; // from a form, CMS or API
const runXml = `<w:r><w:t xml:space="preserve">${sanitizeOpenXmlNodes(userText)}</w:t></w:r>`;
// <w:r><w:t xml:space="preserve">ยอด &amp; สว่นลด 50%</w:t></w:r>
```

### Use with `python-docx` (bundled CLI)

The package ships a `docx-thai-cleaner` executable — a Unix-style filter that
reads arguments or stdin and writes the result to stdout unchanged. Python
processes text, Node does the Thai-specific repair:

```python
import subprocess
from docx import Document

def clean_thai(text: str) -> str:
    result = subprocess.run(
        ["docx-thai-cleaner", "--mode", "clean", "-"],
        input=text,
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout  # python-docx performs its own XML escaping

doc = Document()
for line in ["<p>สวัสดี​ครับ</p>", "<p>ท่ี คือ คำตอบ</p>"]:
    doc.add_paragraph(clean_thai(line))
doc.save("output.docx")
```

```sh
# CLI usage
docx-thai-cleaner '<p>สวัสดี   ครับ</p>'        # mode: clean (default)
cat raw.txt | docx-thai-cleaner --mode fix        # mode: fix
docx-thai-cleaner --mode sanitize 'A & B'         # mode: sanitize
docx-thai-cleaner --mode sanitize --strip-markup '<p>ข้อความ</p>'
```

## How it works

Thai combining marks must be stored after their base consonant in a fixed order:
vowel signs first, then tone marks. Browsers, OCR engines and HTML scrapers
routinely violate this, which makes Word render vowels on the wrong consonant
and tone marks floating above the wrong syllable.

`fixThaiFloatingVowels` enforces the order defined by the Unicode Standard
(Thai orthography):

```
base + upper vowels (ั ิ ึ ื) + lower vowels (ุ ู) + ็ + tones (่ ้ ๊ ๋) + (์ ํ ๎)
```

Everything else — preposed vowels, spacing vowels (`ำ ะ า`), word spaces and
line breaks — is left where it belongs, so correct text is never rewritten.

Descender consonants (`ญ`, `ฐ`) get the same treatment for *lower* vowels:
`fixThaiBottomVowels` restores the canonical `consonant → vowel → tone`
sequence (`กตัญ ู` → `กตัญู`, `กตัญ ู ้` → `กตัญู้`) and lets the font's own
descender-cut shaping do the rest.

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit over sources + tests
npm test            # vitest run
npm run build       # ESM -> dist/, CJS -> dist/cjs/, .d.ts, CLI finalizer
```

Project layout:

```
.github/workflows/ci.yml   GitHub Actions CI (Node 18 & 20)
src/index.ts               the sanitizer stages + diagnoseThaiText
src/cli.ts                 command-line filter
src/__tests__/cleaner.test.ts
dist/                      build output (ESM + CJS + types)
```

Contributions are welcome — please open an issue first to discuss larger
changes, and add tests for any new behavior.

## License

[MIT](LICENSE) © Chevy00154
