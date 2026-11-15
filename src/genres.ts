// Sources label genres inconsistently ("Gig:indierock", "Indie / Rock / Folk", "Nu-Metal"),
// so raw labels are mapped onto a small set of browsable families. One show can sit in several.
export interface GenreFamily {
  id: string;
  label: string;
  color: string;
  test: RegExp;
}

export const GENRE_FAMILIES: GenreFamily[] = [
  { id: 'indie', label: 'Indie / Alt', color: '#f472b6', test: /indie|alternative|garage|shoegaze|dream pop|post-punk|avant/ },
  { id: 'rock', label: 'Rock', color: '#fb923c', test: /rock|grunge|prog|psych/ },
  { id: 'pop', label: 'Pop', color: '#facc15', test: /\bpop\b(?! punk)/ },
  { id: 'electronic', label: 'Electronic / DJ', color: '#22d3ee', test: /electro|house|techno|dance|\bdj\b|bass|trance|amapiano|edm|\bparty:/ },
  { id: 'hiphop', label: 'Hip-Hop / R&B', color: '#a78bfa', test: /hip.?hop|\brap\b|r&b|rnb|trap|neo.?soul/ },
  { id: 'jazz', label: 'Jazz / Soul / Blues', color: '#60a5fa', test: /jazz|soul|blues|funk|gospel|brass|choir/ },
  { id: 'folk', label: 'Folk / Country', color: '#86efac', test: /folk|country|americana|bluegrass|singer/ },
  { id: 'heavy', label: 'Punk / Metal', color: '#f87171', test: /punk|metal|hardcore|\bemo|:emo/ },
  { id: 'global', label: 'Latin / World', color: '#fdba74', test: /latin|world|mariachi|brazil|reggae|afro|cumbia|salsa/ },
  { id: 'comedy', label: 'Comedy & More', color: '#cbd5e1', test: /comedy|theatre|talks|lecture|seminar|football|wrestling|circus|art:|civic|foodanddrink|kids|miscellaneous/ },
];

export const OTHER_GENRE: GenreFamily = { id: 'other', label: 'Unlabeled', color: '#64748b', test: /$^/ };

const FAMILY_BY_ID: Record<string, GenreFamily> = Object.fromEntries(
  [...GENRE_FAMILIES, OTHER_GENRE].map((g) => [g.id, g])
);

const cache = new Map<string, string[]>();

export function genreFamilyIds(rawGenre: string | null | undefined): string[] {
  const raw = (rawGenre || '').toLowerCase();
  let ids = cache.get(raw);
  if (!ids) {
    ids = GENRE_FAMILIES.filter((g) => g.test.test(raw)).map((g) => g.id);
    if (ids.length === 0) ids = [OTHER_GENRE.id];
    cache.set(raw, ids);
  }
  return ids;
}

export function genreFamily(id: string): GenreFamily {
  return FAMILY_BY_ID[id] || OTHER_GENRE;
}
