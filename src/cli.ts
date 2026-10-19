#!/usr/bin/env node
/**
 * docx-thai-cleaner CLI.
 *
 * A Unix-style filter: reads text from positional arguments or stdin, applies
 * one of the sanitizer stages and writes the result to stdout unchanged
 * (no trailing newline is added), so it can be composed with other tools or
 * called from any language — including `python-docx` pipelines.
 *
 * @example
 * ```sh
 * docx-thai-cleaner '<p>สวัสดี</p>'
 * cat raw.txt | docx-thai-cleaner --mode sanitize
 * ```
 */
import { cleanThaiDocxText, fixThaiFloatingVowels, sanitizeOpenXmlNodes } from './index.js';

type Mode = 'clean' | 'fix' | 'sanitize';

const VERSION = '1.0.0';

const USAGE = `docx-thai-cleaner — Thai text sanitizer for .docx pipelines

Usage:
  docx-thai-cleaner [options] <text...>   Clean the given arguments (joined by spaces)
  docx-thai-cleaner [options] < file      Clean text read from stdin

Options:
  -m, --mode <name>    Stage to apply: clean | fix | sanitize (default: clean)
      --strip-markup   Remove every tag before sanitizing (sanitize mode only)
  -h, --help           Show this help
  -v, --version        Show the version

Stages:
  clean     Strip HTML tags, drop invisible characters, NFC-normalize, tidy spacing
  fix       Re-attach floating Thai vowels and restore tone-mark stacking order
  sanitize  Repair Thai clusters + XML-escape the text (add --strip-markup to
            drop HTML tags instead of escaping them)
`;

interface ParsedArgs {
  mode: Mode;
  stripMarkup: boolean;
  positional: string[];
  help: boolean;
  version: boolean;
  error?: string;
}

const MODES: readonly Mode[] = ['clean', 'fix', 'sanitize'];

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = { mode: 'clean', stripMarkup: false, positional: [], help: false, version: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      parsed.help = true;
    } else if (arg === '-v' || arg === '--version') {
      parsed.version = true;
    } else if (arg === '--strip-markup') {
      parsed.stripMarkup = true;
    } else if (arg === '-m' || arg === '--mode') {
      const value = argv[i + 1];
      if (value === undefined) {
        parsed.error = 'Missing value for --mode.';
        return parsed;
      }
      i += 1;
      parsed.mode = value as Mode;
    } else if (arg.startsWith('--mode=')) {
      parsed.mode = arg.slice('--mode='.length) as Mode;
    } else if (arg === '-') {
      // Explicit stdin marker: nothing to collect here.
    } else if (arg.startsWith('-') && arg.length > 1 && !/^-\d/.test(arg)) {
      parsed.error = `Unknown option: ${arg}`;
      return parsed;
    } else {
      parsed.positional.push(arg);
    }
  }

  if (!MODES.includes(parsed.mode)) {
    parsed.error = `Unknown mode: ${parsed.mode}. Expected clean, fix or sanitize.`;
  }
  return parsed;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));

  if (parsed.error) {
    process.stderr.write(`${parsed.error}\n\n${USAGE}`);
    process.exitCode = 1;
    return;
  }
  if (parsed.help) {
    process.stdout.write(USAGE);
    return;
  }
  if (parsed.version) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  const input =
    parsed.positional.length > 0 ? parsed.positional.join(' ') : process.stdin.isTTY ? '' : await readStdin();

  if (input === '') {
    process.stderr.write(USAGE);
    process.exitCode = 1;
    return;
  }

  let output: string;
  switch (parsed.mode) {
    case 'fix':
      output = fixThaiFloatingVowels(input);
      break;
    case 'sanitize':
      output = sanitizeOpenXmlNodes(input, { stripMarkup: parsed.stripMarkup });
      break;
    default:
      output = cleanThaiDocxText(input);
  }

  process.stdout.write(output);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
