/**
 * Scanner route — spawns the local OCR scanner script and ingests results to Supabase.
 */

import type { FastifyInstance } from 'fastify';
import { spawn } from 'child_process';
import path from 'path';
import { readFileSync } from 'fs';
import {
  parseRevenueFlash,
  parseFlashReport,
  parseEngineering,
} from '../../lib/report-parsers.js';
import { reconcileDates } from '../../lib/date-reconciler.js';

// NOTE: the scanner used to carry its own copies of the parsers + name maps.
// They drifted from the canonical versions in lib/report-parsers.ts and made
// the "mixing data" bug worse (two different lookups, two different outcomes
// for the same PDF). Single-source-of-truth parsers come from the shared
// module now; the scanner just drives the file loop and the upserts.

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

    // Per-file date reconciliation. Filename date is a weak signal — each
    // file's business date comes from the PDF body (reconcileDates). Files
    // with no parseable business date are skipped, not force-landed on a
    // guessed day.
    const typed = results
      .map((r) => {
        const fullText = (r['fullText'] as string | undefined) ?? '';
        if (!fullText) return null;
        const filenameDate = (r['dateFolder'] as string | undefined) ?? null;
        const fileName = (r['fileName'] as string | undefined) ?? '';
        const lowerName = fileName.toLowerCase();
        const reportType = r['reportType'] as string | undefined;

        let kind: 'revenue-flash' | 'flash-report' | 'engineering' | null = null;
        if (reportType === 'Revenue Flash' || lowerName.includes('revenue flash')) kind = 'revenue-flash';
        else if (lowerName.includes('flash report') && !lowerName.includes('revenue')) kind = 'flash-report';
        else if (lowerName.includes('engineering flash') && !lowerName.includes('template')) kind = 'engineering';
        if (!kind) return null;

        const category =
          kind === 'engineering' ? 'Maintenance' : 'Revenue';
        const reconciled = reconcileDates({ filenameDate, fullText, category });
        const businessDate = reconciled.businessDate ?? filenameDate;
        if (!businessDate) return null;

        return {
          kind,
          fileName,
          fullText,
          businessDate,
          extension: (r['extension'] as string | undefined) ?? '',
          warnings: reconciled.warnings,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    let totalRF = 0;
    let totalFR = 0;
    let totalEng = 0;
    const errors: string[] = [];
    const distinctDates = new Set<string>();

    // Group by (kind, businessDate) so we pick the "best" file per cohort.
    const buckets = new Map<string, typeof typed>();
    for (const entry of typed) {
      distinctDates.add(entry.businessDate);
      const key = `${entry.kind}::${entry.businessDate}`;
      const arr = buckets.get(key) ?? [];
      arr.push(entry);
      buckets.set(key, arr);
    }

    const nowIso = new Date().toISOString();

    for (const [key, entries] of buckets.entries()) {
      const kind = key.split('::')[0] as 'revenue-flash' | 'flash-report' | 'engineering';
      const date = key.split('::')[1]!;

      if (kind === 'revenue-flash') {
        // Prefer the longest fullText — most complete file.
        const sorted = [...entries].sort((a, b) => b.fullText.length - a.fullText.length);
        const rows: Record<string, unknown>[] = [];
        const seen = new Set<string>();
        for (const rf of sorted) {
          for (const row of parseRevenueFlash(rf.fullText, date)) {
            const name = row['property_name'] as string;
            if (seen.has(name)) continue;
            seen.add(name);
            rows.push({ ...row, extracted_at: nowIso });
          }
        }
        if (rows.length > 0) {
          const { error } = await supabase
            .from('daily_hotel_performance')
            .upsert(rows, { onConflict: 'property_name,report_date' });
          if (error) errors.push(`RF ${date}: ${error.message}`);
          else totalRF += rows.length;
        }
      } else if (kind === 'flash-report') {
        // Prefer PDF over other extensions, then largest.
        const sorted = [...entries].sort((a, b) => {
          const ap = a.extension === '.pdf' ? 1 : 0;
          const bp = b.extension === '.pdf' ? 1 : 0;
          return bp - ap;
        });
        const frRows = parseFlashReport(sorted[0]!.fullText, date).map((r) => ({ ...r, extracted_at: nowIso }));
        if (frRows.length > 0) {
          const { error } = await supabase
            .from('flash_report')
            .upsert(frRows, { onConflict: 'property_name,report_date' });
          if (error) errors.push(`FR ${date}: ${error.message}`);
          else totalFR += frRows.length;
        }
      } else {
        const sorted = [...entries].sort((a, b) => b.fullText.length - a.fullText.length);
        const engRows = parseEngineering(sorted[0]!.fullText, date).map((r) => ({ ...r, extracted_at: nowIso }));
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
        dates: distinctDates.size,
        revenueFlash: totalRF,
        flashReport: totalFR,
        engineering: totalEng,
        errors,
      },
    });
  });
}
