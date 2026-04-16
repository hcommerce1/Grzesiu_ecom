'use client';

import { useState } from 'react';
import { interpolateValue } from '@/lib/batch-session';
import type { SellerScrapedListing } from '@/lib/types';

interface BatchItemPreviewTableProps {
  listings: SellerScrapedListing[];
  titleTemplate: string | null;
  diffFields: string[];
}

function hasUnfilledPlaceholders(text: string): boolean {
  return /\{\{[^{}]+\}\}/.test(text);
}

export function BatchItemPreviewTable({ listings, titleTemplate, diffFields }: BatchItemPreviewTableProps) {
  const [showAll, setShowAll] = useState(false);

  const attrFields = diffFields
    .filter(f => f.startsWith('attr:'))
    .map(f => f.replace('attr:', ''));

  const rows = listings
    .filter(l => l.deepScrapeData)
    .map(l => {
      const attrs = l.deepScrapeData!.attributes ?? {};
      const interpolatedTitle = titleTemplate
        ? interpolateValue(titleTemplate, attrs)
        : l.deepScrapeData!.title;
      const titleBroken = hasUnfilledPlaceholders(interpolatedTitle);

      const attrValues = attrFields.map(field => ({
        field,
        value: attrs[field] ?? attrs[Object.keys(attrs).find(k =>
          k.toLowerCase() === field.toLowerCase()
        ) ?? ''] ?? '',
        missing: !Object.keys(attrs).some(k => k.toLowerCase() === field.toLowerCase()),
      }));

      return {
        id: l.id,
        label: l.title,
        interpolatedTitle,
        titleBroken,
        ean: l.deepScrapeData!.ean ?? '',
        attrValues,
        hasProblem: titleBroken || attrValues.some(a => a.missing),
      };
    });

  const problematic = rows.filter(r => r.hasProblem);
  const visibleRows = showAll ? rows : rows.slice(0, 10);

  if (rows.length === 0) return null;

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-700">
          Podgląd per produkt
          {problematic.length > 0 && (
            <span className="ml-2 px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-700">
              {problematic.length} z problemami
            </span>
          )}
        </span>
        {rows.length > 10 && (
          <button
            onClick={() => setShowAll(v => !v)}
            className="text-xs text-blue-600 hover:underline"
          >
            {showAll ? 'Pokaż mniej' : `Pokaż wszystkie ${rows.length}`}
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-xs">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-3 py-2 font-medium text-gray-600 w-48">Produkt</th>
              {titleTemplate && (
                <th className="text-left px-3 py-2 font-medium text-gray-600">Tytuł po interpolacji</th>
              )}
              {attrFields.map(f => (
                <th key={f} className="text-left px-3 py-2 font-medium text-gray-600 whitespace-nowrap">{f}</th>
              ))}
              {diffFields.includes('ean') && (
                <th className="text-left px-3 py-2 font-medium text-gray-600">EAN</th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {visibleRows.map(row => (
              <tr key={row.id} className={row.hasProblem ? 'bg-amber-50' : ''}>
                <td className="px-3 py-2 text-gray-700 max-w-[12rem] truncate" title={row.label}>
                  {row.label}
                </td>
                {titleTemplate && (
                  <td className="px-3 py-2 max-w-[20rem]">
                    {row.titleBroken ? (
                      <span className="text-red-600 font-medium" title="Nieuzupełniony placeholder">
                        {row.interpolatedTitle}
                      </span>
                    ) : (
                      <span className="text-gray-800">{row.interpolatedTitle}</span>
                    )}
                  </td>
                )}
                {row.attrValues.map(a => (
                  <td key={a.field} className="px-3 py-2 whitespace-nowrap">
                    {a.missing ? (
                      <span className="text-red-500 italic">brak</span>
                    ) : (
                      <span className="text-gray-800">{a.value}</span>
                    )}
                  </td>
                ))}
                {diffFields.includes('ean') && (
                  <td className="px-3 py-2 text-gray-600 font-mono">{row.ean || <span className="text-gray-400">—</span>}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!showAll && rows.length > 10 && (
        <p className="text-xs text-gray-400 mt-1 text-center">
          Wyświetlono 10 z {rows.length}. <button onClick={() => setShowAll(true)} className="text-blue-500 hover:underline">Pokaż wszystkie</button>
        </p>
      )}
    </div>
  );
}
