import 'dotenv/config';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

if (!process.env.DATABASE_URL) {
  console.error('Missing required environment variable: DATABASE_URL');
  process.exit(1);
}

const dir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

await client.connect();
await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');

const applied = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

for (const file of files) {
  if (applied.has(file)) {
    console.log(`skip ${file}`);
    continue;
  }
  await client.query('BEGIN');
  await client.query(readFileSync(join(dir, file), 'utf8'));
  await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
  await client.query('COMMIT');
  console.log(`applied ${file}`);
}

await client.end();
