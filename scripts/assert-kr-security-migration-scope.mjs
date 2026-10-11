#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const expected = process.argv.slice(2).sort();
const allowed = ['20261010100000', '20261010110000'];
if (expected.length !== allowed.length || expected.some((id, i) => id !== allowed[i])) {
  process.stderr.write('KR migration scope arguments are not the fixed reviewed bundle.\n');
  process.exit(2);
}

const output = readFileSync(0, 'utf8');
const lines = output.split(/\r?\n/);
const heading = lines.findIndex((line) => /would push these migrations/i.test(line));
if (heading < 0) {
  process.stderr.write('Supabase CLI dry-run format was not recognized; refusing deployment.\n');
  process.exit(1);
}

const actual = [];
for (const line of lines.slice(heading + 1)) {
  const match = line.match(/^\s*(?:[•*\-]\s*)?(\d{14})(?:[_\s].*)?\s*$/);
  if (match) actual.push(match[1]);
  else if (actual.length && line.trim() === '') break;
}
const normalized = [...new Set(actual)].sort();
if (normalized.length !== expected.length || normalized.some((id, i) => id !== expected[i])) {
  process.stderr.write(`Refusing deployment: expected exact migration set [${expected.join(',')}], got [${normalized.join(',')}].\n`);
  process.exit(1);
}
process.stdout.write('Exact KR migration set verified.\n');
