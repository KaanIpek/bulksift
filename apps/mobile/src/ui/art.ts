/**
 * Where a card's picture lives.
 *
 * The catalogue's image URL is `{host}/{setId}/{number}.png` for every one of
 * the 20,444 cards, so it is derived rather than stored - 20k URLs would be
 * half a megabyte of duplicated string in a file the app parses at launch.
 *
 * Recognition never touches these. They are decoration, and everything that
 * reads a card still works with the network off.
 *
 * Kept apart from `theme.ts` because that imports react-native for a
 * platform check, and these four lines are the part worth testing off-device -
 * the same split as `collection.ts` against `collectionStore.ts`.
 */

const HOST = 'https://images.pokemontcg.io';

/**
 * A card's picture, at 245x342, or the large scan with `hires`.
 *
 * The number is percent-encoded. Two cards in the catalogue need it: the Unown
 * "!" and "?" from Unseen Forces. Left raw, the "?" ends the URL's path and
 * turns `.png` into a query string, so the request goes to a directory instead
 * of a file. The catalogue's own stored URL for that card has exactly that bug;
 * encoded, it reaches the server and gets an image back.
 */
export function artUrl(setId: string, number: string, hires = false): string {
  return `${HOST}/${setId}/${encodeURIComponent(number)}${hires ? '_hires' : ''}.png`;
}

/** A set's symbol - the little glyph printed next to a card's number. */
export const symbolUrl = (setId: string) => `${HOST}/${setId}/symbol.png`;

/** A set's logo: its wordmark, wide and transparent. */
export const logoUrl = (setId: string) => `${HOST}/${setId}/logo.png`;
