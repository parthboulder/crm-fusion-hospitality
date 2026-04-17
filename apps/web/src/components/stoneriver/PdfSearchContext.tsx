/**
 * Context for triggering PDF search from any cell value click.
 */

import { createContext, useContext, useState, useCallback } from 'react';
import { searchPdfs, type PdfMatch } from '../../lib/pdf-search-index';
import { PdfViewerModal } from './PdfViewerModal';

interface PdfSearchContextValue {
  /** Call this when a cell value is clicked — triggers search and opens viewer */
  searchAndOpen: (value: string) => void;
}

const Ctx = createContext<PdfSearchContextValue>({ searchAndOpen: () => {} });

export function usePdfSearch(): PdfSearchContextValue {
  return useContext(Ctx);
}

type Status = 'idle' | 'searching' | 'empty';

export function PdfSearchProvider({ date, children }: { date: string; children: React.ReactNode }) {
  const [matches, setMatches] = useState<PdfMatch[] | null>(null);
  const [term, setTerm] = useState('');
  const [status, setStatus] = useState<Status>('idle');

  const searchAndOpen = useCallback(async (value: string) => {
    const cleaned = value.replace(/[$,%]/g, '').trim();
    if (!cleaned || cleaned.length < 2) return;
    setTerm(cleaned);
    setStatus('searching');
    const results = await searchPdfs(cleaned, date);
    if (results.length > 0) {
      setMatches(results);
      setStatus('idle');
    } else {
      setMatches(null);
      setStatus('empty');
      // Auto-hide the "no matches" toast after a few seconds.
      setTimeout(() => setStatus((s) => (s === 'empty' ? 'idle' : s)), 2500);
    }
  }, [date]);

  return (
    <Ctx.Provider value={{ searchAndOpen }}>
      {children}
      {matches && (
        <PdfViewerModal
          matches={matches}
          searchTerm={term}
          onClose={() => setMatches(null)}
        />
      )}
      {status === 'searching' && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-[#1f2937] text-white text-xs rounded-lg shadow-lg">
          Searching PDFs for "{term}"…
        </div>
      )}
      {status === 'empty' && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-[#fef2f2] text-[#dc2626] border border-[#fecaca] text-xs rounded-lg shadow-lg">
          No source PDFs found containing "{term}" for {date || 'any date'}.
        </div>
      )}
    </Ctx.Provider>
  );
}
