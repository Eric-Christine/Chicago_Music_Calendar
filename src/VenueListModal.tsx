import React, { useMemo, useState } from 'react';
import { Check, Star, Trash2, X } from 'lucide-react';
import type { Venue } from './App';
import type { VenueList } from './venueLists';

interface VenueListModalProps {
  venues: Venue[];
  initialList: VenueList | null; // null = creating new list
  preselectedVenueIds: string[];
  onSave: (name: string, venueIds: string[], existingId?: string) => void;
  onDelete?: (id: string) => void;
  onClose: () => void;
}

const CORRIDOR_ORDER = [
  'ALL',
  'Salt Shed / Elston',
  'Milwaukee Ave Corridor',
  'Radius / Pilsen / South',
  'West Town / Fulton',
  'North Side / Lakeview',
];

export function VenueListModal({
  venues,
  initialList,
  preselectedVenueIds,
  onSave,
  onDelete,
  onClose,
}: VenueListModalProps) {
  const [name, setName] = useState(initialList?.name || '');
  const [selectedIds, setSelectedIds] = useState<string[]>(
    initialList ? [...initialList.venueIds] : [...preselectedVenueIds]
  );
  const [corridor, setCorridor] = useState<string>('ALL');
  const [query, setQuery] = useState('');

  const visibleVenues = useMemo(() => {
    const q = query.trim().toLowerCase();
    return venues.filter((v) => {
      if (corridor !== 'ALL' && v.corridor !== corridor) return false;
      if (
        q &&
        !v.name.toLowerCase().includes(q) &&
        !v.neighborhood.toLowerCase().includes(q) &&
        !v.corridor.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [venues, corridor, query]);

  function toggle(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const finalName = name.trim() || `My Top ${selectedIds.length}`;
    if (selectedIds.length === 0) return;
    onSave(finalName, selectedIds, initialList?.id);
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Favorite venue list" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <span className="filter-label" style={{ paddingTop: 0 }}>
              <Star size={12} style={{ verticalAlign: '-1px', marginRight: 4 }} />
              {initialList ? 'Edit Venue List' : 'New Favorite Venue List'}
            </span>
            <h3>{initialList ? initialList.name : 'Group your favorite stages'}</h3>
          </div>
          <button className="btn btn-icon" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body">
          <label className="field-label">
            List name
            <input
              type="text"
              className="text-input"
              placeholder="e.g. My Top 5, Milwaukee Ave Night, Big Rooms"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              autoFocus
            />
          </label>

          <div className="modal-picker-head">
            <span className="modal-count">
              <strong>{selectedIds.length}</strong> {selectedIds.length === 1 ? 'venue' : 'venues'} selected
            </span>
            <div className="modal-picker-actions">
              <input
                type="search"
                className="text-input text-input-sm"
                placeholder="Filter venues…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {selectedIds.length > 0 && (
                <button type="button" className="link-btn" onClick={() => setSelectedIds([])}>
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="chip-row modal-corridors">
            {CORRIDOR_ORDER.map((c) => (
              <button
                type="button"
                key={c}
                className={`pill pill-sm ${corridor === c ? 'active' : ''}`}
                onClick={() => setCorridor(c)}
              >
                {c === 'ALL' ? 'All areas' : c.split(' / ')[0]}
              </button>
            ))}
          </div>

          <div className="modal-venue-grid">
            {visibleVenues.map((v) => {
              const checked = selectedIds.includes(v.id);
              return (
                <button
                  type="button"
                  key={v.id}
                  className={`modal-venue-option ${checked ? 'active' : ''}`}
                  onClick={() => toggle(v.id)}
                >
                  <span className="dot" style={{ backgroundColor: v.color }} />
                  <span className="modal-venue-info">
                    <strong>{v.shortName}</strong>
                    <small>
                      {v.neighborhood} · {v.distanceMiles} mi
                    </small>
                  </span>
                  <span className="modal-check">{checked && <Check size={14} />}</span>
                </button>
              );
            })}
          </div>

          <div className="modal-footer">
            {initialList && onDelete ? (
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => onDelete(initialList.id)}
              >
                <Trash2 size={14} /> Delete list
              </button>
            ) : (
              <span className="modal-hint">Pick any combo of venues to filter the 12-month calendar in one tap.</span>
            )}
            <div className="modal-footer-right">
              <button type="button" className="btn" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={selectedIds.length === 0}>
                {initialList ? 'Save changes' : `Save list (${selectedIds.length})`}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
