import { clsx } from 'clsx';

export function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold capitalize ring-1',
        severity === 'critical' && 'badge-critical',
        severity === 'high' && 'badge-high',
        severity === 'medium' && 'badge-medium',
        severity === 'low' && 'badge-low',
      )}
    >
      {severity}
    </span>
  );
}
