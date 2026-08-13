/**
 * Scan worker.
 *
 * The scan loop runs off the main thread so a slow frame never stutters the
 * camera preview. Frames arrive as transferable ImageData buffers, so there is
 * no per-frame copy.
 */

import {
  CardIndex,
  Scanner,
  loadCards,
  type CardRecord,
  type CompactCatalogue,
  type PriceBook,
} from '@bulksift/core';

let scanner: Scanner | null = null;
let cards: CardRecord[] = [];

export interface InitMessage {
  type: 'init';
  dataBase: string;
}

export interface FrameMessage {
  type: 'frame';
  buffer: ArrayBuffer;
  width: number;
  height: number;
  seq: number;
}

export interface ResetMessage {
  type: 'reset';
}

type Incoming = InitMessage | FrameMessage | ResetMessage;

async function init(dataBase: string) {
  const [indexBuf, cardsJson, priceJson] = await Promise.all([
    fetch(`${dataBase}/index.bin`).then((r) => {
      if (!r.ok) throw new Error(`index.bin: HTTP ${r.status}`);
      return r.arrayBuffer();
    }),
    fetch(`${dataBase}/cards.json`).then((r) => {
      if (!r.ok) throw new Error(`cards.json: HTTP ${r.status}`);
      return r.json() as Promise<CompactCatalogue | CardRecord[]>;
    }),
    fetch(`${dataBase}/prices.json`).then((r) => {
      if (!r.ok) throw new Error(`prices.json: HTTP ${r.status}`);
      return r.json() as Promise<PriceBook>;
    }),
  ]);

  const index = CardIndex.parse(indexBuf);
  cards = loadCards(cardsJson);
  scanner = new Scanner(index, cards, priceJson);

  let priced = 0;
  for (const c of cards) if (priceJson.prices[c.i]) priced++;

  self.postMessage({
    type: 'ready',
    cards: cards.length,
    bits: index.bits,
    indexBytes: indexBuf.byteLength,
    priced,
    priceUpdated: priceJson.updated,
    priceSource: priceJson.source,
  });
}

self.onmessage = async (ev: MessageEvent<Incoming>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'init') {
      await init(msg.dataBase);
      return;
    }
    if (msg.type === 'reset') {
      scanner?.reset();
      return;
    }
    if (msg.type === 'frame') {
      if (!scanner) return;
      const rgba = new Uint8ClampedArray(msg.buffer);
      const result = scanner.processFrame(rgba, msg.width, msg.height);
      self.postMessage({
        type: 'result',
        seq: msg.seq,
        detection: result.detection,
        preview: result.preview,
        hit: result.hit,
        timings: result.timings,
      });
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err instanceof Error ? err.message : err) });
  }
};
