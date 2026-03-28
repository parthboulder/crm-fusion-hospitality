/**
 * ZIP intake processor.
 * Unzips a daily hotel report archive, walks the directory tree,
 * and returns a structured manifest of all discovered files.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface ZipManifestEntry {
  absolutePath: string;
  relativePath: string;
  topLevelFolder: string;
  propertyFolder: string;
  filename: string;
  extension: string;
  fileSizeBytes: number;
}

export interface ZipManifest {
  extractPath: string;
  topLevelFolder: string;
  inferredDate: string | null;
  propertyFolders: string[];
  files: ZipManifestEntry[];
  warnings: string[];
}

/**
 * Parse a date from a folder name that may use inconsistent formats.
 * Returns YYYY-MM-DD or null.
 */
export function parseDateFromFolder(folderName: string): string | null {
  const cleaned = folderName.trim();

  // YYYY-MM-DD (ISO)
  const iso = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // MMDDYYYY (no separators, 8 digits)
  const mmddyyyy = cleaned.match(/^(\d{2})(\d{2})(\d{4})$/);
  if (mmddyyyy) return `${mmddyyyy[3]}-${mmddyyyy[1]}-${mmddyyyy[2]}`;

  // MMDDYY (no separators, 6 digits)
  const mmddyy = cleaned.match(/^(\d{2})(\d{2})(\d{2})$/);
  if (mmddyy) {
    const year = parseInt(mmddyy[3]!, 10);
    const fullYear = year >= 50 ? 1900 + year : 2000 + year;
    return `${fullYear}-${mmddyy[1]}-${mmddyy[2]}`;
  }

  // MM.DD.YYYY or MM-DD-YYYY or MM/DD/YYYY
  const separated4 = cleaned.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/);
  if (separated4) {
    const mm = separated4[1]!.padStart(2, '0');
    const dd = separated4[2]!.padStart(2, '0');
    return `${separated4[3]}-${mm}-${dd}`;
  }

  // MM.DD.YY or MM-DD-YY or MM/DD/YY
  const separated2 = cleaned.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2})$/);
  if (separated2) {
    const mm = separated2[1]!.padStart(2, '0');
    const dd = separated2[2]!.padStart(2, '0');
    const year = parseInt(separated2[3]!, 10);
    const fullYear = year >= 50 ? 1900 + year : 2000 + year;
    return `${fullYear}-${mm}-${dd}`;
  }

  return null;
}

/**
 * Walk a directory tree recursively and return all file paths.
 */
function walkDir(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(fullPath));
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Determine the top-level folder and property folders from extracted ZIP contents.
 */
function analyzeStructure(
  extractPath: string,
): { topLevelFolder: string; propertyFolders: string[]; isFlat: boolean } {
  const entries = fs.readdirSync(extractPath, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory());
  const files = entries.filter((e) => e.isFile());

  // Case 1: Single top-level date folder containing property subfolders.
  if (dirs.length === 1 && files.length === 0) {
    const topDir = dirs[0]!.name;
    const subPath = path.join(extractPath, topDir);
    const subEntries = fs.readdirSync(subPath, { withFileTypes: true });
    const subDirs = subEntries.filter((e) => e.isDirectory()).map((e) => e.name);

    if (subDirs.length > 0) {
      return { topLevelFolder: topDir, propertyFolders: subDirs, isFlat: false };
    }

    // Single folder with files directly inside (single property).
    return { topLevelFolder: topDir, propertyFolders: [topDir], isFlat: true };
  }

  // Case 2: Multiple top-level folders (property folders directly).
  if (dirs.length > 1) {
    return {
      topLevelFolder: path.basename(extractPath),
      propertyFolders: dirs.map((d) => d.name),
      isFlat: false,
    };
  }

  // Case 3: Flat — files directly in extract root.
  return {
    topLevelFolder: path.basename(extractPath),
    propertyFolders: ['_root'],
    isFlat: true,
  };
}

/**
 * Extract a ZIP file and build a manifest of all contents.
 */
export function processZip(zipPath: string, outputBase?: string): ZipManifest {
  const warnings: string[] = [];
  const timestamp = Date.now();
  const extractPath = outputBase ?? path.join(process.cwd(), '.tmp', 'intake', String(timestamp));

  // Create extraction directory.
  fs.mkdirSync(extractPath, { recursive: true });

  // Extract ZIP (works on Windows with PowerShell, macOS/Linux with unzip).
  try {
    if (process.platform === 'win32') {
      execSync(
        `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${extractPath}' -Force"`,
        { stdio: 'pipe' },
      );
    } else {
      execSync(`unzip -o "${zipPath}" -d "${extractPath}"`, { stdio: 'pipe' });
    }
  } catch (err) {
    throw new Error(`Failed to extract ZIP: ${String(err)}`);
  }

  // Analyze folder structure.
  const structure = analyzeStructure(extractPath);
  const inferredDate = parseDateFromFolder(structure.topLevelFolder);

  if (!inferredDate) {
    warnings.push(`Could not parse date from top-level folder "${structure.topLevelFolder}". Manual date input may be needed.`);
  }

  // Walk the tree and build file entries.
  const allFiles = walkDir(extractPath);
  const files: ZipManifestEntry[] = [];

  for (const filePath of allFiles) {
    const relativePath = path.relative(extractPath, filePath).replace(/\\/g, '/');
    const parts = relativePath.split('/');
    const filename = path.basename(filePath);
    const extension = path.extname(filePath).toLowerCase();

    // Skip system/hidden files.
    if (filename.startsWith('.') || filename === 'Thumbs.db' || filename === 'desktop.ini') {
      continue;
    }

    // Determine property folder from path segments.
    let topLevelFolder = structure.topLevelFolder;
    let propertyFolder = '_root';

    if (parts.length >= 3) {
      // <topLevel>/<property>/<file>
      topLevelFolder = parts[0]!;
      propertyFolder = parts[1]!;
    } else if (parts.length === 2) {
      // Could be <topLevel>/<file> or <property>/<file>
      if (parts[0] === structure.topLevelFolder) {
        propertyFolder = '_root';
      } else {
        propertyFolder = parts[0]!;
      }
    }

    const stat = fs.statSync(filePath);

    files.push({
      absolutePath: filePath,
      relativePath,
      topLevelFolder,
      propertyFolder,
      filename,
      extension,
      fileSizeBytes: stat.size,
    });
  }

  if (files.length === 0) {
    warnings.push('ZIP archive contained no processable files.');
  }

  return {
    extractPath,
    topLevelFolder: structure.topLevelFolder,
    inferredDate,
    propertyFolders: structure.propertyFolders,
    files,
    warnings,
  };
}
