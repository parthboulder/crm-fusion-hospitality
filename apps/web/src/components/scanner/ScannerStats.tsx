/**
 * KPI strip showing scan summary metrics.
 */

import {
  DocumentTextIcon,
  FolderOpenIcon,
  CurrencyDollarIcon,
  ExclamationTriangleIcon,
  ClockIcon,
  BuildingOffice2Icon,
  CalendarDaysIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline';
import type { ScanSummary } from './types';

interface StatCardProps {
  label: string;
  value: string | number;
  icon: React.ElementType;
  accent?: string;
}

function StatCard({ label, value, icon: Icon, accent = 'text-brand-600 bg-brand-50' }: StatCardProps) {
  const [textColor, bgColor] = accent.split(' ') as [string, string];
  return (
    <div className="card px-4 py-3 flex items-center gap-3">
      <div className={`flex items-center justify-center w-9 h-9 rounded-md ${bgColor}`}>
        <Icon className={`w-5 h-5 ${textColor}`} />
      </div>
      <div>
        <p className="text-xs text-neutral-400 font-medium">{label}</p>
        <p className="text-lg font-bold text-neutral-900 tabular-nums leading-tight">{value}</p>
      </div>
    </div>
  );
}

interface ScannerStatsProps {
  summary: ScanSummary;
}

export function ScannerStats({ summary }: ScannerStatsProps) {
  const elapsed = (summary.executionTimeMs / 1000).toFixed(1);

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
      <StatCard
        label="Total Files"
        value={summary.totalFiles.toLocaleString()}
        icon={FolderOpenIcon}
      />
      <StatCard
        label="Date Folders"
        value={summary.allDates.length}
        icon={CalendarDaysIcon}
        accent="text-indigo-600 bg-indigo-50"
      />
      <StatCard
        label="Properties"
        value={summary.allProperties.length}
        icon={BuildingOffice2Icon}
        accent="text-purple-600 bg-purple-50"
      />
      <StatCard
        label="PDFs Parsed"
        value={`${summary.totalParsed}/${summary.totalPdfs}`}
        icon={DocumentTextIcon}
        accent="text-blue-600 bg-blue-50"
      />
      <StatCard
        label="Categorized"
        value={summary.totalFiles - (summary.categoryCounts['Uncategorized'] ?? 0)}
        icon={CheckCircleIcon}
        accent="text-success-600 bg-success-50"
      />
      <StatCard
        label="ADR Found"
        value={summary.totalWithAdr}
        icon={CurrencyDollarIcon}
        accent="text-emerald-600 bg-emerald-50"
      />
      <StatCard
        label="Errors"
        value={summary.totalErrors}
        icon={ExclamationTriangleIcon}
        accent={summary.totalErrors > 0 ? 'text-danger-600 bg-danger-50' : 'text-neutral-400 bg-neutral-50'}
      />
      <StatCard
        label="Scan Time"
        value={`${elapsed}s`}
        icon={ClockIcon}
        accent="text-neutral-500 bg-neutral-50"
      />
    </div>
  );
}
