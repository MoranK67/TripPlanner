#!/usr/bin/env node
// Runs the pgTAP DB tests (supabase/tests/database/*.test.sql) against the linked Supabase
// project without Docker (PROJECT_PLAN decision D13).
//
// Each test file is sent as ONE transaction through `supabase db query --remote`:
//   BEGIN; <_helpers.sql> <file>; SELECT * FROM runtests('tests', '^test_'); ROLLBACK;
// so nothing is ever committed. pgTAP's runtests() returns the whole TAP stream as one result.
//
// Usage:
//   node supabase/tests/run-db-tests.mjs [--with-migrations] [name-filter ...]
//
//   --with-migrations  also run every migration in supabase/migrations first, inside the same
//                      rolled-back transaction. Use it to test migrations BEFORE `db push`
//                      (the remote must not already contain them).
//   name-filter        only run test files whose name contains one of the filters.
//
// Needs a logged-in, linked Supabase CLI (`supabase login` + `supabase link`); no DB password.
// Exit code 1 if any test fails or a file errors.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testsDir = dirname(fileURLToPath(import.meta.url));
const supabaseDir = resolve(testsDir, '..');
const repoDir = resolve(supabaseDir, '..');
const databaseDir = join(testsDir, 'database');
const migrationsDir = join(supabaseDir, 'migrations');
const cli = join(repoDir, 'node_modules', 'supabase', 'dist', 'supabase.js');

const args = process.argv.slice(2);
const withMigrations = args.includes('--with-migrations');
const filters = args.filter((a) => !a.startsWith('--'));

const sqlFiles = (dir) =>
  readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

const helpers = readFileSync(join(databaseDir, '_helpers.sql'), 'utf8');
const migrations = withMigrations
  ? sqlFiles(migrationsDir)
      .map((f) => `-- migration ${f}\n${readFileSync(join(migrationsDir, f), 'utf8')}`)
      .join('\n')
  : '';

const testFiles = sqlFiles(databaseDir).filter(
  (f) => f.endsWith('.test.sql') && (filters.length === 0 || filters.some((x) => f.includes(x))),
);

if (testFiles.length === 0) {
  console.error('No test files matched.');
  process.exit(1);
}

const workDir = mkdtempSync(join(tmpdir(), 'tp-db-tests-'));
let failedFiles = 0;
let totalOk = 0;
let totalNotOk = 0;

try {
  for (const file of testFiles) {
    const body = readFileSync(join(databaseDir, file), 'utf8');
    const script = [
      'begin;',
      migrations,
      helpers,
      body,
      "select * from runtests('tests'::name, '^test_');",
      'rollback;',
      '',
    ].join('\n');
    const scriptPath = join(workDir, file);
    writeFileSync(scriptPath, script, 'utf8');

    console.log(`# ${file}`);
    const run = spawnSync(
      process.execPath,
      [cli, 'db', 'query', '--remote', '--yes', '--agent', 'no', '-o', 'json', '-f', scriptPath],
      { cwd: repoDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );

    if (run.status !== 0) {
      failedFiles += 1;
      console.log(`not ok - ${file} did not run`);
      console.log((run.stderr || run.stdout || '').trim().replace(/^/gm, '#   '));
      continue;
    }

    let rows;
    try {
      rows = JSON.parse(run.stdout);
    } catch {
      failedFiles += 1;
      console.log(`not ok - ${file}: unexpected CLI output`);
      console.log(run.stdout.trim().replace(/^/gm, '#   '));
      continue;
    }

    const lines = rows.map((row) => String(Object.values(row)[0]));
    for (const line of lines) console.log(line);

    // Top-level results of runtests() are one line per test function ("ok N - tests.test_x"),
    // nested assertions are indented. Count the nested ones for the summary.
    const nested = lines.filter((l) => /^\s+(not )?ok \d+/.test(l));
    const fileNotOk = lines.filter((l) => /^\s*not ok \d+/.test(l)).length;
    totalOk += nested.filter((l) => /^\s+ok \d+/.test(l)).length;
    totalNotOk += nested.filter((l) => /^\s+not ok \d+/.test(l)).length;
    const planProblem = lines.some((l) => /# Looks like/.test(l));
    if (fileNotOk > 0 || planProblem || lines.length === 0) failedFiles += 1;
  }
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

console.log(
  `# ${testFiles.length} file(s), ${totalOk} assertion(s) passed, ${totalNotOk} failed, ` +
    `${failedFiles} file(s) with failures`,
);
process.exit(failedFiles > 0 ? 1 : 0);
