import { describe, expect, it } from 'vitest';

import { cleanThaiDocxText, fixThaiFloatingVowels, INVISIBLE_CHARS, sanitizeOpenXmlNodes } from '../index';

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
