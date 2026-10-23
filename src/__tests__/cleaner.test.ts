import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  cleanHtmlAndSpecialEntities,
  cleanThaiDocxText,
  decodeHtmlEntities,
  diagnoseThaiText,
  docxThaiCleaner,
  fixThaiBottomVowels,
  fixThaiFloatingVowels,
  fixMaiYamokSpacing,
  INVISIBLE_CHARS,
  sanitizeOpenXmlNodes,
} from '../index';
import { readPackageVersion } from '../version';

describe('cleanThaiDocxText', () => {
  describe('HTML tag stripping', () => {
    it('removes simple tags wrapped around Thai text', () => {
      expect(cleanThaiDocxText('<p>สวัสดีครับ</p>')).toBe('สวัสดีครับ');
    });

    it('removes tags that carry attributes', () => {
      expect(cleanThaiDocxText('<span class="highlight" data-id="42">ทดสอบ</span>')).toBe('ทดสอบ');
      expect(cleanThaiDocxText("<b class='x'>ตัวอย่าง</b>")).toBe('ตัวอย่าง');
    });

    it('removes nested and self-closing tags', () => {
      expect(cleanThaiDocxText('<div><p>ข้อความ</p></div>')).toBe('ข้อความ');
      expect(cleanThaiDocxText('<br/>ข้อความขึ้นบรรทัดใหม่')).toBe('ข้อความขึ้นบรรทัดใหม่');
    });

    it('removes comments, doctypes and processing instructions', () => {
      expect(cleanThaiDocxText('<!DOCTYPE html><!-- เม้นต์ --><body>จบ</body>')).toBe('จบ');
      expect(cleanThaiDocxText('<?xml version="1.0"?>ข้อความ')).toBe('ข้อความ');
    });

    it('removes an unclosed opening tag', () => {
      expect(cleanThaiDocxText('<b>ทดสอบ')).toBe('ทดสอบ');
    });

    it('decodes common HTML entities', () => {
      expect(cleanThaiDocxText('น้ำ &amp; ดิน &nbsp; ทราย')).toBe('น้ำ & ดิน ทราย');
    });

    it('decodes numeric character references', () => {
      expect(cleanThaiDocxText('หัวข้อ &#60; ท้ายข้อความ')).toBe('หัวข้อ < ท้ายข้อความ');
      expect(cleanThaiDocxText('อักขระ &#x200B; ล่องหน')).toBe('อักขระ ล่องหน');
    });

    it('leaves tag-shaped text outside markup semantics alone', () => {
      expect(cleanThaiDocxText('5 < 6 คือคำตอบ')).toBe('5 < 6 คือคำตอบ');
      expect(cleanThaiDocxText('ไม่มีแท็กในข้อความนี้')).toBe('ไม่มีแท็กในข้อความนี้');
    });
  });

  describe('invisible character removal', () => {
    it('removes zero-width spaces from inside Thai syllables', () => {
      expect(cleanThaiDocxText('ก\u200Bัน')).toBe('กัน');
      expect(cleanThaiDocxText('สวัสด\u200Bีครับ')).toBe('สวัสดีครับ');
    });

    it('removes a leading byte-order mark', () => {
      expect(cleanThaiDocxText('\uFEFFเริ่มต้นใหม่')).toBe('เริ่มต้นใหม่');
    });

    it('removes soft hyphens', () => {
      expect(cleanThaiDocxText('ข้อ\u00ADความ')).toBe('ข้อความ');
    });

    it('removes zero-width joiners, non-joiners and word joiners', () => {
      expect(cleanThaiDocxText('ก\u200B\u200Cดี\u200D\u2060!')).toBe('กดี!');
    });

    it('removes C0 control characters while keeping newlines and tabs', () => {
      expect(cleanThaiDocxText('ก\u0000\u0007ดี')).toBe('กดี');
      expect(cleanThaiDocxText('บรรทัดหนึ่ง\nบรรทัดสอง')).toBe('บรรทัดหนึ่ง\nบรรทัดสอง');
    });

    it('removes every character exported in INVISIBLE_CHARS', () => {
      expect(cleanThaiDocxText(`x${INVISIBLE_CHARS}y`)).toBe('xy');
    });
  });

  describe('Unicode normalization', () => {
    it('applies NFC normalization', () => {
      expect(cleanThaiDocxText('e\u0301')).toBe('\u00E9');
    });

    it('keeps already-normalized Thai text stable', () => {
      expect(cleanThaiDocxText('สวัสดีครับ')).toBe('สวัสดีครับ');
    });
  });

  describe('whitespace cleanup', () => {
    it('collapses runs of spaces and tabs', () => {
      expect(cleanThaiDocxText('  สวัสดี   ครับ  ')).toBe('สวัสดี ครับ');
      expect(cleanThaiDocxText('ก\t\t\tดี')).toBe('ก ดี');
    });

    it('normalizes line endings and trims around line breaks', () => {
      expect(cleanThaiDocxText('บรรทัดแรก   \r\n   บรรทัดสอง')).toBe('บรรทัดแรก\nบรรทัดสอง');
    });

    it('limits consecutive blank lines to one', () => {
      expect(cleanThaiDocxText('บรรทัดหนึ่ง\n\n\n\n\nบรรทัดสอง')).toBe('บรรทัดหนึ่ง\n\nบรรทัดสอง');
    });
  });

  it('is idempotent on already-clean text', () => {
    const once = cleanThaiDocxText('  สวัสดี   ครับ\n\n\n');
    expect(cleanThaiDocxText(once)).toBe(once);
  });

  it('returns an empty string for empty input', () => {
    expect(cleanThaiDocxText('')).toBe('');
  });
});

describe('fixThaiFloatingVowels', () => {
  describe('reattaching floating marks', () => {
    it('reattaches a vowel that drifted away from its consonant', () => {
      expect(fixThaiFloatingVowels('ก ัน')).toBe('กัน');
      expect(fixThaiFloatingVowels('ก   ัน')).toBe('กัน');
    });

    it('reattaches marks hidden behind zero-width characters', () => {
      expect(fixThaiFloatingVowels('ก\u200Bัน')).toBe('กัน');
      expect(fixThaiFloatingVowels('สวัสด\u200Bีครับ')).toBe('สวัสดีครับ');
    });

    it('reattaches a vowel and tone mark separated by spaces', () => {
      expect(fixThaiFloatingVowels('ท ี ่')).toBe('ที่');
    });

    it('moves a floating mark that lost its base entirely', () => {
      expect(fixThaiFloatingVowels('ัน')).toBe('นั');
      expect(fixThaiFloatingVowels('็กน')).toBe('ก็น');
    });

    it('leaves marks alone when no Thai base can be found', () => {
      expect(fixThaiFloatingVowels('ั')).toBe('ั');
    });
  });

  describe('stacking order repair', () => {
    it('puts the upper vowel before the tone mark', () => {
      expect(fixThaiFloatingVowels('ท่ี')).toBe('ที่');
      expect(fixThaiFloatingVowels('ด่ี')).toBe('ดี่');
    });

    it('puts mai taikhu and vowels before tone marks', () => {
      expect(fixThaiFloatingVowels('ป๊ั')).toBe('ปั๊');
      expect(fixThaiFloatingVowels('ก๊็')).toBe('ก็๊');
    });
  });

  describe('real Thai text passes through unchanged', () => {
    it.each([
      'สวัสดีครับ',
      'สวัสดี ครับ',
      'ประเทศไทย',
      'กรุงเทพมหานคร',
      'กี่',
      'ที่',
      'น้ำ',
      'เมื่อ',
      'เดี๋ยว',
      'ก็',
      'ลูก',
      'พื้นบ้าน',
    ])('%s', (text) => {
      expect(fixThaiFloatingVowels(text)).toBe(text);
    });

    it('leaves non-Thai text untouched', () => {
      expect(fixThaiFloatingVowels('Hello, World! 123')).toBe('Hello, World! 123');
    });
  });

  it('repairs a realistic sentence with drifted marks', () => {
    const broken = 'พร ุ่งนี้ ฉ ัน จะ ไป ท ี่ ห้าง';
    expect(fixThaiFloatingVowels(broken)).toBe('พรุ่งนี้ ฉัน จะ ไป ที่ ห้าง');
  });

  it('returns an empty string for empty input', () => {
    expect(fixThaiFloatingVowels('')).toBe('');
  });
});

describe('sanitizeOpenXmlNodes', () => {
  describe('XML escaping of plain text', () => {
    it('escapes ampersands, angle brackets and quotes', () => {
      expect(sanitizeOpenXmlNodes('ยอดรวม 1,200 & 3,500')).toBe('ยอดรวม 1,200 &amp; 3,500');
      expect(sanitizeOpenXmlNodes('5 < 6')).toBe('5 &lt; 6');
      expect(sanitizeOpenXmlNodes('a > b')).toBe('a &gt; b');
      expect(sanitizeOpenXmlNodes(`say "hi" & 'bye'`)).toBe('say &quot;hi&quot; &amp; &apos;bye&apos;');
    });

    it('does not double-escape existing XML references', () => {
      expect(sanitizeOpenXmlNodes('a &amp; b')).toBe('a &amp; b');
      expect(sanitizeOpenXmlNodes('a &lt; b')).toBe('a &lt; b');
    });

    it('neutralizes unknown HTML entities', () => {
      expect(sanitizeOpenXmlNodes('a &foo; b')).toBe('a &amp;foo; b');
    });

    it('escapes a bare angle bracket that is not a tag', () => {
      expect(sanitizeOpenXmlNodes('a <b')).toBe('a &lt;b');
    });
  });

  describe('markup preservation', () => {
    it('keeps well-formed tags untouched', () => {
      const fragment = '<w:t xml:space="preserve">สวัสดี</w:t>';
      expect(sanitizeOpenXmlNodes(fragment)).toBe(fragment);
    });

    it('repairs Thai clusters inside text nodes', () => {
      expect(sanitizeOpenXmlNodes('<w:r><w:t>ก้ั</w:t></w:r>')).toBe('<w:r><w:t>กั้</w:t></w:r>');
      expect(sanitizeOpenXmlNodes('<w:t>ก ัน</w:t>')).toBe('<w:t>กัน</w:t>');
    });

    it('escapes text content without touching the tags', () => {
      expect(sanitizeOpenXmlNodes('<w:t>ก็ & ดี</w:t>')).toBe('<w:t>ก็ &amp; ดี</w:t>');
    });

    it('leaves valid references inside attributes alone', () => {
      const fragment = '<w:val w:title="A &amp; B"/>';
      expect(sanitizeOpenXmlNodes(fragment)).toBe(fragment);
    });

    it('rewrites non-XML HTML entities inside attributes to numeric references', () => {
      expect(sanitizeOpenXmlNodes('<w:val w:title="1&nbsp;2"/>')).toBe('<w:val w:title="1&#160;2"/>');
    });

    it('removes invisible characters everywhere, markup included', () => {
      expect(sanitizeOpenXmlNodes('<w:t>ก\u200Bัน</w:t>')).toBe('<w:t>กัน</w:t>');
    });
  });

  describe('stripMarkup mode', () => {
    it('removes all tags and escapes the remaining text', () => {
      expect(sanitizeOpenXmlNodes('<p>แท็ก &amp; ข้อความ</p>', { stripMarkup: true })).toBe(
        'แท็ก &amp; ข้อความ',
      );
      expect(sanitizeOpenXmlNodes('<div><br/>ข้อความ</div>', { stripMarkup: true })).toBe('ข้อความ');
    });
  });

  describe('options', () => {
    it('collapses whitespace by default and can preserve it', () => {
      expect(sanitizeOpenXmlNodes('สวัสดี    ครับ')).toBe('สวัสดี ครับ');
      expect(sanitizeOpenXmlNodes('  a  ', { collapseWhitespace: false })).toBe('  a  ');
    });

    it('can skip escaping', () => {
      expect(sanitizeOpenXmlNodes('A & B', { escape: false })).toBe('A & B');
    });

    it('can skip vowel repair', () => {
      expect(sanitizeOpenXmlNodes('ก้ั', { fixVowels: false })).toBe('ก้ั');
    });
  });

  it('removes XML-illegal control characters', () => {
    expect(sanitizeOpenXmlNodes('a\u0007b')).toBe('ab');
  });

  it('returns an empty string for empty input', () => {
    expect(sanitizeOpenXmlNodes('')).toBe('');
  });
});

describe('cleanHtmlAndSpecialEntities — HTML & special entity decoding', () => {
  it('decodes &nbsp;, &amp;, &quot;, &#39;, &lt;, &gt; and &apos;', () => {
    expect(cleanHtmlAndSpecialEntities('&nbsp;&amp;&quot;&#39;&lt;&gt;&apos;')).toBe("&\"'<>'");
  });

  it('decodes numeric decimal and hex references (incl. Thai code points)', () => {
    expect(cleanHtmlAndSpecialEntities('&#65;&#x42;&#3647;')).toBe('AB฿');
    expect(cleanHtmlAndSpecialEntities('&#3616;')).toBe('ภ');
  });

  it('decodes typographic entities common in Thai web content', () => {
    expect(cleanHtmlAndSpecialEntities('&mdash;&hellip;&lsquo;x&rsquo;&deg;&plusmn;&euro;')).toBe(
      '—…‘x’°±€',
    );
  });

  it('strips real tags and decodes escaped tags to literal text', () => {
    expect(cleanHtmlAndSpecialEntities('<span class="x">สวัสดี</span> ครับ')).toBe('สวัสดี ครับ');
    expect(cleanHtmlAndSpecialEntities('&lt;p&gt;ตัวอักษร&lt;/p&gt;')).toBe('<p>ตัวอักษร</p>');
  });

  it('removes comments and never leaks entities from attributes', () => {
    expect(
      cleanHtmlAndSpecialEntities('<!-- ห้ามเผยแพร่ --><a href="?a=1&amp;b=2">คลิก ที่ นี่</a>'),
    ).toBe('คลิก ที่ นี่');
  });

  it('decodes exactly once (no double-decoding)', () => {
    expect(cleanHtmlAndSpecialEntities('&amp;#39; &amp;amp;')).toBe('&#39; &amp;');
  });

  it('turns an HTML CMS snippet into plain text', () => {
    expect(
      cleanHtmlAndSpecialEntities(
        '<div class="ข่าว">&nbsp;ราคา&nbsp;1,000&nbsp;บาท&nbsp;&amp;&nbsp;ลด 50%</div>',
      ),
    ).toBe('ราคา 1,000 บาท & ลด 50%');
  });

  it('leaves plain text unchanged and returns empty string for empty input', () => {
    expect(cleanHtmlAndSpecialEntities('สวัสดีครับ')).toBe('สวัสดีครับ');
    expect(cleanHtmlAndSpecialEntities('')).toBe('');
  });
});

describe('fixThaiBottomVowels — สระล่างใต้ตัวอักษรมีเชิง (ญ/ฐ)', () => {
  it('rejoins a lower vowel detached from ญ/ฐ by a space', () => {
    expect(fixThaiBottomVowels('กตัญ ู')).toBe('กตัญู');
    expect(fixThaiBottomVowels('ฐ \u0E38')).toBe('ฐุ');
  });

  it('removes zero-width spacers used to fake descender clearance', () => {
    expect(fixThaiBottomVowels('ญ\u200Bุ')).toBe('ญุ');
  });

  it('moves a lower vowel stored before its base after it', () => {
    expect(fixThaiBottomVowels('\u0E38ญ')).toBe('ญุ');
  });

  it('restacks vowel + tone into the canonical order', () => {
    expect(fixThaiBottomVowels('กตัญ ู \u0E49')).toBe('กตัญู้');
    expect(fixThaiBottomVowels('ญ ู \u0E48')).toBe('ญู่');
  });

  it('leaves correct descender words and ordinary text unchanged', () => {
    expect(fixThaiBottomVowels('กตัญญู')).toBe('กตัญญู');
    expect(fixThaiBottomVowels('คุณ')).toBe('คุณ');
    expect(fixThaiBottomVowels('น้ำ')).toBe('น้ำ');
    expect(fixThaiBottomVowels('เมื่อ')).toBe('เมื่อ');
    expect(fixThaiBottomVowels('')).toBe('');
  });

  it('stays scoped to bottom vowels (upper vowels wait for fixThaiFloatingVowels)', () => {
    expect(fixThaiBottomVowels('ก ต \u0E31 ญ ู')).toBe('ก ตั ญู');
  });
});

describe('ข้อความไทยเชิงวิชาการยาว ๆ — long academic Thai, multi-level floating vowels', () => {
  const academic =
    'นักวิจัยจากมหาวิทยาลัยเชียงใหม่ ศึกษาผลกระทบของการเปลี่ยนแปลงสภาพภูมิอากาศต่อพฤติกรรมการหากินของนก ในเขตพื้นที่ชุ่มชื้นของอุทยานแห่งชาติ ช่วงฤดูหนาวที่ผ่านมา';

  /** Scatters every combining mark away from its base, incl. stacked runs. */
  const scatter = (text: string): string =>
    text
      .replace(/([\u0E00-\u0E7F])([\u0E31\u0E34-\u0E3A\u0E47-\u0E4E])/g, '$1 $2')
      .replace(/([\u0E31\u0E34-\u0E3A\u0E47-\u0E4E])([\u0E31\u0E34-\u0E3A\u0E47-\u0E4E])/g, '$1 $2');

  const prepare = (input: string): string =>
    fixThaiBottomVowels(fixThaiFloatingVowels(cleanThaiDocxText(input)));

  it('repairs explicit multi-level drift', () => {
    expect(prepare('น ักว ิจ ัย')).toBe('นักวิจัย');
    expect(prepare('เปล ี ่ยน')).toBe('เปลี่ยน'); // upper vowel + mai ek stacked
    expect(prepare('ช ุ ม ช ื ้น')).toBe('ชุ ม ชื้น'); // lower vowel + tone stacks
    expect(prepare('พ ื ้น ท ี่')).toBe('พื้น ที่'); // ื+้ stacked, ี่ = ี+่
  });

  it('restores a long academic paragraph scattered at every mark boundary', () => {
    expect(prepare(scatter(academic))).toBe(academic);
  });

  it('cleans the same paragraph delivered as HTML with entities', () => {
    const html = `<p>&nbsp;${scatter(academic)}</p>`;
    expect(prepare(cleanHtmlAndSpecialEntities(html))).toBe(academic);
  });
});

describe('decodeHtmlEntities — public entity decoder', () => {
  it('decodes named entities including &nbsp;', () => {
    expect(decodeHtmlEntities('&nbsp;&amp;&quot;&lt;&gt;&apos;')).toBe(" &\"<>'");
  });

  it('decodes numeric decimal and hex references (incl. Thai code points)', () => {
    expect(decodeHtmlEntities('&#65;&#x42;&#3616;')).toBe('ABภ');
  });

  it('decodes exactly once (no double-decoding)', () => {
    expect(decodeHtmlEntities('&amp;#39; &amp;amp;')).toBe('&#39; &amp;');
  });

  it('keeps unknown entities and plain text untouched', () => {
    expect(decodeHtmlEntities('&foo; &unknown;')).toBe('&foo; &unknown;');
    expect(decodeHtmlEntities('สวัสดีครับ')).toBe('สวัสดีครับ');
  });
});

describe('cleanThaiDocxText — entity-first pipeline', () => {
  it('removes escaped markup because entities are decoded before tag stripping', () => {
    expect(cleanThaiDocxText('&lt;b&gt;หนา&lt;/b&gt;')).toBe('หนา');
  });

  it('still decodes entities, drops zero-width characters and collapses spacing', () => {
    expect(cleanThaiDocxText('น้ำ &amp; ดิน &nbsp; ทราย')).toBe('น้ำ & ดิน ทราย');
    expect(cleanThaiDocxText('หัวข้อ &#60; ท้ายข้อความ')).toBe('หัวข้อ < ท้ายข้อความ');
    expect(cleanThaiDocxText('อักขระ &#x200B; ล่องหน')).toBe('อักขระ ล่องหน');
  });
});

describe('sanitizeOpenXmlNodes — XML special characters', () => {
  it('escapes &, <, and > so Word cannot corrupt the document', () => {
    expect(sanitizeOpenXmlNodes('A & B < C > D')).toBe('A &amp; B &lt; C &gt; D');
  });

  it('round-trips the classic corrupted-document triggers', () => {
    expect(sanitizeOpenXmlNodes('50% & "ส่วนลด" < พิเศษ > ด่วน')).toBe(
      '50% &amp; &quot;ส่วนลด&quot; &lt; พิเศษ &gt; ด่วน',
    );
  });
});

describe('fixThaiFloatingVowels — สระอำที่แยกส่วน (ํ + า → ำ)', () => {
  it('composes NIKKAHIT + SARA AA into SARA AM (NFC never does this)', () => {
    expect(fixThaiFloatingVowels('ก\u0E4D\u0E32')).toBe('ก\u0E33');
    expect(fixThaiFloatingVowels('ม\u0E4D\u0E32')).toBe('ม\u0E33');
  });

  it('composes at the very start of the string, where the orphan pass would misplace ํ', () => {
    expect(fixThaiFloatingVowels('\u0E4D\u0E32')).toBe('\u0E33');
    expect(fixThaiFloatingVowels('\u0E4D\u0E32\u0E4D\u0E32')).toBe('\u0E33\u0E33');
  });

  it('composes behind a stacked tone mark', () => {
    expect(fixThaiFloatingVowels('น\u0E49\u0E4D\u0E32')).toBe('น\u0E49\u0E33'); // น้ำ
  });

  it('composes when the pair was split off by zero-width characters', () => {
    expect(fixThaiFloatingVowels('ก\u200B\u0E4D\u0E32')).toBe('ก\u0E33');
  });

  it('leaves real SARA AM and legitimate nikkahit words untouched', () => {
    expect(fixThaiFloatingVowels('น\u0E49\u0E33')).toBe('น\u0E49\u0E33'); // น้ำ
    expect(fixThaiFloatingVowels('ก\u0E23\u0E4D\u0E21')).toBe('ก\u0E23\u0E4D\u0E21'); // กรรม
    expect(fixThaiFloatingVowels('ส\u0E4C\u0E07')).toBe('ส\u0E4C\u0E07'); // ส่ง
  });

  it('is idempotent on the composed form', () => {
    const once = fixThaiFloatingVowels('ก\u0E4D\u0E32');
    expect(once).toBe('ก\u0E33');
    expect(fixThaiFloatingVowels(once)).toBe(once);
  });
});

describe('fixThaiFloatingVowels — การลบวรรณยุกต์ซ้ำซ้อน', () => {
  it('drops a doubled tone mark', () => {
    expect(fixThaiFloatingVowels('ด\u0E35\u0E4A\u0E4A')).toBe('ด\u0E35\u0E4A'); // ดี๊๊ → ดี๊
    expect(fixThaiFloatingVowels('ก\u0E48\u0E48')).toBe('ก\u0E48');
  });

  it('drops the duplicate before restacking the cluster', () => {
    expect(fixThaiFloatingVowels('ก\u0E4A\u0E4A\u0E35')).toBe('ก\u0E35\u0E4A'); // ก๊๊ี → กี๊
    expect(fixThaiFloatingVowels('ป\u0E48\u0E48\u0E31')).toBe('ป\u0E31\u0E48'); // ป่่ั → ปั่
  });

  it('keeps the same tone mark in two separate clusters', () => {
    expect(fixThaiFloatingVowels('ก\u0E48ก\u0E48')).toBe('ก\u0E48ก\u0E48');
  });

  it('also drops duplicated upper and lower vowels', () => {
    expect(fixThaiFloatingVowels('ก\u0E34\u0E34')).toBe('ก\u0E34');
    expect(fixThaiFloatingVowels('ค\u0E38\u0E38น')).toBe('ค\u0E38น');
  });

  it('is idempotent', () => {
    const once = fixThaiFloatingVowels('ด\u0E35\u0E4A\u0E4A');
    expect(fixThaiFloatingVowels(once)).toBe(once);
  });
});

describe('fixMaiYamokSpacing — การจัดระยะเว้นวรรคไม้ยมก (ๆ)', () => {
  it('inserts one space before a word glued to ๆ', () => {
    expect(fixMaiYamokSpacing('ดีๆ')).toBe('ดี ๆ');
    expect(fixMaiYamokSpacing('ก็ๆ')).toBe('ก็ ๆ');
    expect(fixMaiYamokSpacing('ดี\tๆ')).toBe('ดี ๆ');
  });

  it('inserts one space after ๆ when a word is glued behind it', () => {
    expect(fixMaiYamokSpacing('ดี ๆครับ')).toBe('ดี ๆ ครับ');
    expect(fixMaiYamokSpacing('ดีๆครับ')).toBe('ดี ๆ ครับ');
    expect(fixMaiYamokSpacing('ๆดี')).toBe('ๆ ดี');
  });

  it('collapses excess spaces around ๆ', () => {
    expect(fixMaiYamokSpacing('ดี   ๆ')).toBe('ดี ๆ');
    expect(fixMaiYamokSpacing('ดี  ๆครับ')).toBe('ดี ๆ ครับ');
  });

  it('handles real Thai sentences', () => {
    expect(fixMaiYamokSpacing('นักเรียนตั้งใจเรียน มากๆ')).toBe('นักเรียนตั้งใจเรียน มาก ๆ');
    expect(fixMaiYamokSpacing('รอแป๊บเดียว เร็วๆ')).toBe('รอแป๊บเดียว เร็ว ๆ');
    expect(fixMaiYamokSpacing('ชอบกินข้าวเหนียวๆ')).toBe('ชอบกินข้าวเหนียว ๆ');
  });

  it('never bridges line breaks', () => {
    expect(fixMaiYamokSpacing('ดี\nๆ')).toBe('ดี\nๆ');
    expect(fixMaiYamokSpacing('ดี ๆ\nครับ')).toBe('ดี ๆ\nครับ');
  });

  it('keeps punctuation glued to ๆ', () => {
    expect(fixMaiYamokSpacing('ดี ๆ.')).toBe('ดี ๆ.');
    expect(fixMaiYamokSpacing('ดีๆ...')).toBe('ดี ๆ...');
  });

  it('leaves correct spacing untouched and stays idempotent', () => {
    expect(fixMaiYamokSpacing('ดี ๆ ครับ')).toBe('ดี ๆ ครับ');
    expect(fixMaiYamokSpacing('อ่าน แล้ว อ่าน อีก')).toBe('อ่าน แล้ว อ่าน อีก');
    const once = fixMaiYamokSpacing('เร็วๆครับ มากๆ');
    expect(once).toBe('เร็ว ๆ ครับ มาก ๆ');
    expect(fixMaiYamokSpacing(once)).toBe(once);
  });

  it('returns an empty string for empty input', () => {
    expect(fixMaiYamokSpacing('')).toBe('');
  });
});

describe('cleanThaiDocxText — การเว้นวรรคไม้ยมกในパイป์ไลน์', () => {
  it('normalizes glued and over-spaced ๆ during cleaning', () => {
    expect(cleanThaiDocxText('อากาศดีมากๆครับ')).toBe('อากาศดีมาก ๆ ครับ');
    expect(cleanThaiDocxText('วิ่งเร็วๆ   เลย')).toBe('วิ่งเร็ว ๆ เลย');
  });

  it('keeps correct ๆ spacing and punctuation untouched', () => {
    expect(cleanThaiDocxText('ดี ๆ ครับ')).toBe('ดี ๆ ครับ');
    expect(cleanThaiDocxText('ดี ๆ.')).toBe('ดี ๆ.');
    expect(cleanThaiDocxText('ยาว ๆ')).toBe('ยาว ๆ');
  });

  it('leaves spacing repair to this stage — mark repair alone does not touch it', () => {
    expect(fixThaiFloatingVowels('ดีๆ')).toBe('ดีๆ');
  });

  it('stays idempotent with zero-width characters in the mix', () => {
    const once = cleanThaiDocxText('  ดีๆ\u200Bครับ  ');
    expect(once).toBe('ดี ๆ ครับ');
    expect(cleanThaiDocxText(once)).toBe(once);
  });
});

describe('sanitizeOpenXmlNodes — ฟีเจอร์ใหม่ในข้อความ OOXML', () => {
  it('repairs duplicate tone marks inside text nodes', () => {
    expect(sanitizeOpenXmlNodes('<w:t>ด\u0E35\u0E4A\u0E4A</w:t>')).toBe('<w:t>ด\u0E35\u0E4A</w:t>');
  });

  it('composes separated SARA AM inside text nodes', () => {
    expect(sanitizeOpenXmlNodes('<w:t>ก\u0E4D\u0E32</w:t>')).toBe('<w:t>ก\u0E33</w:t>');
  });
});

describe('diagnoseThaiText — รายงานปัญหาข้อความไทย', () => {
  it('reports correct Thai text as clean', () => {
    const report = diagnoseThaiText('สวัสดีครับ ดี ๆ');
    expect(report.isClean).toBe(true);
    expect(report.issueCount).toBe(0);
    expect(report.issues).toEqual([]);
    expect(report.length).toBe('สวัสดีครับ ดี ๆ'.length);
    expect(report.cleaned).toBe('สวัสดีครับ ดี ๆ');
    expect(Object.values(report.counts).every((count) => count === 0)).toBe(true);
  });

  it('returns an empty diagnostic for empty input', () => {
    const report = diagnoseThaiText('');
    expect(report.length).toBe(0);
    expect(report.isClean).toBe(true);
    expect(report.issueCount).toBe(0);
    expect(report.issues).toEqual([]);
    expect(report.cleaned).toBe('');
  });

  it('exposes a zero count for every issue category', () => {
    const report = diagnoseThaiText('สวัสดี');
    expect(Object.keys(report.counts).sort()).toEqual(
      [
        'controlChars',
        'duplicateMarks',
        'duplicateWhitespace',
        'floatingMarks',
        'htmlEntities',
        'htmlTags',
        'invisibleChars',
        'loneSurrogates',
        'maiYamokSpacing',
        'needsNfc',
        'orphanMarks',
        'separatedSaraAm',
        'stackOrderViolations',
      ].sort(),
    );
  });

  it('detects invisible characters with a located sample', () => {
    const report = diagnoseThaiText('ก\u200Bัน');
    expect(report.counts.invisibleChars).toBe(1);
    expect(report.issueCount).toBe(1);
    const issue = report.issues.find((entry) => entry.type === 'invisibleChars');
    expect(issue?.message).toContain('Zero-width');
    expect(issue?.samples).toEqual([
      { index: 1, match: '\u200B', excerpt: 'ก[\\u200B]ัน' },
    ]);
    expect(report.cleaned).toBe('กัน');
  });

  it('detects control characters and lone surrogates', () => {
    const report = diagnoseThaiText('ก\u0007ดี\uD800');
    expect(report.counts.controlChars).toBe(1);
    expect(report.counts.loneSurrogates).toBe(1);
    expect(report.cleaned).toBe('กดี');
  });

  it('detects HTML tags and decodable entities', () => {
    const report = diagnoseThaiText('<b>&nbsp;สวัสดี</b>');
    expect(report.counts.htmlTags).toBe(2);
    expect(report.counts.htmlEntities).toBe(1);
    expect(report.cleaned).toBe('สวัสดี');
  });

  it('ignores unknown entities that never decode', () => {
    expect(diagnoseThaiText('a &foo; b').counts.htmlEntities).toBe(0);
  });

  it('detects duplicate whitespace runs and trailing spaces', () => {
    expect(diagnoseThaiText('a  b').counts.duplicateWhitespace).toBe(1);
    expect(diagnoseThaiText('a b').counts.duplicateWhitespace).toBe(0);
    expect(diagnoseThaiText('บรรทัด \nใหม่').counts.duplicateWhitespace).toBe(1);
  });

  it('detects text that is not in NFC form', () => {
    const report = diagnoseThaiText('e\u0301');
    expect(report.counts.needsNfc).toBe(1);
    expect(report.issues[0].type).toBe('needsNfc');
    expect(report.issues[0].samples).toEqual([]);
    expect(report.cleaned).toBe('é');
  });

  it('detects separated SARA AM without double-counting it as an orphan mark', () => {
    const report = diagnoseThaiText('สวัสดี\u0E4D\u0E32');
    expect(report.counts.separatedSaraAm).toBe(1);
    expect(report.counts.orphanMarks).toBe(0);
    expect(report.cleaned).toBe('สวัสดี\u0E33');
  });

  it('detects a doubled tone mark exactly once', () => {
    const report = diagnoseThaiText('ด\u0E35\u0E4A\u0E4A'); // ดี๊๊
    expect(report.counts.duplicateMarks).toBe(1);
    expect(report.counts.stackOrderViolations).toBe(0);
    expect(report.issues.find((entry) => entry.type === 'duplicateMarks')?.samples[0].match).toBe(
      '\u0E35\u0E4A\u0E4A', // the full mark run containing the duplicate
    );
    expect(report.cleaned).toBe('ด\u0E35\u0E4A');
  });

  it('detects scrambled stacking order', () => {
    const report = diagnoseThaiText('ท\u0E48\u0E35'); // ท่ี
    expect(report.counts.stackOrderViolations).toBe(1);
    expect(report.counts.duplicateMarks).toBe(0);
    expect(report.cleaned).toBe('ท\u0E35\u0E48'); // ที่
  });

  it('counts floating marks once — not again as orphan marks', () => {
    const report = diagnoseThaiText('ก ัน');
    expect(report.counts.floatingMarks).toBe(1);
    expect(report.counts.orphanMarks).toBe(0);
    expect(report.cleaned).toBe('กัน');
  });

  it('detects orphan marks (incl. lower vowels stored before their base)', () => {
    const report = diagnoseThaiText('ัน');
    expect(report.counts.orphanMarks).toBe(1);
    expect(report.counts.floatingMarks).toBe(0);
    expect(report.cleaned).toBe('นั');

    const lowerVowel = diagnoseThaiText('\u0E38ญ');
    expect(lowerVowel.counts.orphanMarks).toBe(1);
    expect(lowerVowel.cleaned).toBe('ญ\u0E38');
  });

  it('detects mai-yamok spacing issues once per marker', () => {
    const report = diagnoseThaiText('ดีๆครับ');
    expect(report.counts.maiYamokSpacing).toBe(1);
    expect(report.cleaned).toBe('ดี ๆ ครับ');
    expect(diagnoseThaiText('ดี ๆ ครับ').counts.maiYamokSpacing).toBe(0);
  });

  it('treats excess whitespace before ๆ as whitespace, not as a ๆ issue', () => {
    const report = diagnoseThaiText('ดี   ๆ');
    expect(report.counts.duplicateWhitespace).toBe(1);
    expect(report.counts.maiYamokSpacing).toBe(0);
    expect(report.cleaned).toBe('ดี ๆ');
  });

  it('caps samples at five while reporting the full count', () => {
    const report = diagnoseThaiText(`x${'\u200B'.repeat(10)}y`);
    expect(report.counts.invisibleChars).toBe(10);
    expect(report.issues[0].samples).toHaveLength(5);
  });

  it('reports every category at once on a realistically corrupted snippet', () => {
    const dirty = '<p>&nbsp;ก\u0E4D\u0E32\u200Bดีๆ  ท\u0E4A\u0E4A\u0E35</p>';
    const report = diagnoseThaiText(dirty);
    expect(report.counts).toMatchObject({
      htmlEntities: 1,
      htmlTags: 2,
      invisibleChars: 1,
      duplicateWhitespace: 1,
      separatedSaraAm: 1,
      duplicateMarks: 1,
      stackOrderViolations: 1,
      maiYamokSpacing: 1,
    });
    expect(report.issueCount).toBe(9); // htmlTags contributes 2 occurrences
    expect(report.isClean).toBe(false);
    expect(report.issues.map((entry) => entry.type)).toEqual([
      'htmlEntities',
      'htmlTags',
      'invisibleChars',
      'duplicateWhitespace',
      'separatedSaraAm',
      'duplicateMarks',
      'stackOrderViolations',
      'maiYamokSpacing',
    ]);
    expect(report.cleaned).toBe('ก\u0E33ดี ๆ ท\u0E35\u0E4A');
  });
});

describe('docxThaiCleaner — namespace export', () => {
  it('exposes every stage, including the new ones', () => {
    expect(docxThaiCleaner.fixMaiYamokSpacing).toBe(fixMaiYamokSpacing);
    expect(docxThaiCleaner.diagnoseThaiText).toBe(diagnoseThaiText);
    expect(Object.keys(docxThaiCleaner)).toEqual([
      'decodeHtmlEntities',
      'cleanThaiDocxText',
      'cleanHtmlAndSpecialEntities',
      'fixThaiFloatingVowels',
      'fixThaiBottomVowels',
      'fixMaiYamokSpacing',
      'sanitizeOpenXmlNodes',
      'diagnoseThaiText',
    ]);
  });
});

describe('readPackageVersion — อ่านเวอร์ชันจาก package.json', () => {
  it('reads the real package version when started from a file inside dist/', () => {
    // Simulate the built CLI: dist/cli.js and dist/cjs/cli.js both sit one or
    // two levels below package.json and must report the same version.
    expect(readPackageVersion(join(process.cwd(), 'dist', 'cli.js'))).toBe('1.1.1');
    expect(readPackageVersion(join(process.cwd(), 'dist', 'cjs', 'cli.js'))).toBe('1.1.1');
  });

  it('reads the version when started from src/ (unbuilt dev tree)', () => {
    expect(readPackageVersion(join(process.cwd(), 'src', 'cli.ts'))).toBe('1.1.1');
  });

  it('walks up past a nested node_modules layout (npm bin shim case)', () => {
    const root = process.cwd();
    const shim = join(root, 'node_modules', '.bin', 'docx-thai-cleaner');
    expect(readPackageVersion(shim)).toBe('1.1.1');
    void root;
  });

  it('ignores a foreign package.json that does not match the package name', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dtc-version-'));
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'someone-else', version: '9.9.9' }));
      // Foreign manifest is skipped, walk continues up — but /tmp has no
      // docx-thai-cleaner package.json above it, so we get the fallback.
      expect(readPackageVersion(join(dir, 'fake-cli.js'))).toBe('0.0.0');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads a matching package.json placed alongside the entry file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dtc-version-'));
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'docx-thai-cleaner', version: '4.5.6' }));
      expect(readPackageVersion(join(dir, 'cli.js'))).toBe('4.5.6');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns the fallback when the entry path and its parents have no matching package.json', () => {
    // Non-existent file under the OS temp dir: realpath fails, walk-up from
    // there finds no docx-thai-cleaner package.json → fallback.
    expect(readPackageVersion(join(tmpdir(), 'definitely-missing', 'cli.js'))).toBe('0.0.0');
  });
});
