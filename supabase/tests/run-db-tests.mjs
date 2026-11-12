#!/usr/bin/env node
// Runs the pgTAP DB tests (supabase/tests/database/*.test.sql) against the `dev` Supabase
// project without Docker (PROJECT_PLAN decision D13).
//
// Each test file is sent as ONE transaction through `supabase db query --remote=<ref>`:
//   BEGIN; [pending migrations] <_helpers.sql> <file>; SELECT * FROM runtests(...); ROLLBACK;
// so nothing is ever committed. pgTAP's runtests() returns the whole TAP stream as one result.
//
// Usage:
//   node supabase/tests/run-db-tests.mjs [--with-migrations] [--project-ref <ref>] [filter ...]
//
//   --with-migrations     also run the migrations that are NOT yet in the remote migration
//                         history, first, inside the same rolled-back transaction. Use it to test
//                         new migrations BEFORE `supabase db push`.
//   --project-ref <ref>   target this project instead of the dev project. Without it the runner
//                         refuses to run unless supabase/.temp/project-ref is the dev project.
//   filter                only run test files whose name contains one of the filters.
//
// Safety:
//   * The target ref is pinned on every CLI call (`--remote=<ref>`), never "whatever is linked".
//   * Every SQL part sent (pending migrations, helpers, test files) is rejected if it contains
//     top-level transaction control (COMMIT / END / ROLLBACK / ABORT) outside comments, string
//     literals and dollar-quoted bodies — that would end the wrapping transaction and let the
//     rest of the script commit for real.
//
// Needs a logged-in Supabase CLI (`supabase login`); no DB password. Exit code 1 if any test
// fails, a file errors or a safety check fails.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEV_PROJECT_REF = 'hnabofhgpefcjjzlxwbm'; // trip-planner-dev

const testsDir = dirname(fileURLToPath(import.meta.url));
const supabaseDir = resolve(testsDir, '..');
const repoDir = resolve(supabaseDir, '..');
const databaseDir = join(testsDir, 'database');
const migrationsDir = join(supabaseDir, 'migrations');
const linkedRefFile = join(supabaseDir, '.temp', 'project-ref');
const cli = join(repoDir, 'node_modules', 'supabase', 'dist', 'supabase.js');

function fail(message) {
  console.error(`run-db-tests: ${message}`);
  process.exit(1);
}

// --- Arguments -------------------------------------------------------------------------------

const args = process.argv.slice(2);
let withMigrations = false;
let explicitRef = null;
const filters = [];
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--with-migrations') withMigrations = true;
  else if (arg === '--project-ref') explicitRef = args[(i += 1)] ?? '';
  else if (arg.startsWith('--project-ref=')) explicitRef = arg.slice('--project-ref='.length);
  else if (arg.startsWith('--')) fail(`unknown option ${arg}`);
  else filters.push(arg);
}

// --- Target project ----------------------------------------------------------------------------

let projectRef;
if (explicitRef !== null) {
  if (!/^[a-z0-9]{20}$/.test(explicitRef)) fail(`--project-ref "${explicitRef}" is not a ref`);
  projectRef = explicitRef;
} else {
  const linked = existsSync(linkedRefFile) ? readFileSync(linkedRefFile, 'utf8').trim() : '';
  if (linked !== DEV_PROJECT_REF) {
    fail(
      `refusing to run: the linked project is "${linked || 'none'}", not the dev project ` +
        `${DEV_PROJECT_REF}. Pass --project-ref <ref> to target another project on purpose.`,
    );
  }
  projectRef = DEV_PROJECT_REF;
}
console.log(`# target project: ${projectRef}`);

// --- SQL safety check --------------------------------------------------------------------------

/**
 * Replaces comments, string literals, quoted identifiers and dollar-quoted bodies with spaces
 * (newlines kept), so only top-level SQL text remains.
 */
function stripNonTopLevel(sql) {
  let out = '';
  let i = 0;
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  while (i < sql.length) {
    const rest = sql.slice(i);
    let m;
    if (rest.startsWith('--')) {
      const end = rest.indexOf('\n');
      const len = end === -1 ? rest.length : end;
      out += blank(rest.slice(0, len));
      i += len;
    } else if (rest.startsWith('/*')) {
      let depth = 0;
      let j = 0;
      while (j < rest.length) {
        if (rest.startsWith('/*', j)) {
          depth += 1;
          j += 2;
        } else if (rest.startsWith('*/', j)) {
          depth -= 1;
          j += 2;
          if (depth === 0) break;
        } else j += 1;
      }
      out += blank(rest.slice(0, j));
      i += j;
    } else if (/^[eE]'/.test(rest) && (i === 0 || !/[A-Za-z0-9_$]/.test(sql[i - 1]))) {
      // E'…' escape string: backslash escapes the next character (E'it\'s'), '' is a quote.
      let j = 2;
      while (j < rest.length) {
        if (rest[j] === '\\') j += 2;
        else if (rest[j] === "'" && rest[j + 1] === "'") j += 2;
        else if (rest[j] === "'") {
          j += 1;
          break;
        } else j += 1;
      }
      out += blank(rest.slice(0, j));
      i += j;
    } else if (rest[0] === "'" || rest[0] === '"') {
      const q = rest[0];
      let j = 1;
      while (j < rest.length) {
        if (rest[j] === q && rest[j + 1] === q) j += 2;
        else if (rest[j] === q) {
          j += 1;
          break;
        } else j += 1;
      }
      out += blank(rest.slice(0, j));
      i += j;
    } else if ((m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(rest))) {
      const tag = m[0];
      const close = rest.indexOf(tag, tag.length);
      const len = close === -1 ? rest.length : close + tag.length;
      out += blank(rest.slice(0, len));
      i += len;
    } else {
      out += sql[i];
      i += 1;
    }
  }
  return out;
}

// Statements that end (or hand off) the wrapping transaction, at the start of a line or right
// after a `;` (catches "select 1; commit;"): COMMIT, END, ROLLBACK, ABORT, PREPARE TRANSACTION.
// ROLLBACK [WORK | TRANSACTION] TO [SAVEPOINT] keeps the transaction open and is allowed.
// A top-level CASE whose `end` starts a line is a false positive; refusing to run is the safe side.
const TRANSACTION_END =
  /(?:^|;)\s*(commit|end|rollback(?!\s+(?:(?:work|transaction)\s+)?to\b)|abort|prepare\s+transaction)\b/im;

function assertNoTransactionEnd(label, sql) {
  const top = stripNonTopLevel(sql);
  const m = TRANSACTION_END.exec(top);
  if (m) {
    const line = top.slice(0, m.index + m[0].search(/[a-z]/i)).split('\n').length;
    const keyword = m[1].replace(/\s+/g, ' ').toUpperCase();
    fail(
      `refusing to run: ${label} contains top-level "${keyword}" near line ${line}; ` +
        'it would end the wrapping transaction and commit the rest of the script.',
    );
  }
}

// --- CLI helper --------------------------------------------------------------------------------

function query(args) {
  return spawnSync(
    process.execPath,
    [cli, 'db', 'query', `--remote=${projectRef}`, '--agent', 'no', '-o', 'json', ...args],
    { cwd: repoDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
}

// --- Inputs ------------------------------------------------------------------------------------

const sqlFiles = (dir) =>
  readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

const helpers = readFileSync(join(databaseDir, '_helpers.sql'), 'utf8');
assertNoTransactionEnd('_helpers.sql', helpers);

let migrations = '';
if (withMigrations) {
  const applied = query([
    '--read-only',
    'select version from supabase_migrations.schema_migrations order by version',
  ]);
  if (applied.status !== 0) fail(`could not read the remote migration history:\n${applied.stderr}`);
  const appliedVersions = new Set(JSON.parse(applied.stdout).map((r) => String(r.version)));
  const pending = sqlFiles(migrationsDir).filter((f) => !appliedVersions.has(f.split('_')[0]));
  console.log(`# pending migrations: ${pending.length ? pending.join(', ') : 'none'}`);
  migrations = pending
    .map((f) => {
      const text = readFileSync(join(migrationsDir, f), 'utf8');
      assertNoTransactionEnd(`migration ${f}`, text);
      return `-- migration ${f}\n${text}`;
    })
    .join('\n');
}

const testFiles = sqlFiles(databaseDir).filter(
  (f) => f.endsWith('.test.sql') && (filters.length === 0 || filters.some((x) => f.includes(x))),
);
if (testFiles.length === 0) fail('no test files matched.');

const bodies = new Map(
  testFiles.map((f) => {
    const text = readFileSync(join(databaseDir, f), 'utf8');
    assertNoTransactionEnd(f, text);
    return [f, text];
  }),
);

// --- Run ---------------------------------------------------------------------------------------

const workDir = mkdtempSync(join(tmpdir(), 'tp-db-tests-'));
let failedFiles = 0;
let totalOk = 0;
let totalNotOk = 0;

try {
  for (const file of testFiles) {
    const script = [
      'begin;',
      migrations,
      helpers,
      bodies.get(file),
      "select * from runtests('tests'::name, '^test_');",
      'rollback;',
      '',
    ].join('\n');
    const scriptPath = join(workDir, file);
    writeFileSync(scriptPath, script, 'utf8');

    console.log(`# ${file}`);
    const run = query(['--yes', '-f', scriptPath]);

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
