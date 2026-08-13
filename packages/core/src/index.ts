/** BulkSift recognition engine - shared by the web and mobile apps. */

export {
  CANON_W,
  CANON_H,
  N_BITS,
  N_BYTES,
  describe,
  toGray,
  boxGrid,
} from './descriptor.ts';

export {
  detectCard,
  rectify,
  rotate180,
  orderQuad,
  type Point,
  type Quad,
  type Detection,
  type DetectOptions,
} from './detect.ts';

export { CardIndex, type Candidate, type MatchResult } from './matcher.ts';

export { Scanner, type FrameResult } from './scanner.ts';

export {
  DEFAULT_CONFIG,
  expandCards,
  loadCards,
  type CompactCatalogue,
  type CardRecord,
  type CardPrices,
  type VariantPrice,
  type PriceBook,
  type PricedVariant,
  type ScanHit,
  type ScannerConfig,
} from './types.ts';
