'use client';

// Shown on a sport page when there is nothing to pick. Says WHY (off-season / gap in the schedule),
// when the next game is, and when the last result was — instead of a spinner or a "Sync" button.
// The crons refresh the data on their own; visitors never need to trigger a sync.

interface NoGamesNoticeProps {
  sport: string;              // "NBA", "college basketball", ...
  seasonNote: string;         // e.g. "The college basketball season runs November through early April."
  nextGameTime?: string | Date | null;
  lastResultTime?: string | Date | null;
  dataUpdatedAt?: string | null;
}

function fmtDate(value?: string | Date | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export default function NoGamesNotice({ sport, seasonNote, nextGameTime, lastResultTime, dataUpdatedAt }: NoGamesNoticeProps) {
  const next = fmtDate(nextGameTime);
  const last = fmtDate(lastResultTime);
  const updated = dataUpdatedAt ? new Date(dataUpdatedAt) : null;

  return (
    <div className="bg-white rounded-xl p-8 text-center border border-gray-200">
      <div className="text-lg font-semibold text-gray-900">No {sport} games right now</div>
      <p className="mt-2 text-sm text-gray-600">{seasonNote}</p>
      <div className="mt-4 flex flex-col sm:flex-row sm:justify-center gap-2 sm:gap-8 text-sm text-gray-500">
        {next && <span>Next scheduled game: <span className="font-medium text-gray-800">{next}</span></span>}
        {last && <span>Last result: <span className="font-medium text-gray-800">{last}</span></span>}
      </div>
      {updated && !Number.isNaN(updated.getTime()) && (
        <p className="mt-4 text-xs text-gray-400">
          Picks appear here automatically once games are on the schedule. Data checked {updated.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.
        </p>
      )}
    </div>
  );
}
