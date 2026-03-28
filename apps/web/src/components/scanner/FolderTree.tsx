/**
 * Collapsible folder tree view of scanned files grouped by directory structure.
 */

import { useState, useMemo } from 'react';
import { clsx } from 'clsx';
import {
  FolderIcon,
  FolderOpenIcon,
  DocumentTextIcon,
  TableCellsIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline';
import type { FlatResult } from './types';

interface TreeNode {
  name: string;
  path: string;
  children: Map<string, TreeNode>;
  files: FlatResult[];
  totalFiles: number;
}

function buildTree(files: FlatResult[]): TreeNode {
  const root: TreeNode = { name: 'root', path: '', children: new Map(), files: [], totalFiles: files.length };

  for (const file of files) {
    const parts = file.relativePath.split('/');
    let current = root;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]!;
      if (!current.children.has(part)) {
        current.children.set(part, {
          name: part,
          path: parts.slice(0, i + 1).join('/'),
          children: new Map(),
          files: [],
          totalFiles: 0,
        });
      }
      current = current.children.get(part)!;
    }

    current.files.push(file);
    current.totalFiles++;
  }

  // Propagate counts upward
  function countUp(node: TreeNode): number {
    let total = node.files.length;
    for (const child of node.children.values()) {
      total += countUp(child);
    }
    node.totalFiles = total;
    return total;
  }
  countUp(root);

  return root;
}

interface FolderNodeProps {
  node: TreeNode;
  depth: number;
  onSelectFolder: (path: string) => void;
  selectedFolder: string;
}

function FolderNode({ node, depth, onSelectFolder, selectedFolder }: FolderNodeProps) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.children.size > 0;
  const isSelected = selectedFolder === node.path;

  const sortedChildren = useMemo(
    () => [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name)),
    [node.children],
  );

  return (
    <div>
      <button
        onClick={() => {
          if (hasChildren) setExpanded(!expanded);
          onSelectFolder(node.path);
        }}
        className={clsx(
          'w-full flex items-center gap-1.5 py-1 px-2 rounded text-sm transition-colors',
          isSelected ? 'bg-brand-50 text-brand-700 font-medium' : 'text-neutral-600 hover:bg-neutral-50',
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {hasChildren ? (
          <ChevronRightIcon
            className={clsx('w-3 h-3 shrink-0 transition-transform', expanded && 'rotate-90')}
          />
        ) : (
          <span className="w-3" />
        )}
        {expanded
          ? <FolderOpenIcon className="w-4 h-4 shrink-0 text-amber-500" />
          : <FolderIcon className="w-4 h-4 shrink-0 text-amber-500" />
        }
        <span className="flex-1 text-left truncate">{node.name}</span>
        <span className="text-xs tabular-nums text-neutral-400 shrink-0">{node.totalFiles}</span>
      </button>

      {expanded && (
        <>
          {sortedChildren.map((child) => (
            <FolderNode
              key={child.path}
              node={child}
              depth={depth + 1}
              onSelectFolder={onSelectFolder}
              selectedFolder={selectedFolder}
            />
          ))}
          {node.files.map((file, i) => (
            <div
              key={`${file.relativePath}-${i}`}
              className="flex items-center gap-1.5 py-0.5 px-2 text-xs text-neutral-500"
              style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}
              title={file.relativePath}
            >
              <span className="w-3" />
              {file.extension === '.pdf'
                ? <DocumentTextIcon className="w-3.5 h-3.5 shrink-0 text-red-400" />
                : <TableCellsIcon className="w-3.5 h-3.5 shrink-0 text-green-500" />
              }
              <span className="truncate">{file.fileName}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

interface FolderTreeProps {
  results: FlatResult[];
  onSelectFolder: (path: string) => void;
  selectedFolder: string;
}

export function FolderTree({ results, onSelectFolder, selectedFolder }: FolderTreeProps) {
  const tree = useMemo(() => buildTree(results), [results]);

  const sortedTopLevel = useMemo(
    () => [...tree.children.values()].sort((a, b) => a.name.localeCompare(b.name)),
    [tree.children],
  );

  return (
    <div className="card p-3">
      <p className="text-[10px] font-semibold text-neutral-400 uppercase tracking-widest mb-2 px-2">
        Folder Structure
      </p>
      <button
        onClick={() => onSelectFolder('')}
        className={clsx(
          'w-full flex items-center gap-1.5 py-1 px-2 rounded text-sm transition-colors mb-1',
          selectedFolder === '' ? 'bg-brand-50 text-brand-700 font-medium' : 'text-neutral-600 hover:bg-neutral-50',
        )}
      >
        <FolderOpenIcon className="w-4 h-4 shrink-0 text-amber-500" />
        <span className="flex-1 text-left">All Folders</span>
        <span className="text-xs tabular-nums text-neutral-400">{results.length}</span>
      </button>
      <div className="max-h-[500px] overflow-y-auto">
        {sortedTopLevel.map((child) => (
          <FolderNode
            key={child.path}
            node={child}
            depth={0}
            onSelectFolder={onSelectFolder}
            selectedFolder={selectedFolder}
          />
        ))}
      </div>
    </div>
  );
}
