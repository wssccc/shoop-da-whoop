// Parse a board layout (8 lines x 5 tokens) into a solver state.
//
// Token grammar (per docs/solution.md):
//   rN / bN / gN  → number card: r=red, b=black, g=green, N=1..9
//   w  → black dragon (萬)
//   f  → green dragon (發)
//   z  → red dragon (中)
//   h  → flower (花)
//
// Layout orientation: each line is ONE column, written left→right from the
// BOTTOM of the stack (the first-dealt card, at the visual TOP of the column)
// down to the TOP of the stack — the LAST token on a line is the column top
// (the grabbable "outermost" card the player pulls off, rendered at the
// visual bottom of the cascade). So "z g7 g2 b2 f" means: 红中 at the bottom
// of the stack, then 绿7, 绿2, 黑2, and 发 on top (grabbable).
//
// This matches the internal array order produced by deck.deal() (col[0] =
// first dealt = visual top, col[last] = stack top / grabbable) — no reversal.
//
// A legacy no-colour mode is supported: plain digits 1..9 with no colour prefix
// get assigned red/black/green in encounter order per rank.

import { COLORS, FREE_CELL_COUNT, RANK_MAX, TABLEAU_COLS } from './rules.js';

const PREFIX_COLOR = { r: 'red', b: 'black', g: 'green' };
const SPECIAL = {
  // dragon glyphs map to their colour (rules.md: 红=中, 黑=萬, 绿=發)
  w: { type: 'dragon', color: 'black' },
  f: { type: 'dragon', color: 'green' },
  z: { type: 'dragon', color: 'red' },
  h: { type: 'flower' },
};

/** Strip the legend/footer (e.g. "w=万") and blanks, keep the 8 column lines. */
function extractColumnLines(text) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^[a-z]=/.test(line)) continue; // legend "w=万"
    // A column line is whitespace-separated tokens. Require >=2 tokens to avoid
    // grabbing prose by accident.
    const toks = line.split(/\s+/);
    if (toks.length < 2) continue;
    out.push(toks);
    if (out.length === TABLEAU_COLS) break;
  }
  return out;
}

/**
 * Parse tokens to cards. Auto-detect no-colour vs coloured format per the
 * first token. Throws on invalid tokens.
 */
function parseTokens(tokens, legacyCounter) {
  return tokens.map((tok) => {
    const t = tok.toLowerCase();
    if (SPECIAL[t]) return { ...SPECIAL[t] };
    // coloured number: first char r/b/g + digit
    if (t.length >= 2 && PREFIX_COLOR[t[0]] && /^\d$/.test(t.slice(1))) {
      const rank = Number(t.slice(1));
      if (rank < 1 || rank > RANK_MAX) throw new Error(`rank out of range in token "${tok}"`);
      return { type: 'number', color: PREFIX_COLOR[t[0]], rank };
    }
    // legacy no-colour: plain digit
    if (t.length === 1 && /^\d$/.test(t)) {
      const rank = Number(t);
      const seen = legacyCounter.get(rank) ?? 0;
      if (seen >= COLORS.length) {
        throw new Error(`rank ${rank} appears more than ${COLORS.length} times in legacy mode`);
      }
      legacyCounter.set(rank, seen + 1);
      return { type: 'number', color: COLORS[seen], rank };
    }
    throw new Error(`unrecognised token "${tok}"`);
  });
}

export function parseLayout(text) {
  const lines = extractColumnLines(text);
  if (lines.length !== TABLEAU_COLS) {
    throw new Error(`expected ${TABLEAU_COLS} column lines, found ${lines.length}`);
  }
  const legacy = new Map();
  const tableau = lines.map((toks) => {
    if (toks.length !== 5) {
      throw new Error(`each column needs 5 tokens, got ${toks.length}: "${toks.join(' ')}"`);
    }
    // A line reads bottom-of-stack → top-of-stack, which IS the internal array
    // order (col[0] = visual top = first dealt, col[last] = grabbable top).
    return parseTokens(toks, legacy);
  });

  const state = {
    tableau,
    freeCells: Array.from({ length: FREE_CELL_COUNT }, () => null),
    foundations: Object.fromEntries(COLORS.map((c) => [c, []])),
    flowerSlot: null,
  };
  validateDeck(state);
  return state;
}

/** Confirm the state holds exactly one flower, 4 dragons per colour, and
 *  one number card per (colour, rank). Throws otherwise. */
export function validateDeck(state) {
  let flowers = state.flowerSlot ? 1 : 0;
  const numbers = {}; // 'color:rank' -> count
  const dragons = {}; // 'color' -> count
  for (const col of state.tableau) {
    for (const c of col) {
      if (c.type === 'flower') flowers++;
      else if (c.type === 'number') {
        const k = c.color + ':' + c.rank;
        numbers[k] = (numbers[k] ?? 0) + 1;
      } else if (c.type === 'dragon') {
        dragons[c.color] = (dragons[c.color] ?? 0) + 1;
      }
    }
  }
  for (const fc of state.freeCells) {
    if (!fc) continue;
    if (fc.type === 'flower') flowers++;
    else if (fc.type === 'number') {
      const k = fc.color + ':' + fc.rank;
      numbers[k] = (numbers[k] ?? 0) + 1;
    } else if (fc.type === 'dragon') {
      dragons[fc.color] = (dragons[fc.color] ?? 0) + 1;
    } else if (fc.type === 'dragonpile') {
      dragons[fc.color] = (dragons[fc.color] ?? 0) + fc.cards.length;
    }
  }

  if (flowers !== 1) throw new Error(`deck broken: expected 1 flower, found ${flowers}`);
  for (const color of COLORS) {
    const d = dragons[color] ?? 0;
    if (d !== 4) throw new Error(`deck broken: ${color} dragons = ${d}, expected 4`);
    for (let r = 1; r <= RANK_MAX; r++) {
      const n = numbers[color + ':' + r] ?? 0;
      if (n !== 1) throw new Error(`deck broken: ${color} ${r} count = ${n}, expected 1`);
    }
  }
  return true;
}
