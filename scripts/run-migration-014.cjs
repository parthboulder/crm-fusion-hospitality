// One-shot: apply migration 014 (ocr_jobs classification cols) and reload PostgREST cache.
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// Minimal .env parser — pulls DIRECT_URL/DATABASE_URL without needing dotenv.
const envText = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const envMap = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) envMap[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const url = envMap.DIRECT_URL || envMap.DATABASE_URL;
if (!url) { console.error('No DIRECT_URL/DATABASE_URL'); process.exit(1); }

const sql = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '014_ocr_jobs_classification.sql'),
  'utf8',
);

(async () => {
  // Supabase direct-host only resolves over IPv6 from this network — force family:6.
  const dns = require('dns').promises;
  const u = new URL(url);
  const lookup = await dns.lookup(u.hostname, { family: 6 });
  console.log('resolved', u.hostname, '→', lookup.address);
  const client = new Client({
    host: lookup.address,
    port: Number(u.port || 5432),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, '') || 'postgres',
    ssl: { rejectUnauthorized: false, servername: u.hostname },
  });
  await client.connect();
  console.log('connected');
  await client.query(sql);
  console.log('migration applied');
  await client.query("NOTIFY pgrst, 'reload schema'");
  console.log('schema reload notified');
  const { rows } = await client.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name='ocr_jobs' AND column_name IN ('property','date_folder','report_type','report_category') ORDER BY column_name",
  );
  console.log('verified columns:', rows.map((r) => r.column_name));
  await client.end();
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
