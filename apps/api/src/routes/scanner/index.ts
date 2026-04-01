/**
 * Scanner route — spawns the local OCR scanner script and ingests results to Supabase.
 */

import type { FastifyInstance } from 'fastify';
import { spawn } from 'child_process';
import path from 'path';
import { readFileSync } from 'fs';

// ── Property name / group mappings (must match ingest-to-supabase.ts) ──────

const KNOWN_PROPERTIES = [
  'Candlewood Suites', 'Holiday Inn Express Fulton', 'Holiday Inn Express Memphis Southwind',
  'Holiday Inn Express Tupelo', 'Holiday Inn Tupelo', 'Four Points Memphis Southwind',
  'Best Western Tupelo', 'Surestay Tupelo', 'SureStay Tupelo', 'Hyatt Place Biloxi',
  'Comfort Inn Tupelo', 'Hilton Garden Inn Olive Branch', 'TownePlace Suites',
  'Best Western Plus Olive Branch', 'Home 2 Suites by Hilton Tupelo', 'Home2 Suites by Hilton Tupelo',
  'Tru by Hilton Tupelo', 'Holiday Inn Meridian', 'Hilton Garden Inn Meridian',
  'Hampton Inn Meridian', 'Hampton Inn Vicksburg', 'DoubleTree Biloxi', 'Hilton Garden Inn Madison',
];

const NAME_MAP: Record<string, string> = {
  'Surestay Tupelo': 'SureStay Hotel', 'SureStay Tupelo': 'SureStay Hotel',
  'Hilton Garden Inn Olive Branch': 'HGI Olive Branch',
  'Home 2 Suites by Hilton Tupelo': 'Home2 Suites By Hilton',
  'Home2 Suites by Hilton Tupelo': 'Home2 Suites By Hilton',
  'Tru by Hilton Tupelo': 'Tru By Hilton Tupelo',
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
  'tru tupelo': 'Tru By Hilton Tupelo', 'home 2 suites': 'Home2 Suites By Hilton',
  'hyatt biloxi': 'Hyatt Place Biloxi', 'hyatt place biloxi': 'Hyatt Place Biloxi',
  'tps olive branch': 'TownePlace Suites', 'hgi olive branch': 'HGI Olive Branch',
  'hilton garden inn olive branch': 'HGI Olive Branch', 'bw plus ob': 'Best Western Plus Olive Branch',
  'hgi madison': 'Hilton Garden Inn Madison', 'holiday inn meridian': 'Holiday Inn Meridian',
  'hampton inn meridian': 'Hampton Inn Meridian', 'hgi meridian': 'Hilton Garden Inn Meridian',
  'hampton inn vicksburg': 'Hampton Inn Vicksburg', 'doubletree biloxi': 'DoubleTree Biloxi',
  'fp southwind': 'Four Points Memphis Southwind', 'hie southwind': 'Holiday Inn Express Memphis Southwind',
  'hie memphis southwind': 'Holiday Inn Express Memphis Southwind',
  'surestay tupelo': 'SureStay Hotel',
};

// ── Parsers ────────────────────────────────────────────────────────────────

function parseNum(s: string | undefined): number | null {
  if (!s) return null;
  let c = s.replace(/[$,%\s]/g, '').replace(/,/g, '');
  if (c.startsWith('(') && c.endsWith(')')) c = '-' + c.slice(1, -1);
  const v = parseFloat(c);
  return isNaN(v) ? null : v;
}

function parsePct(s: string | undefined): number | null {
  if (!s) return null;
  const v = parseFloat(s.replace(/[%\s]/g, ''));
  if (isNaN(v) || v < 0) return null;
  if (v > 0 && v <= 1) return v * 100;
  return v > 100 ? null : v;
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
    const tokens = remainder.match(/\(?\$?[\d,]+\.?\d*%?\)?/g) ?? [];
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
        if (label === 'DBA') dbaRow = dataCells;
        else if (label === 'Entity Name' || label === 'Date' || /^\d{2}\/\d{2}\/\d{4}/.test(label)) { /* skip */ }
        else if (label === 'Total' || (!cells[0]?.trim() && !cells[1]?.trim() && dataCells[0])) metricRows.push({ label: 'AR Total', cells: dataCells });
        else if (label) metricRows.push({ label, cells: dataCells });
      } else {
        const parts = line.split(/\s{3,}/).map((s: string) => s.trim()).filter(Boolean);
        const label = parts[0] ?? '';
        const cells = parts.slice(1);
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
  const rooms: Record<string, unknown>[] = [];
  const sheets = text.split(/=== Sheet:\s*/);
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

// ── Routes ─────────────────────────────────────────────────────────────────

export async function scannerRoutes(app: FastifyInstance): Promise<void> {
  // Resolve a folder name to a full path by searching common locations
  app.post('/resolve-folder', async (req, reply) => {
    const { folderName } = req.body as { folderName?: string };
    if (!folderName) {
      return reply.code(400).send({ success: false, message: 'folderName is required' });
    }

    const { existsSync, readdirSync } = await import('fs');
    const os = await import('os');
    const homeDir = os.homedir();

    const { fileURLToPath: toPath } = await import('url');
    const routeDir = path.dirname(toPath(import.meta.url));
    const projectRoot = path.resolve(routeDir, '..', '..', '..', '..');

    // Discover all OneDrive roots (personal + business accounts)
    const oneDriveRoots: string[] = [];
    try {
      for (const entry of readdirSync(homeDir, { withFileTypes: true })) {
        if (entry.isDirectory() && /^OneDrive/i.test(entry.name)) {
          oneDriveRoots.push(path.join(homeDir, entry.name));
        }
      }
    } catch { /* ignore */ }

    // Direct matches in common locations
    const candidates = [
      path.join(projectRoot, folderName),
      path.join(homeDir, 'Downloads', folderName),
      path.join(homeDir, 'Downloads', 'crm-fusion-hospitality', folderName),
      path.join(homeDir, 'Desktop', folderName),
      path.join(homeDir, 'Documents', folderName),
      ...oneDriveRoots.map((root) => path.join(root, folderName)),
      path.join(process.cwd(), folderName),
    ];

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return reply.send({ success: true, folderPath: candidate });
      }
    }

    // Recursive search: find any folder matching this name under common roots (max 3 levels deep)
    const searchRoots = [
      projectRoot,
      path.join(homeDir, 'Downloads'),
      path.join(homeDir, 'Desktop'),
      path.join(homeDir, 'Documents'),
      ...oneDriveRoots,
    ];

    function findFolder(dir: string, name: string, depth: number): string | null {
      if (depth > 3) return null;
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
          const full = path.join(dir, entry.name);
          if (entry.name === name) return full;
          const found = findFolder(full, name, depth + 1);
          if (found) return found;
        }
      } catch { /* permission denied etc */ }
      return null;
    }

    for (const root of searchRoots) {
      const found = findFolder(root, folderName, 0);
      if (found) {
        return reply.send({ success: true, folderPath: found });
      }
    }

    return reply.send({ success: false, folderPath: null, message: 'Folder not found.' });
  });

  // Track the scanner process PID
  let scannerPid: number | null = null;

  // Cancel a running scan
  app.post('/cancel', async (_req, reply) => {
    if (!scannerPid) {
      return reply.send({ success: false, message: 'No scan is running.' });
    }

    try {
      // On Windows, kill the process tree
      if (process.platform === 'win32') {
        const { exec } = await import('child_process');
        exec(`taskkill /pid ${scannerPid} /T /F`, () => {});
      } else {
        process.kill(-scannerPid, 'SIGTERM');
      }
    } catch {
      // Process may have already exited
    }

    scannerPid = null;
    return reply.send({ success: true, message: 'Scan cancelled.' });
  });

  // Start a scan
  app.post('/start', async (req, reply) => {
    const body = req.body as { folderPath?: string };
    const folderPath = body?.folderPath?.trim();

    if (!folderPath) {
      return reply.code(400).send({ success: false, message: 'folderPath is required' });
    }

    const { fileURLToPath } = await import('url');
    const thisDir = path.dirname(fileURLToPath(import.meta.url));
    const projectRoot = path.resolve(thisDir, '..', '..', '..', '..');
    const scriptPath = path.join(projectRoot, 'scripts', 'scanWithOCR-local.ts');

    // Clear old progress file so UI starts fresh
    const { writeFileSync } = await import('fs');
    const progressPath = path.join(projectRoot, 'apps', 'web', 'public', 'data', 'scan-progress.json');
    try {
      writeFileSync(progressPath, JSON.stringify({ status: 'scanning', startedAt: new Date().toISOString(), currentDate: '', currentDateIndex: 0, totalDateFolders: 0, filesProcessed: 0, filesInCurrentDate: 0, totalFilesEstimate: 0, elapsedMs: 0, currentFile: '' }));
    } catch { /* ignore */ }

    // Run tsx directly via node — avoids npx/pnpm env pollution issues on Windows
    const { createRequire } = await import('module');
    const cjsRequire = createRequire(import.meta.url);
    const tsxCli = cjsRequire.resolve('tsx/cli');
    const child = spawn(process.execPath, [tsxCli, scriptPath, folderPath], {
      cwd: projectRoot,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });

    child.unref();
    scannerPid = child.pid ?? null;

    // Clear PID when process exits
    child.on('exit', () => { scannerPid = null; });

    return reply.code(202).send({
      success: true,
      message: 'Scan started',
      pid: child.pid,
    });
  });

  // Ingest scan results into Supabase
  app.post('/ingest', async (req, reply) => {
    const { existsSync } = await import('fs');
    // Try multiple strategies to find output.json
    const candidates = [
      path.resolve(process.cwd(), 'apps', 'web', 'public', 'data', 'output.json'),
      path.resolve(process.cwd(), '..', 'web', 'public', 'data', 'output.json'),
      path.resolve(process.cwd(), '..', '..', 'apps', 'web', 'public', 'data', 'output.json'),
    ];
    const outputPath = candidates.find((p) => existsSync(p)) ?? candidates[0]!;

    let data: { results: Record<string, unknown>[] };
    try {
      data = JSON.parse(readFileSync(outputPath, 'utf8'));
    } catch {
      return reply.code(404).send({
        success: false,
        message: 'No output.json found. Run a scan first.',
      });
    }

    const results = data.results ?? [];
    if (results.length === 0) {
      return reply.code(400).send({ success: false, message: 'output.json has no results.' });
    }

    const { createClient } = await import('@supabase/supabase-js');
    const { env } = await import('../../config/env.js');
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const allDates = [...new Set(
      results.map((r) => r['dateFolder'] as string).filter(Boolean),
    )].sort();

    let totalRF = 0;
    let totalFR = 0;
    let totalEng = 0;
    const errors: string[] = [];

    for (const date of allDates) {
      // Revenue Flash
      const rfFiles = results
        .filter((r) => r['dateFolder'] === date && r['reportType'] === 'Revenue Flash' && r['fullText'])
        .sort((a, b) => ((b['fullText'] as string)?.length ?? 0) - ((a['fullText'] as string)?.length ?? 0));

      const rfRows: Record<string, unknown>[] = [];
      const rfSeen = new Set<string>();
      for (const rf of rfFiles) {
        for (const row of parseRevenueFlash(rf['fullText'] as string, date)) {
          if (!rfSeen.has(row['property_name'] as string)) {
            rfSeen.add(row['property_name'] as string);
            rfRows.push(row);
          }
        }
      }

      if (rfRows.length > 0) {
        const { error } = await supabase
          .from('daily_hotel_performance')
          .upsert(rfRows, { onConflict: 'property_name,report_date' });
        if (error) errors.push(`RF ${date}: ${error.message}`);
        else totalRF += rfRows.length;
      }

      // Flash Report
      const frFiles = results
        .filter((r) =>
          r['dateFolder'] === date &&
          (r['fileName'] as string)?.toLowerCase().includes('flash report') &&
          !(r['fileName'] as string)?.toLowerCase().includes('revenue') &&
          r['fullText'],
        )
        .sort((a, b) => {
          const ap = (a['extension'] as string) === '.pdf' ? 1 : 0;
          const bp = (b['extension'] as string) === '.pdf' ? 1 : 0;
          return bp - ap;
        });

      if (frFiles.length > 0) {
        const frRows = parseFlashReport(frFiles[0]!['fullText'] as string, date);
        if (frRows.length > 0) {
          const { error } = await supabase
            .from('flash_report')
            .upsert(frRows, { onConflict: 'property_name,report_date' });
          if (error) errors.push(`FR ${date}: ${error.message}`);
          else totalFR += frRows.length;
        }
      }

      // Engineering Flash
      const engFiles = results
        .filter((r) =>
          r['dateFolder'] === date &&
          (r['fileName'] as string)?.toLowerCase().includes('engineering flash') &&
          !(r['fileName'] as string)?.toLowerCase().includes('template') &&
          r['fullText'],
        )
        .sort((a, b) => ((b['fullText'] as string)?.length ?? 0) - ((a['fullText'] as string)?.length ?? 0));

      if (engFiles.length > 0) {
        const engRows = parseEngineering(engFiles[0]!['fullText'] as string, date);
        if (engRows.length > 0) {
          const { error } = await supabase
            .from('engineering_ooo_rooms')
            .upsert(engRows, { onConflict: 'property_name,report_date,room_number,is_long_term' });
          if (error) errors.push(`Eng ${date}: ${error.message}`);
          else totalEng += engRows.length;
        }
      }
    }

    return reply.send({
      success: errors.length === 0,
      data: {
        dates: allDates.length,
        revenueFlash: totalRF,
        flashReport: totalFR,
        engineering: totalEng,
        errors,
      },
    });
  });
}
