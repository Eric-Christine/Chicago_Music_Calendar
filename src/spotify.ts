import { GENRE_FAMILIES, OTHER_GENRE, genreFamily, genreFamilyIds } from './genres';
import { fetchDeezerRelatedArtists } from './preview';

export interface UserArtist {
  id: string; // Spotify artist ID when synced via Spotify, or normalized key for manual
  name: string;
  key: string;
  spotifyId: string | null;
  imageUrl: string | null;
  genres: string[];
  source: 'top_short' | 'top_medium' | 'top_long' | 'followed' | 'manual';
  weight: number;
}

export interface RelatedArtistEntry {
  name: string;
  basedOn: string[];
}

export interface TasteProfile {
  mode: 'spotify' | 'manual';
  displayName: string | null;
  avatarUrl: string | null;
  syncedAt: string;
  artists: UserArtist[];
  topGenres: Array<{ label: string; familyId: string | null; score: number }>;
  relatedArtists: Record<string, RelatedArtistEntry>; // keyed by normalized artist key
}

export interface RecommendationMatch {
  kind: 'exact' | 'similar' | 'genre';
  score: number;
  label: string; // short badge text, e.g. "Your Top Artist" / "Similar to Tame Impala"
  detail: string;
}

interface StoredTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  clientId: string;
}

const PROFILE_KEY = 'cmc_taste_profile_v1';
const TOKEN_KEY = 'cmc_spotify_tokens_v1';
const CLIENT_ID_KEY = 'cmc_spotify_client_id_v1';
const PKCE_VERIFIER_KEY = 'cmc_spotify_pkce_verifier';
const PKCE_STATE_KEY = 'cmc_spotify_pkce_state';

const SPOTIFY_SCOPES = 'user-top-read user-follow-read';

export function normalizeArtistKey(name: string): string {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]/g, '');
}

export function getDefaultSpotifyClientId(): string {
  const fromEnv = (import.meta.env.VITE_SPOTIFY_CLIENT_ID || '').trim();
  if (fromEnv) return fromEnv;
  try {
    return (localStorage.getItem(CLIENT_ID_KEY) || '').trim();
  } catch {
    return '';
  }
}

export function saveSpotifyClientId(clientId: string): void {
  try {
    const clean = clientId.trim();
    if (clean) localStorage.setItem(CLIENT_ID_KEY, clean);
    else localStorage.removeItem(CLIENT_ID_KEY);
  } catch {
    // ignore
  }
}

export function getSpotifyRedirectUri(): string {
  // Spotify requires exact redirect URI match; localhost must often be 127.0.0.1 in new apps,
  // so we use the exact current origin + pathname without query/hash.
  return `${window.location.origin}${window.location.pathname}`;
}

export function loadTasteProfile(): TasteProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.artists)) return null;
    return parsed as TasteProfile;
  } catch {
    return null;
  }
}

export function saveTasteProfile(profile: TasteProfile | null): void {
  try {
    if (profile) localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    else localStorage.removeItem(PROFILE_KEY);
  } catch {
    // ignore
  }
}

let sessionTokens: StoredTokens | null = null;

// Migrate browsers that used the previous persistent token store.
try {
  localStorage.removeItem(TOKEN_KEY);
} catch {
  // Browser storage can be disabled.
}

export function disconnectTasteProfile(): void {
  saveTasteProfile(null);
  sessionTokens = null;
}

// --- PKCE OAuth 2.0 Helpers ---

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function generatePkcePair(): Promise<{ verifier: string; challenge: string }> {
  const bytes = new Uint8Array(64);
  crypto.getRandomValues(bytes);
  const verifier = base64UrlEncode(bytes);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = base64UrlEncode(new Uint8Array(digest));
  return { verifier, challenge };
}

export async function startSpotifyOAuth(clientId: string): Promise<void> {
  const cleanId = clientId.trim();
  if (!cleanId) throw new Error('Enter a Spotify Client ID to connect.');
  saveSpotifyClientId(cleanId);

  const { verifier, challenge } = await generatePkcePair();
  const stateBytes = new Uint8Array(16);
  crypto.getRandomValues(stateBytes);
  const state = base64UrlEncode(stateBytes);

  sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier);
  sessionStorage.setItem(PKCE_STATE_KEY, state);

  const params = new URLSearchParams({
    client_id: cleanId,
    response_type: 'code',
    redirect_uri: getSpotifyRedirectUri(),
    code_challenge_method: 'S256',
    code_challenge: challenge,
    scope: SPOTIFY_SCOPES,
    state,
    show_dialog: 'false',
  });

  window.location.assign(`https://accounts.spotify.com/authorize?${params.toString()}`);
}

export function hasSpotifyCallbackParams(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.has('code') || params.has('error');
}

export async function completeSpotifyCallbackIfPresent(
  onProgress?: (msg: string) => void
): Promise<TasteProfile | null> {
  const params = new URLSearchParams(window.location.search);
  const error = params.get('error');
  const code = params.get('code');
  const returnedState = params.get('state');

  if (!error && !code) return null;

  // Clean OAuth parameters from URL immediately
  const cleanUrl = `${window.location.origin}${window.location.pathname}${window.location.hash}`;
  window.history.replaceState({}, document.title, cleanUrl);

  if (error) {
    throw new Error(error === 'access_denied' ? 'Spotify login was cancelled.' : `Spotify error: ${error}`);
  }

  const expectedState = sessionStorage.getItem(PKCE_STATE_KEY);
  const verifier = sessionStorage.getItem(PKCE_VERIFIER_KEY);
  sessionStorage.removeItem(PKCE_STATE_KEY);
  sessionStorage.removeItem(PKCE_VERIFIER_KEY);

  if (!verifier || (expectedState && expectedState !== returnedState)) {
    throw new Error('Spotify login session expired. Please try connecting again.');
  }

  const clientId = getDefaultSpotifyClientId();
  if (!clientId) throw new Error('Missing Spotify Client ID.');

  onProgress?.('Connecting to Spotify…');
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'authorization_code',
    code: code!,
    redirect_uri: getSpotifyRedirectUri(),
    code_verifier: verifier,
  });

  const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok || !tokenData.access_token) {
    throw new Error(tokenData.error_description || tokenData.error || 'Spotify token exchange failed.');
  }

  const stored: StoredTokens = {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token || null,
    expiresAt: Date.now() + (tokenData.expires_in || 3600) * 1000 - 30_000,
    clientId,
  };
  sessionTokens = stored;

  return fetchSpotifyTasteProfile(stored, onProgress);
}

async function getValidAccessToken(): Promise<StoredTokens | null> {
  const tokens = sessionTokens;
  if (!tokens) return null;
  if (Date.now() < tokens.expiresAt) return tokens;
  if (!tokens.refreshToken) return null;

  const body = new URLSearchParams({
    client_id: tokens.clientId,
    grant_type: 'refresh_token',
    refresh_token: tokens.refreshToken,
  });
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.access_token) return null;
  const refreshed: StoredTokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || tokens.refreshToken,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000 - 30_000,
    clientId: tokens.clientId,
  };
  if (sessionTokens !== tokens) return sessionTokens;
  sessionTokens = refreshed;
  return refreshed;
}

export async function refreshSpotifySync(
  onProgress?: (msg: string) => void
): Promise<TasteProfile> {
  const tokens = await getValidAccessToken();
  if (!tokens) {
    throw new Error('Spotify session expired. Click Connect Spotify to re-authenticate.');
  }
  return fetchSpotifyTasteProfile(tokens, onProgress);
}

async function spotifyGet<T>(accessToken: string, endpoint: string): Promise<T | null> {
  const res = await fetch(`https://api.spotify.com/v1${endpoint}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

interface SpotifyArtistObj {
  id: string;
  name: string;
  genres?: string[];
  images?: Array<{ url: string }>;
}

async function fetchSpotifyTasteProfile(
  tokens: StoredTokens,
  onProgress?: (msg: string) => void
): Promise<TasteProfile> {
  onProgress?.('Fetching your Spotify top & followed artists…');

  const [me, shortTop, medTop, longTop, followed] = await Promise.all([
    spotifyGet<{ display_name?: string; images?: Array<{ url: string }> }>(tokens.accessToken, '/me'),
    spotifyGet<{ items?: SpotifyArtistObj[] }>(
      tokens.accessToken,
      '/me/top/artists?time_range=short_term&limit=50'
    ),
    spotifyGet<{ items?: SpotifyArtistObj[] }>(
      tokens.accessToken,
      '/me/top/artists?time_range=medium_term&limit=50'
    ),
    spotifyGet<{ items?: SpotifyArtistObj[] }>(
      tokens.accessToken,
      '/me/top/artists?time_range=long_term&limit=50'
    ),
    spotifyGet<{ artists?: { items?: SpotifyArtistObj[] } }>(
      tokens.accessToken,
      '/me/following?type=artist&limit=50'
    ),
  ]);

  const artistMap = new Map<string, UserArtist>();

  const addBatch = (
    items: SpotifyArtistObj[] | undefined,
    source: UserArtist['source'],
    baseWeight: number
  ) => {
    if (!items) return;
    items.forEach((item, idx) => {
      const key = normalizeArtistKey(item.name);
      if (!key) return;
      const rankBonus = Math.max(0, 20 - idx * 0.4);
      const weight = baseWeight + rankBonus;
      const existing = artistMap.get(key);
      if (!existing || weight > existing.weight) {
        artistMap.set(key, {
          id: item.id,
          name: item.name,
          key,
          spotifyId: item.id,
          imageUrl: item.images?.[item.images.length - 1]?.url || item.images?.[0]?.url || null,
          genres: item.genres || [],
          source,
          weight: existing ? Math.max(existing.weight, weight) : weight,
        });
      }
    });
  };

  addBatch(shortTop?.items, 'top_short', 40);
  addBatch(medTop?.items, 'top_medium', 32);
  addBatch(longTop?.items, 'top_long', 24);
  addBatch(followed?.artists?.items, 'followed', 28);

  const artists = Array.from(artistMap.values()).sort((a, b) => b.weight - a.weight);
  const topGenres = computeTopGenres(artists);

  onProgress?.(`Finding similar artists for your top ${Math.min(18, artists.length)} picks…`);
  const relatedArtists = await expandRelatedArtists(artists.slice(0, 18), onProgress);

  const profile: TasteProfile = {
    mode: 'spotify',
    displayName: me?.display_name || 'Spotify Listener',
    avatarUrl: me?.images?.[0]?.url || null,
    syncedAt: new Date().toISOString(),
    artists,
    topGenres,
    relatedArtists,
  };
  saveTasteProfile(profile);
  return profile;
}

// --- Manual / Quick Artist Import (Zero-Login Fallback) ---

export async function buildManualTasteProfile(
  artistNames: string[],
  existing?: TasteProfile | null,
  onProgress?: (msg: string) => void
): Promise<TasteProfile> {
  const cleaned = artistNames
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);

  const mergedMap = new Map<string, UserArtist>();
  if (existing && existing.mode === 'manual') {
    for (const a of existing.artists) mergedMap.set(a.key, a);
  }
  cleaned.forEach((name, idx) => {
    const key = normalizeArtistKey(name);
    if (!key) return;
    if (!mergedMap.has(key)) {
      mergedMap.set(key, {
        id: `manual-${key}`,
        name,
        key,
        spotifyId: null,
        imageUrl: null,
        genres: [],
        source: 'manual',
        weight: Math.max(15, 40 - idx),
      });
    }
  });

  const artists = Array.from(mergedMap.values()).sort((a, b) => b.weight - a.weight);
  const relatedArtists = await expandRelatedArtists(
    artists.slice(0, 18),
    onProgress,
    existing?.relatedArtists
  );

  const profile: TasteProfile = {
    mode: 'manual',
    displayName: 'My Taste Profile',
    avatarUrl: null,
    syncedAt: new Date().toISOString(),
    artists,
    topGenres: computeTopGenres(artists),
    relatedArtists,
  };
  saveTasteProfile(profile);
  return profile;
}

export function removeArtistFromManualProfile(profile: TasteProfile, artistKey: string): TasteProfile {
  const artists = profile.artists.filter((a) => a.key !== artistKey);
  const nextRelated: Record<string, RelatedArtistEntry> = {};
  const remainingNames = new Set(artists.map((a) => a.name));
  for (const [k, entry] of Object.entries(profile.relatedArtists)) {
    const kept = entry.basedOn.filter((name) => remainingNames.has(name));
    if (kept.length > 0) nextRelated[k] = { name: entry.name, basedOn: kept };
  }
  const updated: TasteProfile = {
    ...profile,
    artists,
    topGenres: computeTopGenres(artists),
    relatedArtists: nextRelated,
  };
  saveTasteProfile(updated);
  return updated;
}

function computeTopGenres(artists: UserArtist[]): TasteProfile['topGenres'] {
  const familyScores = new Map<string, number>();
  for (const artist of artists) {
    const seen = new Set<string>();
    for (const rawGenre of artist.genres) {
      for (const famId of genreFamilyIds(rawGenre)) {
        if (famId === OTHER_GENRE.id || seen.has(famId)) continue;
        seen.add(famId);
        familyScores.set(famId, (familyScores.get(famId) || 0) + artist.weight);
      }
    }
  }
  return Array.from(familyScores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([familyId, score]) => ({
      familyId,
      label: genreFamily(familyId).label,
      score: Math.round(score),
    }));
}

async function expandRelatedArtists(
  seedArtists: UserArtist[],
  onProgress?: (msg: string) => void,
  existingMap?: Record<string, RelatedArtistEntry>
): Promise<Record<string, RelatedArtistEntry>> {
  const relatedMap: Record<string, RelatedArtistEntry> = existingMap ? { ...existingMap } : {};
  const seedKeys = new Set(seedArtists.map((a) => a.key));

  // Query Deezer related artists in polite batches of 4
  const batchSize = 4;
  for (let i = 0; i < seedArtists.length; i += batchSize) {
    const batch = seedArtists.slice(i, i + batchSize);
    onProgress?.(
      `Discovering artists similar to ${batch[0].name} (${Math.min(i + batch.length, seedArtists.length)}/${seedArtists.length})…`
    );
    await Promise.all(
      batch.map(async (seed) => {
        try {
          const { related } = await fetchDeezerRelatedArtists(seed.name);
          for (const relName of related) {
            const relKey = normalizeArtistKey(relName);
            if (!relKey || seedKeys.has(relKey)) continue;
            if (!relatedMap[relKey]) {
              relatedMap[relKey] = { name: relName, basedOn: [seed.name] };
            } else if (!relatedMap[relKey].basedOn.includes(seed.name)) {
              relatedMap[relKey].basedOn.push(seed.name);
            }
          }
        } catch {
          // ignore individual lookup timeouts
        }
      })
    );
    if (i + batchSize < seedArtists.length) {
      await new Promise((r) => setTimeout(r, 350));
    }
  }

  return relatedMap;
}

// --- Event Matcher & Recommendation Scorer ---

export interface ScorableEvent {
  headliner: string;
  support: string[];
  spotifyArtistId: string | null;
  genre: string;
  artistFans?: number | null;
}

export function buildTasteIndex(profile: TasteProfile | null) {
  if (!profile) return null;
  const bySpotifyId = new Map<string, UserArtist>();
  const byKey = new Map<string, UserArtist>();
  const rawGenreTokens = new Set<string>();
  const topFamilyRank = new Map<string, number>();

  for (const a of profile.artists) {
    if (a.spotifyId) bySpotifyId.set(a.spotifyId, a);
    byKey.set(a.key, a);
    for (const g of a.genres) {
      const lower = g.toLowerCase();
      rawGenreTokens.add(lower);
    }
  }

  profile.topGenres.forEach((g, idx) => {
    if (g.familyId) topFamilyRank.set(g.familyId, idx);
  });

  // Also infer genre affinity if manual mode has no raw genres (use related artist count)
  return {
    profile,
    bySpotifyId,
    byKey,
    rawGenreTokens,
    topFamilyRank,
  };
}

export type TasteIndex = ReturnType<typeof buildTasteIndex>;

export function scoreEventForUser(ev: ScorableEvent, index: TasteIndex): RecommendationMatch | null {
  if (!index) return null;
  const { profile, bySpotifyId, byKey, topFamilyRank } = index;

  // 1. Exact headliner match by Spotify Artist ID or normalized name
  const headKey = normalizeArtistKey(ev.headliner);
  const exactHead =
    (ev.spotifyArtistId && bySpotifyId.get(ev.spotifyArtistId)) || byKey.get(headKey);
  if (exactHead) {
    const label =
      exactHead.source === 'followed'
        ? 'Followed on Spotify'
        : exactHead.source === 'manual'
        ? 'Your Artist'
        : 'Your Top Artist';
    return {
      kind: 'exact',
      score: 100 + exactHead.weight,
      label,
      detail: `${exactHead.name} is in your ${exactHead.source === 'manual' ? 'saved artists' : 'Spotify library'}`,
    };
  }

  // 2. Exact supporting act match
  for (const sup of ev.support || []) {
    const supKey = normalizeArtistKey(sup);
    const exactSup = byKey.get(supKey);
    if (exactSup) {
      return {
        kind: 'exact',
        score: 95 + exactSup.weight * 0.6,
        label: `Opener: ${exactSup.name}`,
        detail: `Supporting act ${exactSup.name} is in your library`,
      };
    }
  }

  // 3. Similar artist recommendation (headliner or support)
  const relHead = profile.relatedArtists[headKey];
  if (relHead && relHead.basedOn.length > 0) {
    const seeds = relHead.basedOn.slice(0, 2).join(' & ');
    return {
      kind: 'similar',
      score: 72 + Math.min(20, relHead.basedOn.length * 8),
      label: `Similar to ${seeds}`,
      detail: `Recommended because you listen to ${relHead.basedOn.slice(0, 3).join(', ')}`,
    };
  }
  for (const sup of ev.support || []) {
    const relSup = profile.relatedArtists[normalizeArtistKey(sup)];
    if (relSup && relSup.basedOn.length > 0) {
      return {
        kind: 'similar',
        score: 68 + Math.min(12, relSup.basedOn.length * 6),
        label: `Similar to ${relSup.basedOn[0]}`,
        detail: `Opener ${sup} is similar to ${relSup.basedOn.slice(0, 2).join(' & ')}`,
      };
    }
  }

  // 4. Genre taste match (only when topGenres are populated from Spotify)
  if (topFamilyRank.size > 0) {
    const evFamilies = genreFamilyIds(ev.genre).filter((id) => id !== OTHER_GENRE.id);
    let bestRank = Infinity;
    let bestFamId: string | null = null;
    for (const famId of evFamilies) {
      const rank = topFamilyRank.get(famId);
      if (rank !== undefined && rank < bestRank) {
        bestRank = rank;
        bestFamId = famId;
      }
    }
    if (bestFamId !== null && bestRank <= 2) {
      const fam = GENRE_FAMILIES.find((g) => g.id === bestFamId);
      const fanBoost = ev.artistFans ? Math.min(12, Math.log10(ev.artistFans + 1) * 2.5) : 0;
      return {
        kind: 'genre',
        score: 45 - bestRank * 6 + fanBoost,
        label: `${fam?.label || 'Taste'} pick`,
        detail: `Matches your top Spotify genre (${fam?.label})`,
      };
    }
  }

  return null;
}

export const QUICK_CHICAGO_ARTIST_SEEDS = [
  'Tame Impala',
  'Khruangbin',
  'Turnstile',
  'Fred again..',
  'Wet Leg',
  'Death Cab for Cutie',
  'Slow Pulp',
  'Four Tet',
  'IDLES',
  'Kaytranada',
  'Parcels',
  'Waxahatchee',
  'Beach House',
  'Zeds Dead',
  'Makaya McCraven',
  'The Menzingers',
];
