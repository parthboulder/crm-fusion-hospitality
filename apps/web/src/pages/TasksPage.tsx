/**
 * Tasks page — kanban-style board by status.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api-client';
import { fmtDate } from '../lib/formatters';
import { SeverityBadge } from '../components/shared/SeverityBadge';
import { PlusIcon } from '@heroicons/react/20/solid';
import { clsx } from 'clsx';

interface Task {
  id: string;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  taskType: string;
  dueDate: string | null;
  completedAt: string | null;
  property: { name: string };
  assignee: { fullName: string; avatarUrl: string | null } | null;
  alert: { alertType: string; severity: string } | null;
  _count: { comments: number };
}

interface TasksResponse { data: Task[]; total: number }

const COLUMNS = [
  { status: 'open',        label: 'Open' },
  { status: 'in_progress', label: 'In Progress' },
  { status: 'blocked',     label: 'Blocked' },
  { status: 'completed',   label: 'Completed' },
];

export function TasksPage() {
  const qc = useQueryClient();
  const [propertyFilter, setPropertyFilter] = useState('');

  const { data, isLoading } = useQuery<TasksResponse>({
    queryKey: ['tasks', propertyFilter],
    queryFn: () => api.get(`/tasks?limit=100${propertyFilter ? `&propertyId=${propertyFilter}` : ''}`),
    refetchInterval: 60_000,
  });

  const { data: properties } = useQuery<{ data: Array<{ id: string; name: string }> }>({
    queryKey: ['properties'],
    queryFn: () => api.get('/properties'),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/tasks/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });

  const tasksByStatus = (status: string) =>
    (data?.data ?? []).filter((t) => t.status === status);

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">Tasks</h1>
        <div className="flex items-center gap-3">
          <select
            value={propertyFilter}
            onChange={(e) => setPropertyFilter(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="">All properties</option>
            {properties?.data.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Kanban board */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {COLUMNS.map((col) => {
          const tasks = tasksByStatus(col.status);
          return (
            <div key={col.status} className="flex flex-col">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{col.label}</h2>
                <span className="text-xs font-medium text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                  {tasks.length}
                </span>
              </div>

              <div className="flex-1 space-y-2 min-h-[200px]">
                {isLoading
                  ? Array.from({ length: 2 }).map((_, i) => (
                      <div key={i} className="card h-24 animate-pulse" />
                    ))
                  : tasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        onStatusChange={(newStatus) =>
                          statusMutation.mutate({ id: task.id, status: newStatus })
                        }
                      />
                    ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TaskCard({ task, onStatusChange }: { task: Task; onStatusChange: (s: string) => void }) {
  const isOverdue =
    task.dueDate &&
    task.status !== 'completed' &&
    task.status !== 'cancelled' &&
    new Date(task.dueDate) < new Date();

  return (
    <div className="card p-3.5 space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <SeverityBadge severity={task.priority} />
        {task._count.comments > 0 && (
          <span className="text-xs text-gray-300">{task._count.comments} comments</span>
        )}
      </div>

      <p className="text-sm font-medium text-gray-900 leading-snug">{task.title}</p>
      <p className="text-xs text-gray-400 truncate">{task.property.name}</p>

      {task.assignee && (
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-5 rounded-full bg-brand-100 text-brand-700 text-xs flex items-center justify-center font-bold">
            {task.assignee.fullName.split(' ').map((n) => n[0]).join('').slice(0, 2)}
          </div>
          <span className="text-xs text-gray-500">{task.assignee.fullName}</span>
        </div>
      )}

      {task.dueDate && (
        <p className={clsx('text-xs', isOverdue ? 'text-danger-600 font-medium' : 'text-gray-300')}>
          {isOverdue ? 'Overdue: ' : 'Due: '}{fmtDate(task.dueDate)}
        </p>
      )}

      {/* Status quick-move */}
      {task.status !== 'completed' && task.status !== 'cancelled' && (
        <select
          value={task.status}
          onChange={(e) => onStatusChange(e.target.value)}
          className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
          onClick={(e) => e.stopPropagation()}
        >
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="blocked">Blocked</option>
          <option value="completed">Completed</option>
        </select>
      )}
    </div>
  );
}
