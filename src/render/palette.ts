import type { Faction } from '../core/types';

/** One palette for the whole game. The look is a bright snow front seen from
 *  a low angle: near-white ground with cool blue shadow, warm trodden mud for
 *  the roads, and three saturated faction colours that stay legible against
 *  all of it. */
export const SNOW = {
  base: '#f4f7fa',
  plateLight: '#ffffff',
  plateDark: '#dfe7ef',
  seam: 'rgba(150,172,192,0.22)',
  drift: '#eef3f8',
  shadow: 'rgba(122,146,172,0.30)',
  deepShadow: 'rgba(96,120,148,0.38)',
};

export const ROAD = {
  fill: '#c2a179',
  edge: '#ad8c66',
};

export const ROCK = {
  light: '#f7fafc',
  mid: '#dbe4ed',
  dark: '#b9c6d4',
};

export const TREE = {
  snow: '#eef7f2',
  mid: '#cfe6da',
  dark: '#a9cfbc',
  trunk: '#8fa8a0',
};

interface FactionPalette {
  bright: string;
  main: string;
  dark: string;
  deep: string;
  trim: string;
  glow: string;
  trail: string;
}

export const FACTION: Record<Faction, FactionPalette> = {
  player: {
    bright: '#5ce08a',
    main: '#25c25c',
    dark: '#189544',
    deep: '#0f6b30',
    trim: '#e8fff0',
    glow: 'rgba(60,224,138,0.55)',
    trail: 'rgba(45,200,110,0.42)',
  },
  enemy: {
    bright: '#ff7a6b',
    main: '#e8483f',
    dark: '#b9302c',
    deep: '#8a201e',
    trim: '#fff0ee',
    glow: 'rgba(255,110,95,0.55)',
    trail: 'rgba(225,70,60,0.42)',
  },
  neutral: {
    bright: '#c3ced8',
    main: '#9aa5ad',
    dark: '#77828b',
    deep: '#5a656d',
    trim: '#f2f5f8',
    glow: 'rgba(180,192,202,0.45)',
    trail: 'rgba(150,162,172,0.35)',
  },
};

export const INK = {
  text: '#12202c',
  outline: '#ffffff',
  badge: '#ffffff',
  badgeShadow: 'rgba(20,36,52,0.30)',
};
