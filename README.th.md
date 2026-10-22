🌐 Language / ภาษา: [English](README.md) | **ภาษาไทย**

# docx-thai-cleaner

[![CI](https://github.com/Chevy00154/docx-thai-cleaner/actions/workflows/ci.yml/badge.svg)](https://github.com/Chevy00154/docx-thai-cleaner/actions/workflows/ci.yml)

> เครื่องมือทำความสะอาดข้อความภาษาไทยระดับ Production สำหรับไฟล์ `.docx` / OpenXML

`docx-thai-cleaner` รับข้อความภาษาไทยที่ถูกทำลายจากแหล่งข้อมูลจริง — HTML ที่ scrape มา, การสกัดจาก PDF, copy/paste จากเว็บ, OCR ที่เพี้ยน — แล้วส่งคืนข้อความที่ถูกต้องและปลอดภัยสำหรับนำไปเขียนลงเอกสาร Word

## คุณสมบัติเด่น

- **ไม่มี runtime dependencies** ใด ๆ, พิมพ์เข้มด้วย TypeScript, tree-shakeable
- **วินิจฉัยก่อนล้าง** — `diagnoseThaiText` รายงานปัญหาทุกชนิดที่พบ (แท็ก, zero-width, mark เพี้ยน, สระอำแยกส่วน, การเว้นวรรค `ๆ) พร้อมตัวอย่างตำแหน่งจริง
- รองรับทั้ง **ESM + CJS**, ไฟล์ประกาศ TypeScript และ **CLI** ขนาดเล็ก
- ผ่านการทดสอบด้วย [Vitest](https://vitest.dev/) บนข้อความไทยจริงกว่า 84 เคส
- **CI บน GitHub Actions** — รัน test + build บน Node.js 18 และ 20 ทุกครั้งที่ push ขึ้น `main`
- สัญญาอนุญาต MIT

## ทำไมข้อความไทยถึงพังใน Word

| ปัญหา | ตัวอย่าง | ผลลัพธ์ที่ได้ |
| --- | --- | --- |
| แท็ก HTML หลุดเข้าไปในย่อหน้า | `<p>สวัสดีครับ</p>` | `สวัสดีครับ` |
| Zero-width space ตัดคำออกเป็นสองส่วน | `ก​ัน` | `กัน` |
| Soft hyphen / BOM ติดมาในข้อความ | `ข้อ­ความ`, `﻿เริ่มต้น` | `ข้อความ`, `เริ่มต้น` |
| สระลอยหลุดจากพยัญชนะ | `ก ัน` | `กัน` |
| วรรณยุกต์วางก่อนสระ | `ท่ี` | `ที่` |
| สระล่างหลุดจากตัวอักษรมีเชิง | `กตัญ ู` | `กตัญู` |
| สระอำถูกแยกเป็น `ํ` + `า` | `กำ` | `กำ` |
| วรรณยุกต์ซ้ำกันในคลัสเตอร์เดียว | `ดี๊๊` | `ดี๊` |
| คำติดกับไม้ยมก `ๆ` | `เร็วๆ` | `เร็ว ๆ` |

เรียก `diagnoseThaiText` เพื่อดูรายงานปัญหา **ทั้งหมด** ในข้อความ (ดูหัวข้อ
[วินิจฉัยข้อความ](#วินิจฉัยข้อความ-diagnosethaitext))

## การติดตั้ง

```bash
npm install docx-thai-cleaner
```

ต้องใช้ Node.js ≥ 18

## ตัวอย่างการใช้งานอย่างรวดเร็ว

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

const raw = '<p>สวัสดี   ครับ</p>';

const cleaned = cleanThaiDocxText(raw);         // 'สวัสดี ครับ' (แท็ก/ช่องว่างถูกจัดการ)
const repaired = fixThaiFloatingVowels('ท่ี');   // 'ที่'          (ลำดับ stacking ตาม Unicode)
const spaced   = fixMaiYamokSpacing('เร็วๆ');    // 'เร็ว ๆ'       (เว้นวรรคไม้ยมกข้างละหนึ่งช่อง)
const nodeReady = sanitizeOpenXmlNodes('A & B'); // 'A &amp; B'   (ปลอดภัยสำหรับ <w:t>/attribute)

// ฟังก์ชันเฉพาะทางสำหรับ fragment HTML และสระล่างใต้ตัวอักษรมีเชิง (ญ/ฐ):
const plain  = cleanHtmlAndSpecialEntities('<p>&nbsp;ราคา 1,000 บาท</p>'); // 'ราคา 1,000 บาท'
const joined = fixThaiBottomVowels('กตัญ ู');                               // 'กตัญู'

// ดูว่าข้อความมีปัญหาอะไรบ้าง โดยไม่แก้ไขมัน:
const report = diagnoseThaiText('เร็วๆ');
console.log(report.counts.maiYamokSpacing); // 1
console.log(report.cleaned);                // 'เร็ว ๆ'
```

## API Reference

| ฟังก์ชัน | สเตจ | หน้าที่ |
| --- | --- | --- |
| `decodeHtmlEntities(input)` | — | ถอด HTML Entities (named + numeric) ครั้งเดียว กัน double-decode |
| `cleanThaiDocxText(input)` | 1 | ถอด entity → ตัดแท็ก HTML → ลบอักขระล่องหน → NFC → เคลียร์ช่องว่าง |
| `cleanHtmlAndSpecialEntities(input)` | 1b | แปลง fragment HTML เป็นข้อความล้วน (ตัดแท็ก + ถอด entity + `&nbsp;` → space) |
| `fixThaiFloatingVowels(input)` | 2 | ซ่อมคลัสเตอร์ไทย: compose สระอำ + ติด mark กลับฐาน + reorder ลำดับ canonical |
| `fixThaiBottomVowels(input)` | 2b | ซ่อมสระล่าง `ุ ู` ใต้ตัวอักษรมีเชิง `ญ ฐ` (เคสตัดเชิง) |
| `fixMaiYamokSpacing(input)` | 2c | จัดระยะเว้นวรรคไม้ยมก ` ๆ ` ให้ข้างละหนึ่งช่อง |
| `diagnoseThaiText(input)` | — | รายงานปัญหาทุกชนิดในข้อความแบบ read-only + ข้อความที่ซ่อมแล้ว |
| `sanitizeOpenXmlNodes(input, options?)` | 3 | ทำให้ข้อความฉีดเข้า OpenXML ได้ปลอดภัย (escape `& < > " '`) |

### `decodeHtmlEntities(input: string): string`

ยูทิลิตี้สาธารณะ (ทุกสเตจใช้ภายในด้วย) — ถอด HTML Entities เป็นอักขระปกติ **ครั้งเดียวเท่านั้น** ตามกฎการ parse ของ WHATWG HTML (`&amp;#39;` → ข้อความ `&#39;` ตรง ๆ ไม่ถูกถอดซ้ำ):

- named entities (`&nbsp;`, `&amp;`, `&quot;`, `&lt;`, `&gt;`, `&apos;` รวมถึงตัว typographic อย่าง `&mdash;`, `&hellip;`, `&lsquo;`, ...)
- numeric references ทั้งแบบทศนิยม (`&#39;`) และฐานสิบหก (`&#x27;`)
- ชื่อที่ไม่รู้จักจะถูกคงไว้ตามเดิม

```ts
decodeHtmlEntities('Tom &amp; Jerry &lt;3 &#65;'); // => 'Tom & Jerry <3 A'
decodeHtmlEntities('&amp;#39;');                   // => '&#39;'  (ถอดครั้งเดียว)
```

`&nbsp;` จะถูกถอดเป็น no-break space จริง (U+00A0) ซึ่งสเตจทำความสะอาดด้านล่างจะเปลี่ยนเป็น space ธรรมดาให้

### `cleanThaiDocxText(input: string): string`

สเตจ 1 — ทำความสะอาดเนื้อหา ทำงานตามลำดับ:

1. **ถอด HTML Entities** — `&nbsp;`, `&amp;`, `&#39;`, `&#x200B;`, ... ถูกขยายครั้งเดียวผ่าน `decodeHtmlEntities` (ชื่อที่ไม่รู้จักคงไว้ตามเดิม)
2. **ตัด markup ที่หลุดออกมา** — คอมเมนต์, CDATA, doctype, processing instruction และแท็กต่าง ๆ (`<p>`, `<span class="x">`, `<br/>`, ...) ถูกนำออก และเพราะถอด entity ก่อน markup ที่ถูก escape ไว้ (`&lt;b&gt;`) จึงถูกตัดออกไปด้วย ส่วนสมการ `5 < 6` ไม่ถูกแตะ
3. **ลบอักขระผิดกฎหมาย/ล่องหน** — ทุกตัวใน `INVISIBLE_CHARS` (ZWSP, ZWNJ, ZWJ, soft hyphen, BOM, bidi controls), C0/C1 controls (ยกเว้น tab/LF/CR), Unicode non-characters และ lone surrogates
4. **Normalized Unicode แบบ NFC** — `e + U+0301` → `é`, ข้อความไทยคงที่
5. **เคลียร์ช่องว่าง** — CRLF → LF, ช่องว่างหลายตัว → หนึ่ง space, trim บรรทัด, เว้นวรรคเกินหนึ่งบรรทัดไม่ได้
6. **เว้นวรรคไม้ยมก (ๆ)** — ข้างละหนึ่งช่องผ่าน `fixMaiYamokSpacing` (`ดีๆ` → `ดี ๆ`, `ดีๆครับ` → `ดี ๆ ครับ`)

```ts
cleanThaiDocxText('<p>สวัสดี   ครับ</p>'); // => 'สวัสดี ครับ'
cleanThaiDocxText('น้ำ &amp; ดิน');         // => 'น้ำ & ดิน'
cleanThaiDocxText('&lt;b&gt;หนา&lt;/b&gt;'); // => 'หนา'
cleanThaiDocxText('วิ่งเร็วๆ ครับ');       // => 'วิ่งเร็ว ๆ ครับ'
```

### `cleanHtmlAndSpecialEntities(input: string): string`

สเตจ 1b — แปลง fragment HTML เป็นข้อความล้วน

- แท็กจริง คอมเมนต์ doctype และ CDATA ถูกตัดออก (`<p>x</p>` → `x`) ส่วนแท็กที่ถูก escape ไว้ใน source จะถูกถอดเป็นข้อความตามที่เบราว์เซอร์แสดงจริง (`&lt;b&gt;` → `<b>`)
- Entities ทุกตัวถอด **ครั้งเดียว** ตาม WHATWG — `&nbsp;`/`&#160;`/`&#xA0;` กลายเป็น space ธรรมดา แล้ว whitespace ถูก collapse
- ชื่อที่ไม่รู้จักถูกคงไว้ตามเดิม

```ts
cleanHtmlAndSpecialEntities('<p>&nbsp;ราคา&nbsp;1,000&nbsp;บาท&nbsp;&amp;&nbsp;ลด 50%</p>');
// => 'ราคา 1,000 บาท & ลด 50%'

cleanHtmlAndSpecialEntities('&lt;p&gt;ตัวอักษร&lt;/p&gt;'); // => '<p>ตัวอักษร</p>'
```

### `fixThaiFloatingVowels(input: string): string`

สเตจ 2 — ซ่อมคลัสเตอร์ไทย ห้าผ่าน:

1. **Compose สระอำ** ที่ถูกแยกเป็นรูปสองอักขระ NIKKAHIT + SARA AA (`ํ` + `า` → `ำ`) — Unicode ไม่ compose ให้เองเพราะ U+0E33 ไม่มี canonical decomposition ดังนั้น NFC จึงปล่อยไว้ตามเดิม
2. **ติดกลับ** — สระ/วรรณยุกต์ที่ถูกเว้นวรรคแยกจากฐาน (`ก ัน` → `กัน`) หรือถูก zero-width characters แทรก (ถูก strip ก่อน)
3. **ย้าย mark กำพร้า** ที่เสียฐานทางซ้ายไป (`ัน` → `นั`)
4. **ลบ mark ซ้ำ** ในคลัสเตอร์เดียว — ส่วนใหญ่คือวรรณยุกต์ซ้ำ (`ดี๊๊` → `ดี๊`)
5. **Reorder** ทุก mark run เข้าลำดับ stacking มาตรฐาน — สระบน → สระล่าง → ็ → วรรณยุกต์ `่ ้ ๊ ๋` → `์ ํ ๎` — ด้วย stable sort (`ท่ี` → `ที่`, `ป๊ั` → `ปั๊`)

ข้อความที่เขียนถูกต้องแล้วจะผ่านไปโดยไม่ถูกแก้ รวมถึงเคสยากอย่าง `เมื่อ`, `เดี๋ยว`, `กี่` และ `น้ำ` (ที่วรรณยุกต์มาก่อนตัวอักษร `ำ` ซึ่งถูกต้องตาม Unicode)

```ts
fixThaiFloatingVowels('พร ุ่งนี้ ฉ ัน จะ ไป ท ี่ ห้าง');
// => 'พรุ่งนี้ ฉัน จะ ไป ที่ ห้าง'

fixThaiFloatingVowels('ท่ี ก ับ ป ั้น');
// => 'ที่ กับ ปั้น'

fixThaiFloatingVowels('กำ');   // => 'กำ'   (ํ + า ถูก compose)
fixThaiFloatingVowels('ดี๊๊');    // => 'ดี๊'  (วรรณยุกต์ซ้ำถูกลบ)
```

> **หมายเหตุ:** สระนำ (`เ แ โ ใ ไ`) **ไม่มีการ reorder เด็ดขาด** เพราะพยัญชนะที่ติดกับ `เ` ตรง ๆ เป็นเคสถูกต้องข้ามคำได้ (`...กินเขา`) การเขียนใหม่จึงกำกวม

### `fixThaiBottomVowels(input: string): string`

สเตจ 2b — ซ่อมสระล่าง (`ุ` U+0E38, `ู` U+0E39) ใต้ตัวอักษรมีเชิง `ญ` (U+0E0D) และ `ฐ` (U+0E10) หรือที่เรียกว่าเคส **ตัดเชิง** ในข้อความที่ถูกต้อง สระจะถูกเก็บไว้หลังพยัญชนะโดยตรง แล้วให้ฟอนต์ตัดเชิงและเลื่อนสระไปขวาเอง คำจริงอย่าง `กตัญญู` จึงผ่านไปโดยไม่ถูกแก้ ส่วนแหล่งข้อมูลที่พยายามเลื่อนสระเองแบบ manual จะถูกซ่อม:

- zero-width spacer ที่ถูกแทรกระหว่างพยัญชนะกับสระ (`ญ\u200Bุ` → `ญุ`)
- สระที่ถูกเก็บไว้ก่อนฐานของมัน (`ุญ` → `ญุ`)
- สระที่ถูกเว้นวรรคแยกจากฐาน (`กตัญ ู` → `กตัญู`)
- ลำดับ stacking เพี้ยน — สระต้องมาก่อนวรรณยุกต์ตามลำดับมาตรฐาน (`กตัญ ู ้` → `กตัญู้`)

```ts
fixThaiBottomVowels('กตัญ ู');    // => 'กตัญู'
fixThaiBottomVowels('ก ต ั ญ ู'); // => 'ก ตั ญู' (สระบน: ให้ chain กับ fixThaiFloatingVowels)
fixThaiBottomVowels('กตัญญู');    // => 'กตัญญู' (ไม่เปลี่ยนแปลง)
```

การซ่อมมีขอบเขตเฉพาะ **สระล่าง** เท่านั้น — ต้องการซ่อม mark ครบทุกชนิดให้ chain กับ `fixThaiFloatingVowels`

### `fixMaiYamokSpacing(input: string): string`

สเตจ 2c — จัดระยะเว้นวรรคไม้ยมก (`ๆ`, U+0E46) ตามมาตรฐานราชบัณฑิตยสถาน คือ **เว้นวรรคข้างละหนึ่งช่อง**:

- `ดีๆ` → `ดี ๆ` (คำติดอยู่ข้างหน้า ๆ)
- `ดีๆครับ` → `ดี ๆ ครับ` (คำติดอยู่ข้างหลัง ๆ)
- `ดี   ๆ` → `ดี ๆ` (ช่องว่างเกินถูกลดเหลือหนึ่ง)

ไม่มีการข้ามขึ้นบรรทัดใหม่ (`ดี\nๆ` คงไว้ตามเดิม) และวรรคคงที่เดิม (`ดี ๆ.` ยังเป็น `ดี ๆ.`) ฟังก์ชันนี้ทำงานเป็นขั้นสุดท้ายของ
`cleanThaiDocxText` ส่วน `fixThaiFloatingVowels` ไม่แตะเรื่องช่องว่าง

```ts
fixMaiYamokSpacing('ดีๆครับ');    // => 'ดี ๆ ครับ'
fixMaiYamokSpacing('ดี   ๆครับ'); // => 'ดี ๆ ครับ'
fixMaiYamokSpacing('ดี ๆ.');     // => 'ดี ๆ.' (ไม่เปลี่ยนแปลง)
```

### `diagnoseThaiText(input: string): ThaiCleanDiagnostic`

วินิจฉัยข้อความ — ตรวจข้อความ **โดยไม่แก้ไข** แล้วส่งคืนรายงานปัญหาครบทุกชนิดที่ pipeline สามารถซ่อมได้ การตรวจทำทีละสเตจตามลำดับการซ่อม ปัญหาหนึ่งจึงไม่ถูกนับซ้ำ (`ก ัน` นับเป็น floating mark หนึ่งครั้ง ไม่ใช่ orphan mark อีกครั้ง ส่วน `ดี   ๆ` นับเป็นช่องว่างเกิน ไม่ใช่ปัญหาการเว้นวรรค ` ๆ `)

```ts
export interface ThaiCleanDiagnostic {
  length: number;                                                       // ความยาว input (UTF-16)
  isClean: boolean;                                                     // true เมื่อไม่พบปัญหาเลย
  issueCount: number;                                                   //ผลรวม count ของทุกปัญหา
  counts: Readonly<Record<ThaiDiagnosticIssueType, number>>;            // จำนวนต่อชนิดปัญหา
  issues: readonly ThaiDiagnosticIssue[];                               // เฉพาะชนิดที่พบ
  cleaned: string;                                                      // input หลังผ่าน pipeline ซ่อมครบ
}

export interface ThaiDiagnosticIssue {
  type: ThaiDiagnosticIssueType;   // เช่น 'invisibleChars', 'separatedSaraAm', 'maiYamokSpacing'
  message: string;                 // คำอธิบาย + การซ่อมแบบ human-readable
  count: number;                   // จำนวนครั้งที่พบในข้อความทั้งหมด
  samples: ThaiDiagnosticSample[]; // ตัวอย่างพร้อมตำแหน่งไม่เกิน 5 ตัวอย่าง
}

export interface ThaiDiagnosticSample {
  index: number;   // ตำแหน่งของ match (UTF-16)
  match: string;   // ข้อความที่ match (อาจเป็นอักขระล่องหน เช่น '\u200B')
  excerpt: string; // match ในบริบท พร้อม escape อักขระล่องหน
}
```

`ThaiDiagnosticIssueType` ครอบคลุม: `htmlEntities`, `htmlTags`, `invisibleChars`, `controlChars`, `loneSurrogates`, `duplicateWhitespace`, `needsNfc`, `separatedSaraAm`, `floatingMarks`, `orphanMarks`, `duplicateMarks`, `stackOrderViolations` และ `maiYamokSpacing`

```ts
const report = diagnoseThaiText('สวัสดี​ครับ ดีๆ กำ');

report.isClean;                // => false
report.counts.invisibleChars;  // => 1
report.counts.maiYamokSpacing; // => 1
report.counts.separatedSaraAm; // => 1

report.issues[0].samples[0];   // => { index: 6, match: '\u200B', excerpt: 'สวัสดี[\u200B]ครับ' }
report.cleaned;                // => 'สวัสดีครับ ดี ๆ กำ'
```

รูปแบบการใช้งานที่พบบ่อยคือบันทึก then ส่งข้อความที่ซ่อมแล้วออกไปใช้งาน:

```ts
const report = diagnoseThaiText(input);
if (!report.isClean) {
  console.warn('Thai cleanup:', report.issues.map((i) => `${i.type}×${i.count}`));
}
const output = report.cleaned; // พร้อมสำหรับ node <w:t> หรือย่อหน้าใน docx
```

### `sanitizeOpenXmlNodes(input: string, options?): string`

สเตจ 3 — ทำให้ข้อความฉีดเข้า node ของ OpenXML (`<w:t>`, attribute) ได้โดยไม่ทำเอกสาร Word พัง

```ts
interface SanitizeOpenXmlOptions {
  stripMarkup?: boolean;        // ตัดแท็กทั้งหมด แล้ว treat เป็นข้อความล้วน (default: false)
  fixVowels?: boolean;          // ซ่อมคลัสเตอร์ไทยใน text segment       (default: true)
  collapseWhitespace?: boolean; // เคลียร์ช่องว่างใน text segment         (default: true)
  escape?: boolean;             // escape XML: &, <, >, ", '               (default: true)
}
```

- อักขระผิดกฎหมายใน XML 1.0 และอักขระล่องหนทั้งหมดถูกนำออก (รวม markup) แล้ว NFC-normalize
- **ข้อความล้วน**: ถอด entity → ซ่อม → collapse → escape — `5 < 6` → `5 &lt; 6`
- **Markup**: แท็กที่สมบูรณ์คงเดิมทุกตัวอักษร ขณะที่เฉพาะข้อความระหว่างแท็กถูกประมวลผล XML reference ที่ถูกต้อง (`&amp;`, `&#160;`) ไม่ถูก escape ซ้ำ

```ts
sanitizeOpenXmlNodes('A & B < C > D');
// => 'A &amp; B &lt; C &gt; D'

sanitizeOpenXmlNodes('<w:r><w:t>ก้ั</w:t></w:r>');
// => '<w:r><w:t>กั้</w:t></w:r>'
```

## ตัวอย่างเพิ่มเติม

### สร้าง `.docx` ด้วยไลบรารี [`docx`](https://www.npmjs.com/package/docx)

```ts
import { writeFileSync } from 'node:fs';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { cleanThaiDocxText, fixThaiFloatingVowels } from 'docx-thai-cleaner';

const rawParagraphs = ['<p>สวัสดี   ครับ</p>', '<p>ท ี่ คือ คำตอบ</p>'];

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

ไลบรารี `docx` escape XML ให้เองแล้ว จึงใช้สเตจทำความสะอาด (ไม่ใช่ `sanitizeOpenXmlNodes`) เมื่อทำงานผ่าน API ของมัน

### แปลง HTML/CMS export เป็นข้อความไทยสะอาด

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

### ฉีดข้อความที่ผ่านการ sanitize ลงใน snippet OOXML

```ts
import { sanitizeOpenXmlNodes } from 'docx-thai-cleaner';

const userText = 'ยอด & ส่วนลด 50%'; // จากฟอร์ม CMS หรือ API
const runXml = `<w:r><w:t xml:space="preserve">${sanitizeOpenXmlNodes(userText)}</w:t></w:r>`;
// <w:r><w:t xml:space="preserve">ยอด &amp; ส่วนลด 50%</w:t></w:r>
```

### ใช้กับ `python-docx` (มี CLI มาให้ในแพ็กเกจ)

แพ็กเกจมี executable ชื่อ `docx-thai-cleaner` — ตัวกรองแบบ Unix filter อ่านจาก argument หรือ stdin แล้วเขียนผลลัพธ์ออก stdout:

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
    return result.stdout

doc = Document()
for line in ["<p>สวัสดี   ครับ</p>", "<p>ที่ คือ คำตอบ</p>"]:
    doc.add_paragraph(clean_thai(line))
doc.save("output.docx")
```

```sh
# การใช้งาน CLI
docx-thai-cleaner '<p>สวัสดี   ครับ</p>'        # mode: clean (ค่าเริ่มต้น)
cat raw.txt | docx-thai-cleaner --mode fix        # mode: fix
docx-thai-cleaner --mode sanitize 'A & B'         # mode: sanitize
docx-thai-cleaner --mode sanitize --strip-markup '<p>ข้อความ</p>'
```

## หลักการทำงาน

สระและวรรณยุกต์ไทยต้องถูกเก็บหลังพยัญชนะฐานตามลำดับคงที่: สระก่อน แล้วจึงวรรณยุกต์ เบราว์เซอร์ เครื่องอ่าน OCR และตัว scrape HTML มักละเมิดลำดับนี้ ทำให้ Word แสดงสระผิดตำแหน่ง

`fixThaiFloatingVowels` บังคับลำดับตามมาตรฐาน Unicode (เครื่องหมายไทย):

```
ฐาน + สระบน (ั ิ ึ ื) + สระล่าง (ุ ู) + ็ + วรรณยุกต์ (่ ้ ๊ ๋) + (์ ํ ๎)
```

ส่วนที่เหลือ — สระนำ, สระแบบเว้นวรรค (`ำ ะ า`), วรรคคำ และขึ้นบรรทัดใหม่ — คงไว้ที่เดิม ข้อความที่ถูกต้องจึงไม่ถูกเขียนทับ

ตัวอักษรมีเชิง (`ญ ฐ`) ได้รับการดูแลแบบเดียวกันสำหรับ **สระล่าง**: `fixThaiBottomVowels` คืนลำดับมาตรฐาน `พยัญชนะ → สระ → วรรณยุกต์` (`กตัญ ู` → `กตัญู`) แล้วให้ฟอนต์จัดการการตัดเชิงของมันเอง

## การพัฒนา

```bash
npm install
npm run typecheck   # tsc --noEmit ครอบคลุม sources + tests
npm test            # vitest run
npm run build       # ESM -> dist/, CJS -> dist/cjs/, .d.ts, CLI finalizer
```

โครงสร้างโปรเจกต์:

```
.github/workflows/ci.yml   CI ของ GitHub Actions (Node 18 & 20)
src/index.ts               ฟังก์ชันหลักทุกสเตจ + diagnoseThaiText
src/cli.ts                 ตัวกรอง command-line
src/__tests__/cleaner.test.ts
dist/                      ผลลัพธ์ build (ESM + CJS + types)
```

ยินดีต้อนรับการมีส่วนร่วม — เปิด issue ก่อนสำหรับการเปลี่ยนแปลงขนาดใหญ่ และเพิ่มเทสต์สำหรับพฤติกรรมใหม่ทุกครั้ง

## License

[MIT](LICENSE) © Chevy00154
