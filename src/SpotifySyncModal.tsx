import React, { useState } from 'react';
import {
  Check,
  Copy,
  Headphones,
  LogOut,
  Plus,
  RefreshCw,
  Sparkles,
  X,
} from 'lucide-react';
import {
  QUICK_CHICAGO_ARTIST_SEEDS,
  type TasteProfile,
  buildManualTasteProfile,
  disconnectTasteProfile,
  getDefaultSpotifyClientId,
  getSpotifyRedirectUri,
  refreshSpotifySync,
  removeArtistFromManualProfile,
  startSpotifyOAuth,
} from './spotify';

interface SpotifySyncModalProps {
  profile: TasteProfile | null;
  exactMatchCount: number;
  recommendedCount: number;
  onProfileChange: (profile: TasteProfile | null) => void;
  onClose: () => void;
}

export function SpotifySyncModal({
  profile,
  exactMatchCount,
  recommendedCount,
  onProfileChange,
  onClose,
}: SpotifySyncModalProps) {
  const [tab, setTab] = useState<'spotify' | 'quick'>(
    profile?.mode === 'manual' ? 'quick' : 'spotify'
  );
  const [clientId, setClientId] = useState(getDefaultSpotifyClientId);
  const [artistInput, setArtistInput] = useState('');
  const [busyMsg, setBusyMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const redirectUri = getSpotifyRedirectUri();
  const hasBuiltInClientId = Boolean((import.meta.env.VITE_SPOTIFY_CLIENT_ID || '').trim());

  async function handleConnectSpotify(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    try {
      await startSpotifyOAuth(clientId);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Could not start Spotify login.');
    }
  }

  async function handleRefreshSpotify() {
    setErrorMsg(null);
    setBusyMsg('Syncing your Spotify top artists…');
    try {
      const updated = await refreshSpotifySync((msg) => setBusyMsg(msg));
      onProfileChange(updated);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Could not refresh Spotify data.');
    } finally {
      setBusyMsg(null);
    }
  }

  async function handleImportArtists(names: string[]) {
    if (names.length === 0) return;
    setErrorMsg(null);
    setBusyMsg('Matching your artists & discovering similar acts…');
    try {
      const updated = await buildManualTasteProfile(names, profile, (msg) => setBusyMsg(msg));
      onProfileChange(updated);
      setArtistInput('');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Could not build recommendations.');
    } finally {
      setBusyMsg(null);
    }
  }

  function handleQuickSubmit(e: React.FormEvent) {
    e.preventDefault();
    const names = artistInput
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    handleImportArtists(names);
  }

  function handleDisconnect() {
    disconnectTasteProfile();
    onProfileChange(null);
    setErrorMsg(null);
  }

  function copyRedirectUri() {
    navigator.clipboard?.writeText(redirectUri).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  const savedArtistNames = new Set((profile?.artists || []).map((a) => a.name.toLowerCase()));

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Sync Spotify and recommendations"
      onClick={onClose}
    >
      <div className="modal-card modal-card-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <span className="filter-label" style={{ paddingTop: 0, color: '#4ade80' }}>
              <Sparkles size={12} style={{ verticalAlign: '-1px', marginRight: 4 }} />
              Spotify &amp; Personal Recommendations
            </span>
            <h3>Find shows you’ll love in Chicago</h3>
          </div>
          <button className="btn btn-icon" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {/* Active Profile Summary */}
          {profile && (
            <div className="spotify-status-card">
              <div className="spotify-status-top">
                <div className="spotify-user">
                  {profile.avatarUrl ? (
                    <img src={profile.avatarUrl} alt="" className="spotify-avatar" />
                  ) : (
                    <span className="spotify-avatar spotify-avatar-icon">
                      <Headphones size={18} />
                    </span>
                  )}
                  <div>
                    <strong>{profile.displayName || 'Connected'}</strong>
                    <div className="spotify-sub">
                      {profile.artists.length} artists · {Object.keys(profile.relatedArtists).length}{' '}
                      similar artists tracked
                    </div>
                  </div>
                </div>
                <div className="spotify-status-actions">
                  {profile.mode === 'spotify' && (
                    <button
                      type="button"
                      className="btn btn-spotify"
                      onClick={handleRefreshSpotify}
                      disabled={Boolean(busyMsg)}
                    >
                      <RefreshCw size={14} className={busyMsg ? 'spin' : ''} /> Sync
                    </button>
                  )}
                  <button type="button" className="btn" onClick={handleDisconnect} disabled={Boolean(busyMsg)}>
                    <LogOut size={14} /> Disconnect
                  </button>
                </div>
              </div>

              <div className="spotify-match-row">
                <span className="spotify-match-pill exact">
                  <strong>{exactMatchCount}</strong> your artists playing in the next 12 mo
                </span>
                <span className="spotify-match-pill similar">
                  <strong>{recommendedCount}</strong> total personalized picks
                </span>
              </div>

              {profile.topGenres.length > 0 && (
                <div className="spotify-genres">
                  <span>Top genres:</span>
                  {profile.topGenres.map((g) => (
                    <span key={g.label} className="tag">
                      {g.label}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Mode Tabs */}
          <div className="view-switch modal-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'spotify'}
              className={tab === 'spotify' ? 'active' : ''}
              onClick={() => setTab('spotify')}
            >
              <Headphones size={14} /> Connect Spotify Account
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'quick'}
              className={tab === 'quick' ? 'active' : ''}
              onClick={() => setTab('quick')}
            >
              <Sparkles size={14} /> Quick Artist Taste (No Login)
            </button>
          </div>

          {busyMsg && (
            <div className="spotify-progress">
              <RefreshCw size={15} className="spin" />
              <span>{busyMsg}</span>
            </div>
          )}

          {errorMsg && <div className="spotify-error">{errorMsg}</div>}

          {tab === 'spotify' && (
            <form onSubmit={handleConnectSpotify} className="spotify-pane">
              <p className="modal-desc">
                Connect your Spotify account via secure OAuth PKCE (read-only) to pull your{' '}
                <strong>Top Artists</strong> (4 weeks, 6 months &amp; all time),{' '}
                <strong>Followed Artists</strong>, and <strong>Top Genres</strong>—then automatically
                match them plus similar artists against the next 12 months of Chicago shows.
              </p>

              {!hasBuiltInClientId && (
                <>
                  <label className="field-label">
                    Spotify Client ID
                    <input
                      type="text"
                      className="text-input"
                      placeholder="Paste your 32-character Spotify Client ID"
                      value={clientId}
                      onChange={(e) => setClientId(e.target.value)}
                    />
                  </label>

                  <details className="spotify-setup-help" open={!clientId}>
                    <summary>One-time setup (30 seconds, free Spotify Developer App)</summary>
                    <ol>
                      <li>
                        Open{' '}
                        <a
                          href="https://developer.spotify.com/dashboard"
                          target="_blank"
                          rel="noreferrer"
                        >
                          developer.spotify.com/dashboard
                        </a>{' '}
                        and click <strong>Create app</strong> (select <em>Web API</em>).
                      </li>
                      <li>
                        Add this exact <strong>Redirect URI</strong> in your app settings:
                        <div className="redirect-uri-box">
                          <code>{redirectUri}</code>
                          <button type="button" className="btn btn-sm" onClick={copyRedirectUri}>
                            {copied ? <Check size={13} /> : <Copy size={13} />}
                            {copied ? 'Copied' : 'Copy'}
                          </button>
                        </div>
                      </li>
                      <li>
                        Copy the <strong>Client ID</strong> (no client secret needed—PKCE runs
                        entirely in your browser) and paste it above.
                      </li>
                    </ol>
                  </details>
                </>
              )}

              <div className="modal-footer">
                <span className="modal-hint">
                  Tokens stay in your browser’s local storage and are never sent to a third-party server.
                </span>
                <button
                  type="submit"
                  className="btn btn-spotify-solid"
                  disabled={Boolean(busyMsg) || (!hasBuiltInClientId && !clientId.trim())}
                >
                  <Headphones size={15} />
                  {profile?.mode === 'spotify' ? 'Reconnect Spotify' : 'Connect with Spotify'}
                </button>
              </div>
            </form>
          )}

          {tab === 'quick' && (
            <div className="spotify-pane">
              <p className="modal-desc">
                Don’t want to set up a Spotify Client ID yet? Add a few artists you love below—we’ll
                match them and automatically discover similar artists coming to Chicago over the next 12
                months.
              </p>

              <form onSubmit={handleQuickSubmit} className="quick-add-row">
                <input
                  type="text"
                  className="text-input"
                  placeholder="Type artists separated by commas (e.g. Khruangbin, Fred again.., Slow Pulp)"
                  value={artistInput}
                  onChange={(e) => setArtistInput(e.target.value)}
                  disabled={Boolean(busyMsg)}
                />
                <button
                  type="submit"
                  className="btn btn-spotify-solid"
                  disabled={Boolean(busyMsg) || !artistInput.trim()}
                >
                  <Plus size={15} /> Add &amp; Match
                </button>
              </form>

              <div className="quick-seeds">
                <span className="filter-label" style={{ paddingTop: 0 }}>
                  Tap to add popular artists
                </span>
                <div className="chip-row">
                  {QUICK_CHICAGO_ARTIST_SEEDS.map((artist) => {
                    const added = savedArtistNames.has(artist.toLowerCase());
                    return (
                      <button
                        type="button"
                        key={artist}
                        className={`pill pill-sm ${added ? 'active' : ''}`}
                        style={{ '--chip-color': '#1db954' } as React.CSSProperties}
                        disabled={Boolean(busyMsg) || added}
                        onClick={() => handleImportArtists([artist])}
                      >
                        {added ? <Check size={12} /> : <Plus size={12} />}
                        {artist}
                      </button>
                    );
                  })}
                </div>
              </div>

              {profile && profile.artists.length > 0 && (
                <div className="quick-saved-list">
                  <span className="filter-label" style={{ paddingTop: 0 }}>
                    Your synced artists ({profile.artists.length})
                  </span>
                  <div className="chip-row">
                    {profile.artists.slice(0, 30).map((a) => (
                      <span key={a.key} className="tag tag-removable">
                        {a.name}
                        {profile.mode === 'manual' && (
                          <button
                            type="button"
                            aria-label={`Remove ${a.name}`}
                            onClick={() => onProfileChange(removeArtistFromManualProfile(profile, a.key))}
                          >
                            <X size={11} />
                          </button>
                        )}
                      </span>
                    ))}
                    {profile.artists.length > 30 && (
                      <span className="tag">+{profile.artists.length - 30} more</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
