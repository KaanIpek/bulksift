/**
 * Where a *set's* artwork lives.
 *
 * Card pictures used to come from here too, and no longer do - see `thumbs.ts`
 * for why the host cannot be trusted with them. Set symbols and wordmarks still
 * do: they are one image per set rather than one per card, on screens that read
 * fine without them, and bundling 348 more files to save a few kilobytes of
 * traffic is not a trade worth making.
 *
 * Kept apart from `theme.ts` because that imports react-native for a platform
 * check, which is enough to stop Node loading it in a test.
 */

const HOST = 'https://images.pokemontcg.io';

/** A set's symbol - the little glyph printed next to a card's number. */
export const symbolUrl = (setId: string) => `${HOST}/${setId}/symbol.png`;

/** A set's logo: its wordmark, wide and transparent. */
export const logoUrl = (setId: string) => `${HOST}/${setId}/logo.png`;
