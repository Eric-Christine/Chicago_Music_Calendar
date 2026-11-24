async function fetchDeezer<T>(params: Record<string, string>): Promise<T> {
  const url = new URL('https://ericchristine.com/api/music-preview.php');
  url.search = new URLSearchParams(params).toString();
  const response = await fetch(url, {
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error('Deezer request failed');
  return response.json() as Promise<T>;
}

// Preview URLs are signed and expire within minutes, so they are fetched at play time
export async function fetchDeezerPreviewUrl(trackId: number): Promise<string> {
  const track = await fetchDeezer<{ preview?: string }>({ track: String(trackId) });
  if (!track?.preview) throw new Error('No preview for this track');
  return track.preview;
}

export async function fetchDeezerRelatedArtists(artistName: string): Promise<{
  genres?: string[];
  related: string[];
}> {
  const search = await fetchDeezer<{ data?: Array<{ id: number; name: string }> }>(
    { search: artistName }
  );
  const artist = search?.data?.[0];
  if (!artist) return { related: [] };
  const rel = await fetchDeezer<{ data?: Array<{ name: string }> }>(
    { related: String(artist.id) }
  );
  return {
    related: (rel?.data || []).map((a) => a.name).filter(Boolean),
  };
}

let silentClipUrl: string | null = null;

// A short silent WAV. Playing it inside the tap handler unlocks the audio element on
// iOS Safari, which otherwise blocks play() once we've awaited the Deezer lookup.
export function silentClip(): string {
  if (!silentClipUrl) {
    const sampleRate = 8000;
    const samples = 800;
    const view = new DataView(new ArrayBuffer(44 + samples));
    const writeText = (offset: number, text: string) => {
      for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
    };
    writeText(0, 'RIFF');
    view.setUint32(4, 36 + samples, true);
    writeText(8, 'WAVEfmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate, true);
    view.setUint16(32, 1, true);
    view.setUint16(34, 8, true);
    writeText(36, 'data');
    view.setUint32(40, samples, true);
    for (let i = 0; i < samples; i++) view.setUint8(44 + i, 128);
    silentClipUrl = URL.createObjectURL(new Blob([view], { type: 'audio/wav' }));
  }
  return silentClipUrl;
}
