/**
 * Scanner middleware for Vite dev server.
 * Handles all /api/v1/scanner/* endpoints directly — no separate API server needed.
 */

import { spawn, exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { createRequire } from 'module';
import type { IncomingMessage, ServerResponse } from 'http';
import { createClient } from '@supabase/supabase-js';

// Resolve monorepo root (vite cwd is apps/web, we need the root)
const cwd = path.resolve(process.cwd());
const projectRoot = fs.existsSync(path.join(cwd, 'scripts', 'scanWithOCR-local.ts'))
  ? cwd
  : path.resolve(cwd, '..', '..');

console.log('[scanner] cwd:', cwd);
console.log('[scanner] projectRoot:', projectRoot);

// Load .env
const envPaths = [path.join(projectRoot, '.env'), path.join(cwd, '.env')];
for (const envPath of envPaths) {
  try {
    const envContent = fs.readFileSync(envPath, 'utf8');
    console.log('[scanner] loaded .env from:', envPath);
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
    break;
  } catch { /* try next */ }
}

const dataDir = path.join(projectRoot, 'apps', 'web', 'public', 'data');
console.log('[scanner] dataDir:', dataDir);
console.log('[scanner] dataDir exists:', fs.existsSync(dataDir));

// ── State ──────────────────────────────────────────────────────────────────

let scannerPid: number | null = null;

// ── Helpers ────────────────────────────────────────────────────────────────

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => resolve(body));
  });
}

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function findFolder(dir: string, name: string, depth: number): string | null {
  if (depth > 3) return null;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.name === name) return full;
      const found = findFolder(full, name, depth + 1);
      if (found) return found;
    }
  } catch { /* permission denied */ }
  return null;
}

// ── Property mappings (for ingestion parsers) ──────────────────────────────

const KNOWN_PROPERTIES = [
  'Candlewood Suites', 'Holiday Inn Express Fulton', 'Holiday Inn Express Memphis Southwind',
  'Holiday Inn Express Tupelo', 'Holiday Inn Tupelo', 'Four Points Memphis Southwind',
  'Best Western Tupelo', 'Surestay Tupelo', 'SureStay Tupelo', 'Hyatt Place Biloxi',
  'Comfort Inn Tupelo', 'Hilton Garden Inn Olive Branch', 'TownePlace Suites',
  'Best Western Plus Olive Branch', 'Best Western Plus DeSoto',
  'Home 2 Suites by Hilton Tupelo', 'Home2 Suites by Hilton Tupelo',
  'Tru by Hilton Tupelo', 'Tru by Hilton Tueplo', // OCR typo variant
  'Holiday Inn Meridian', 'Hilton Garden Inn Meridian',
  'Hampton Inn Meridian', 'Hampton Inn Vicksburg', 'DoubleTree Biloxi', 'Hilton Garden Inn Madison',
];

const NAME_MAP: Record<string, string> = {
  'Surestay Tupelo': 'SureStay Hotel', 'SureStay Tupelo': 'SureStay Hotel',
  'Hilton Garden Inn Olive Branch': 'HGI Olive Branch',
  'Home 2 Suites by Hilton Tupelo': 'Home2 Suites By Hilton',
  'Home2 Suites by Hilton Tupelo': 'Home2 Suites By Hilton',
  'Tru by Hilton Tupelo': 'Tru By Hilton Tupelo',
  'Tru by Hilton Tueplo': 'Tru By Hilton Tupelo', // OCR typo
  'Best Western Plus DeSoto': 'Best Western Plus Olive Branch',
};

const GROUP_MAP: Record<string, string> = {
  'HGI Olive Branch': 'Hilton', 'Tru By Hilton Tupelo': 'Hilton', 'Hampton Inn Vicksburg': 'Hilton',
  'DoubleTree Biloxi': 'Hilton', 'Home2 Suites By Hilton': 'Hilton', 'Hilton Garden Inn Madison': 'Hilton',
  'Hilton Garden Inn Meridian': 'Hilton', 'Hampton Inn Meridian': 'Hilton',
  'Holiday Inn Meridian': 'IHG', 'Candlewood Suites': 'IHG', 'Holiday Inn Express Fulton': 'IHG',
  'Holiday Inn Express Memphis Southwind': 'IHG', 'Holiday Inn Express Tupelo': 'IHG', 'Holiday Inn Tupelo': 'IHG',
  'Four Points Memphis Southwind': 'Marriott', 'TownePlace Suites': 'Marriott',
  'Best Western Tupelo': 'Best Western', 'SureStay Hotel': 'Best Western', 'Best Western Plus Olive Branch': 'Best Western',
  'Hyatt Place Biloxi': 'Hyatt', 'Comfort Inn Tupelo': 'Choice',
};

const DBA_MAP: Record<string, string> = {
  'best western plus tupelo': 'Best Western Tupelo', 'hie fulton': 'Holiday Inn Express Fulton',
  'surestay tupelo': 'SureStay Hotel', 'holiday inn tupelo': 'Holiday Inn Tupelo',
  'comfort inn': 'Comfort Inn Tupelo', 'candlewood tupelo': 'Candlewood Suites',
  'hie tupelo': 'Holiday Inn Express Tupelo', 'home2 suites tupelo': 'Home2 Suites By Hilton',
  'tru by hilton tupelo': 'Tru By Hilton Tupelo', 'tps olive branch': 'TownePlace Suites',
  'hgi olive branch': 'HGI Olive Branch', 'holiday inn meridian': 'Holiday Inn Meridian',
  'hampton inn meridian': 'Hampton Inn Meridian', 'hgi meridian': 'Hilton Garden Inn Meridian',
  'hyatt place biloxi': 'Hyatt Place Biloxi', 'best western plus desoto': 'Best Western Plus Olive Branch',
  'hie memphis southwind': 'Holiday Inn Express Memphis Southwind',
  'four points memphis southwind': 'Four Points Memphis Southwind',
  'hgi madison': 'Hilton Garden Inn Madison', 'hampton inn vicksburg': 'Hampton Inn Vicksburg',
  'doubletree biloxi': 'DoubleTree Biloxi',
};

const HOTEL_MAP: Record<string, string> = {
  'bw tupelo': 'Best Western Tupelo', 'hie fulton': 'Holiday Inn Express Fulton',
  'hi tupelo': 'Holiday Inn Tupelo', 'comfort inn tupelo': 'Comfort Inn Tupelo',
  'candlewood tupelo': 'Candlewood Suites', 'hie tupelo': 'Holiday Inn Express Tupelo',
  'tru tupelo': 'Tru By Hilton Tupelo', 'tru by hilton tupelo': 'Tru By Hilton Tupelo',
  'home 2 suites': 'Home2 Suites By Hilton',
  'hyatt biloxi': 'Hyatt Place Biloxi', 'hyatt place biloxi': 'Hyatt Place Biloxi',
  'tps olive branch': 'TownePlace Suites', 'towneplace olive branch': 'TownePlace Suites',
  'hgi olive branch': 'HGI Olive Branch',
  'hilton garden inn olive branch': 'HGI Olive Branch', 'bw plus ob': 'Best Western Plus Olive Branch',
  'best western plus desoto': 'Best Western Plus Olive Branch',
  'hgi madison': 'Hilton Garden Inn Madison', 'holiday inn meridian': 'Holiday Inn Meridian',
  'hampton inn meridian': 'Hampton Inn Meridian', 'hgi meridian': 'Hilton Garden Inn Meridian',
  'hampton inn vicksburg': 'Hampton Inn Vicksburg', 'doubletree biloxi': 'DoubleTree Biloxi',
  'fp southwind': 'Four Points Memphis Southwind', 'four points memphis southwind': 'Four Points Memphis Southwind',
  'hie southwind': 'Holiday Inn Express Memphis Southwind',
  'hie memphis southwind': 'Holiday Inn Express Memphis Southwind',
  'surestay tupelo': 'SureStay Hotel',
  'hie olive branch': 'Holiday Inn Express Olive Branch',
};

// ── Parsers ────────────────────────────────────────────────────────────────

function parseNum(s: string | undefined): number | null {
  if (!s) return null;
  let c = s.replace(/[$,%\s]/g, '');
  if (c.startsWith('(') && c.endsWith(')')) c = '-' + c.slice(1, -1);
  const v = parseFloat(c);
  return isNaN(v) ? null : v;
}

function parsePct(s: string | undefined): number | null {
  if (!s) return null;
  const v = parseFloat(s.replace(/[%\s]/g, ''));
  if (isNaN(v)) return null;
  // Decimal fraction (0.42 = 42%, 1.00 = 100%) — hotel occupancy is never truly <= 1%
  if (v > 0 && v <= 1) return Math.round(v * 10000) / 100;
  return v;
}

function parseRevenueFlash(text: string, date: string): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let matched: string | null = null;
    let remainder = '';
    for (const prop of KNOWN_PROPERTIES) {
      const regex = new RegExp(`^${prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[.,]?\\s*`, 'i');
      const m = trimmed.match(regex);
      if (m) { matched = prop; remainder = trimmed.slice(m[0].length).trim(); break; }
    }
    if (!matched) continue;
    const canonical = NAME_MAP[matched] ?? matched;
    if (seen.has(canonical)) continue;
    // Fix OCR artifacts: double dots (e.g. "106..46" → "106.46")
    const cleaned = remainder.replace(/\.{2,}/g, '.');
    const tokens = cleaned.match(/\(?\$?[\d,]+\.?\d*%?\)?/g) ?? [];
    if (tokens.length < 8) continue;
    seen.add(canonical);
    rows.push({
      property_name: canonical, property_group: GROUP_MAP[canonical] ?? 'Other', report_date: date,
      occupancy_day: parsePct(tokens[0]), adr_day: parseNum(tokens[1]), revpar_day: parseNum(tokens[2]),
      total_rooms_sold: parseNum(tokens[3]), revenue_day: parseNum(tokens[4]),
      ooo_rooms: parseNum(tokens[5]), py_revenue_day: parseNum(tokens[6]),
      occupancy_mtd: tokens.length > 8 ? parsePct(tokens[8]) : null,
      adr_mtd: tokens.length > 9 ? parseNum(tokens[9]) : null,
      revpar_mtd: tokens.length > 10 ? parseNum(tokens[10]) : null,
      revenue_mtd: tokens.length > 11 ? parseNum(tokens[11]) : null,
      py_revenue_mtd: tokens.length > 12 ? parseNum(tokens[12]) : null,
      occupancy_ytd: tokens.length > 14 ? parsePct(tokens[14]) : null,
      adr_ytd: tokens.length > 15 ? parseNum(tokens[15]) : null,
      revpar_ytd: tokens.length > 16 ? parseNum(tokens[16]) : null,
      revenue_ytd: tokens.length > 17 ? parseNum(tokens[17]) : null,
      py_revenue_ytd: tokens.length > 18 ? parseNum(tokens[18]) : null,
      report_format: 'revenue-flash',
    });
  }
  return rows;
}

function parseFlashReport(text: string, date: string): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  const sections = text.split(/(?=Entity Name)/);
  for (const section of sections) {
    const lines = section.split('\n').filter((l: string) => l.trim());
    let dbaRow: string[] = [];
    const metricRows: { label: string; cells: string[] }[] = [];
    for (const line of lines) {
      const hasTabs = line.includes('\t');
      if (hasTabs) {
        const cells = line.split('\t');
        const label = cells[0]?.trim() || cells[1]?.trim() || '';
        const dataCells = cells.slice(2).map((c: string) => c.trim());
        // Stop before Portfolio Total summary rows that would overwrite per-property data
        if (/^(Portfolio Total|Total Outstanding)/i.test(label)) break;
        if (label === 'DBA') dbaRow = dataCells;
        else if (label === 'Entity Name' || label === 'Date' || /^\d{2}\/\d{2}\/\d{4}/.test(label)) { /* skip */ }
        else if (label === 'Total' || (!cells[0]?.trim() && !cells[1]?.trim() && dataCells[0] && !/^\d{1,2}\/\d{1,2}\/\d{4}/.test(dataCells[0]))) metricRows.push({ label: 'AR Total', cells: dataCells });
        else if (label) metricRows.push({ label, cells: dataCells });
      } else {
        const parts = line.split(/\s{3,}/).map((s: string) => s.trim()).filter(Boolean);
        const label = parts[0] ?? '';
        const cells = parts.slice(1);
        // Stop before Portfolio Total summary rows
        if (/^(Portfolio Total|Total Outstanding)/i.test(label)) break;
        if (label === 'DBA') dbaRow = cells;
        else if (label === 'Entity Name' || label === 'Date' || /^\d{1,2}\/\d{1,2}\/\d{4}/.test(label)) { /* skip */ }
        else if (label === 'Total') metricRows.push({ label: 'AR Total', cells });
        else if (/^[-$]/.test(label) && cells.length > 0) metricRows.push({ label: 'AR Total', cells: [label, ...cells] });
        else if (cells.length > 0) metricRows.push({ label, cells });
      }
    }
    for (let i = 0; i < dbaRow.length; i++) {
      const dba = dbaRow[i];
      if (!dba || dba === 'Total') continue;
      const name = DBA_MAP[dba.toLowerCase().trim()];
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const v: Record<string, string> = {};
      for (const r of metricRows) v[r.label] = r.cells[i] ?? '';
      let occ = parseNum(v['Occupancy %']);
      if (occ != null && occ > 0 && occ <= 1) occ = Math.round(occ * 1000) / 10;
      rows.push({
        property_name: name, entity_name: '', property_group: GROUP_MAP[name] ?? 'Other', report_date: date,
        occupancy_pct: occ, adr: parseNum(v['ADR']), revpar: parseNum(v['RevPAR']),
        room_revenue: parseNum(v['Room Revenue']), fb_revenue: parseNum(v['F&B Revenue']),
        rooms_occupied: parseNum(v['Rooms Occupied']), rooms_ooo: parseNum(v['Rooms OOO']),
        rooms_dirty: parseNum(v['Rooms Dirty']), room_nights_reserved: parseNum(v['Room Nights Reserved Today']),
        no_shows: parseNum(v['No Shows']),
        ar_up_to_30: parseNum(v['Accounts Up to 30 Days']), ar_over_30: parseNum(v['Accounts Over 30 Days']),
        ar_over_60: parseNum(v['Accounts Over 60 Days']), ar_over_90: parseNum(v['Accounts Over 90 Days']),
        ar_over_120: parseNum(v['Accounts Over 120 Days']), ar_total: parseNum(v['AR Total']),
      });
    }
  }
  return rows;
}

function parseEngineering(text: string, date: string): Record<string, unknown>[] {
  // Normalize \r\n inside cells to spaces — prevents phantom rows and truncated reasons
  const normalized = text.replace(/\r\n/g, ' ').replace(/\r/g, '');
  const rooms: Record<string, unknown>[] = [];
  const sheets = normalized.split(/=== Sheet:\s*/);
  for (const sheet of sheets) {
    const firstLine = sheet.split('\n')[0]?.trim() ?? '';
    const isLongTerm = firstLine.includes('Long Term');
    if (!firstLine.includes('OOO')) continue;
    for (const line of sheet.split('\n').slice(1)) {
      const cells = line.split('\t');
      const hotel = cells[0]?.trim();
      const roomNum = cells[1]?.trim();
      if (!hotel || !roomNum || hotel === 'Hotel' || hotel === 'Engineering Flash') continue;
      rooms.push({
        property_name: HOTEL_MAP[hotel.toLowerCase().trim()] ?? hotel,
        report_date: date, room_number: roomNum,
        date_ooo: cells[2]?.trim() || null, reason: cells[3]?.trim() || null,
        notes: cells[4]?.trim() || null, is_long_term: isLongTerm,
      });
    }
  }
  return rooms;
}

// ── Route handlers ─────────────────────────────────────────────────────────

async function handleResolveFolder(req: IncomingMessage, res: ServerResponse) {
  const body = JSON.parse(await readBody(req));
  const folderName = body?.folderName?.trim();
  if (!folderName) return json(res, 400, { success: false, message: 'folderName is required' });

  const homeDir = os.homedir();

  // Discover all OneDrive roots (personal + business accounts)
  const oneDriveRoots: string[] = [];
  try {
    for (const entry of fs.readdirSync(homeDir, { withFileTypes: true })) {
      if (entry.isDirectory() && /^OneDrive/i.test(entry.name)) {
        oneDriveRoots.push(path.join(homeDir, entry.name));
      }
    }
  } catch { /* ignore */ }

  const candidates = [
    path.join(projectRoot, folderName),
    path.join(homeDir, 'Downloads', folderName),
    path.join(homeDir, 'Downloads', 'crm-fusion-hospitality', folderName),
    path.join(homeDir, 'Desktop', folderName),
    path.join(homeDir, 'Documents', folderName),
    // All discovered OneDrive roots (personal, business, shared)
    ...oneDriveRoots.map((root) => path.join(root, folderName)),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) return json(res, 200, { success: true, folderPath: c });
  }

  const searchRoots = [
    projectRoot,
    path.join(homeDir, 'Downloads'),
    path.join(homeDir, 'Desktop'),
    path.join(homeDir, 'Documents'),
    ...oneDriveRoots,
  ];
  for (const root of searchRoots) {
    const found = findFolder(root, folderName, 0);
    if (found) return json(res, 200, { success: true, folderPath: found });
  }

  return json(res, 200, { success: false, folderPath: null, message: 'Folder not found.' });
}

async function handleStart(req: IncomingMessage, res: ServerResponse) {
  const body = JSON.parse(await readBody(req));
  const folderPath = body?.folderPath?.trim();
  const clientStartedAt = body?.startedAt ?? new Date().toISOString();
  if (!folderPath) return json(res, 400, { success: false, message: 'folderPath is required' });

  const scriptPath = path.join(projectRoot, 'scripts', 'scanWithOCR-local.ts');
  const progressPath = path.join(dataDir, 'scan-progress.json');

  console.log('[scanner/start] folderPath:', folderPath);
  console.log('[scanner/start] scriptPath:', scriptPath);
  console.log('[scanner/start] scriptExists:', fs.existsSync(scriptPath));
  console.log('[scanner/start] progressPath:', progressPath);
  console.log('[scanner/start] clientStartedAt:', clientStartedAt);

  // Clear old progress with the client's timestamp so frontend recognizes it
  try {
    fs.mkdirSync(path.dirname(progressPath), { recursive: true });
    fs.writeFileSync(progressPath, JSON.stringify({
      status: 'scanning', startedAt: clientStartedAt,
      currentDate: '', currentDateIndex: 0, totalDateFolders: 0,
      filesProcessed: 0, filesInCurrentDate: 0, totalFilesEstimate: 0,
      elapsedMs: 0, currentFile: '',
    }));
    console.log('[scanner/start] cleared progress file');
  } catch (e) { console.error('[scanner/start] failed to clear progress:', e); }

  const cjsRequire = createRequire(import.meta.url);
  const tsxCli = cjsRequire.resolve('tsx/cli');
  console.log('[scanner/start] tsxCli:', tsxCli);
  console.log('[scanner/start] node:', process.execPath);
  console.log('[scanner/start] cwd:', projectRoot);

  // Spawn fully detached — stdio must be 'ignore' on Windows to prevent
  // a console window from flashing open (piped streams keep a handle to
  // the parent console, defeating windowsHide).
  const child = spawn(process.execPath, [tsxCli, scriptPath, folderPath], {
    cwd: projectRoot,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });

  child.on('error', (err) => {
    console.error('[scanner/start] spawn error:', err);
  });

  child.on('exit', (code, signal) => {
    console.log(`[scanner/start] process exited code=${code} signal=${signal}`);
    scannerPid = null;
  });

  child.unref();
  scannerPid = child.pid ?? null;

  console.log('[scanner/start] spawned pid:', child.pid);

  return json(res, 202, { success: true, message: 'Scan started', pid: child.pid });
}

async function handleCancel(_req: IncomingMessage, res: ServerResponse) {
  if (!scannerPid) return json(res, 200, { success: false, message: 'No scan is running.' });

  try {
    if (process.platform === 'win32') {
      exec(`taskkill /pid ${scannerPid} /T /F`, () => {});
    } else {
      process.kill(-scannerPid, 'SIGTERM');
    }
  } catch { /* already exited */ }

  scannerPid = null;

  // Clear progress file so UI doesn't show stale data
  const progressPath = path.join(dataDir, 'scan-progress.json');
  try {
    fs.writeFileSync(progressPath, JSON.stringify({ status: 'error', startedAt: '', currentDate: '', currentDateIndex: 0, totalDateFolders: 0, filesProcessed: 0, filesInCurrentDate: 0, totalFilesEstimate: 0, elapsedMs: 0, currentFile: '', errorMessage: 'Cancelled' }));
  } catch { /* ignore */ }

  console.log('[scanner/cancel] scan cancelled and progress cleared');
  return json(res, 200, { success: true, message: 'Scan cancelled.' });
}

async function handleIngest(_req: IncomingMessage, res: ServerResponse) {
  const outputPath = path.join(dataDir, 'output.json');

  let data: { results: Record<string, unknown>[] };
  try {
    data = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  } catch {
    return json(res, 404, { success: false, message: 'No output.json found. Run a scan first.' });
  }

  const results = data.results ?? [];
  if (results.length === 0) return json(res, 400, { success: false, message: 'output.json has no results.' });

  const supaUrl = 'https://cqnbtcbiwhdmqbitxhsk.supabase.co';
  const supaKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNxbmJ0Y2Jpd2hkbXFiaXR4aHNrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDk3OTg0NiwiZXhwIjoyMDkwNTU1ODQ2fQ.pAt8s-z1s7vvZYQWcoarJWEqgUavjyCz4w1Iipssuvc';

  const supabase = createClient(supaUrl, supaKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const allDates = [...new Set(results.map((r) => r['dateFolder'] as string).filter(Boolean))].sort();
  let totalRF = 0, totalFR = 0, totalEng = 0;
  const errors: string[] = [];

  for (const date of allDates) {
    // Revenue Flash
    const rfFiles = results.filter((r) => r['dateFolder'] === date && r['reportType'] === 'Revenue Flash' && r['fullText'])
      .sort((a, b) => ((b['fullText'] as string)?.length ?? 0) - ((a['fullText'] as string)?.length ?? 0));
    const rfRows: Record<string, unknown>[] = [];
    const rfSeen = new Set<string>();
    for (const rf of rfFiles) {
      for (const row of parseRevenueFlash(rf['fullText'] as string, date)) {
        if (!rfSeen.has(row['property_name'] as string)) { rfSeen.add(row['property_name'] as string); rfRows.push(row); }
      }
    }
    if (rfRows.length > 0) {
      const { error } = await supabase.from('daily_hotel_performance').upsert(rfRows, { onConflict: 'property_name,report_date' });
      if (error) errors.push(`RF ${date}: ${error.message}`); else totalRF += rfRows.length;
    }

    // Flash Report
    const frFiles = results.filter((r) => r['dateFolder'] === date && (r['fileName'] as string)?.toLowerCase().includes('flash report') && !(r['fileName'] as string)?.toLowerCase().includes('revenue') && r['fullText'])
      .sort((a, b) => { const ap = (a['extension'] as string) === '.pdf' ? 1 : 0; const bp = (b['extension'] as string) === '.pdf' ? 1 : 0; return bp - ap; });
    if (frFiles.length > 0) {
      const frRows = parseFlashReport(frFiles[0]!['fullText'] as string, date);
      if (frRows.length > 0) {
        const { error } = await supabase.from('flash_report').upsert(frRows, { onConflict: 'property_name,report_date' });
        if (error) errors.push(`FR ${date}: ${error.message}`); else totalFR += frRows.length;
      }
    }

    // Engineering Flash
    const engFiles = results.filter((r) => r['dateFolder'] === date && (r['fileName'] as string)?.toLowerCase().includes('engineering flash') && !(r['fileName'] as string)?.toLowerCase().includes('template') && r['fullText'])
      .sort((a, b) => ((b['fullText'] as string)?.length ?? 0) - ((a['fullText'] as string)?.length ?? 0));
    if (engFiles.length > 0) {
      const engRows = parseEngineering(engFiles[0]!['fullText'] as string, date);
      if (engRows.length > 0) {
        const { error } = await supabase.from('engineering_ooo_rooms').upsert(engRows, { onConflict: 'property_name,report_date,room_number,is_long_term' });
        if (error) errors.push(`Eng ${date}: ${error.message}`); else totalEng += engRows.length;
      }
    }
  }

  const totalIngested = totalRF + totalFR + totalEng;
  const partialSuccess = errors.length > 0 && totalIngested > 0;
  return json(res, 200, {
    success: errors.length === 0 || partialSuccess,
    message: partialSuccess ? `Ingested ${totalIngested} rows with ${errors.length} warning(s)` : undefined,
    data: { dates: allDates.length, revenueFlash: totalRF, flashReport: totalFR, engineering: totalEng, errors },
  });
}

// ── Download files as zip by date range ────────────────────────────────────

async function handleDownload(req: IncomingMessage, res: ServerResponse) {
  const body = JSON.parse(await readBody(req));
  const startDate: string | undefined = body?.startDate?.trim();
  const endDate: string | undefined = body?.endDate?.trim();

  if (!startDate || !endDate) return json(res, 400, { success: false, message: 'startDate and endDate are required (YYYY-MM-DD)' });

  const outputPath = path.join(dataDir, 'output.json');
  let data: { results: Record<string, unknown>[] };
  try {
    data = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  } catch {
    return json(res, 404, { success: false, message: 'No scan data found. Run a scan first.' });
  }

  const results = (data.results ?? []).filter((r) => {
    const d = r['dateFolder'] as string;
    return d && d >= startDate && d <= endDate;
  });

  if (results.length === 0) return json(res, 404, { success: false, message: `No files found between ${startDate} and ${endDate}` });

  // Build zip in memory using AdmZip
  const AdmZip = (await import('adm-zip')).default;
  const zip = new AdmZip();

  let added = 0;
  for (const r of results) {
    const filePath = r['filePath'] as string;
    const dateFolder = r['dateFolder'] as string;
    const propertyFolder = r['propertyFolder'] as string;
    const fileName = r['fileName'] as string;

    if (!filePath) continue;

    // Normalize path separators for the filesystem
    const normalizedPath = filePath.replace(/\//g, path.sep);

    try {
      if (!fs.existsSync(normalizedPath)) continue;
      // Organize in zip as: dateFolder/propertyFolder/fileName
      const zipDir = propertyFolder && propertyFolder !== '(standalone)'
        ? `${dateFolder}/${propertyFolder}`
        : dateFolder;
      zip.addLocalFile(normalizedPath, zipDir, fileName);
      added++;
    } catch {
      // Skip files we can't read
    }
  }

  if (added === 0) return json(res, 404, { success: false, message: 'No files could be read from disk. They may have been moved or deleted.' });

  const zipBuffer = zip.toBuffer();
  const zipName = `scan-export-${startDate}-to-${endDate}.zip`;

  res.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${zipName}"`,
    'Content-Length': zipBuffer.length.toString(),
  });
  res.end(zipBuffer);
}

// ── Vite plugin export ─────────────────────────────────────────────────────

export function scannerMiddlewarePlugin() {
  return {
    name: 'scanner-api',
    configureServer(server: { middlewares: { use: Function } }) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: Function) => {
        const url = req.url?.split('?')[0] ?? '';

        if (!url.startsWith('/api/v1/scanner/')) return next();

        const route = url.replace('/api/v1/scanner/', '');
        console.log(`[scanner-middleware] ${req.method} ${url} → route="${route}"`);

        try {
          if (route === 'progress' && req.method === 'GET') {
            const progressPath = path.join(dataDir, 'scan-progress.json');
            try {
              const raw = fs.readFileSync(progressPath, 'utf8');
              res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
              res.end(raw);
            } catch {
              json(res, 200, { status: 'idle', filesProcessed: 0, totalFilesEstimate: 0 });
            }
            return;
          }
          if (route === 'resolve-folder' && req.method === 'POST') return await handleResolveFolder(req, res);
          if (route === 'start' && req.method === 'POST') return await handleStart(req, res);
          if (route === 'cancel' && req.method === 'POST') return await handleCancel(req, res);
          if (route === 'ingest' && req.method === 'POST') return await handleIngest(req, res);
          if (route === 'download' && req.method === 'POST') return await handleDownload(req, res);
          return json(res, 404, { error: 'Not found' });
        } catch (err) {
          console.error('Scanner API error:', err);
          return json(res, 500, { success: false, message: String(err) });
        }
      });
    },
  };
}
