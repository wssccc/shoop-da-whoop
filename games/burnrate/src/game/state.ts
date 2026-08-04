// State construction & (de)serialisation helpers.
//
// `createInitialState` builds a full deck but leaves hands empty — dealing is
// the engine's job so it owns draw semantics. `cloneState` deep-copies for
// undo/persist snapshots; plain JSON clone is safe because the state is fully
// serialisable data (no functions).

import { buildDeck } from './cards';
import { MIN_PLAYERS, START_CASH } from './constants';
import { defaultRng } from './rng';
import type {
    Card,
    GameState,
    LogType,
    PlayerId,
    PlayerState,
    Rng,
} from './types';

export function createPlayer(): PlayerState {
  return {
    cash: START_CASH,
    hand: [],
    company: [],
    projects: [],
    auditThisTurn: false,
    alive: true,
    bailoutUsed: false,
    wasStrictLowest: false,
    discardedThisTurn: false,
    attackers: {},
  };
}

export interface CreateStateOptions {
  rng?: Rng;
  /** Number of players (2-5). Index 0 is the human. */
  playerCount?: number;
}

/** A fresh, un-dealt game: shuffled deck, $100M each, empty boards. The first
 *  turn belongs to the human (player 0). */
export function createInitialState({ rng = defaultRng, playerCount = MIN_PLAYERS }: CreateStateOptions = {}): GameState {
  return {
    deck: buildDeck({ rng }),
    discard: [],
    turn: 1,
    currentPlayer: 0,
    players: Array.from({ length: playerCount }, () => createPlayer()),
    log: [],
    gameOver: false,
    winner: null,
    pending: null,
  };
}

export function cloneState(state: GameState): GameState {
  // Deep-clone via JSON round-trip. The state is a plain serialisable tree
  // (no functions / Dates / Maps), so JSON is both correct and universal.
  // `structuredClone` is Safari 15.4+ / iOS 15.4+ ONLY — absent on the
  // iOS 13 / Safari 13 floor this project targets, where it threw a
  // TypeError inside the MCTS worker's sampleWorld (and on state restore),
  // making every AI turn time out with no card ever played. JSON drops
  // `undefined`-valued keys, but that is observationally identical here.
  return JSON.parse(JSON.stringify(state));
}

/** Pushes a log entry to the front and trims to MAX_LOG. Pure: does not invoke
 *  engine callbacks (the engine wraps this for side-effecting logging). */
export function pushLog(state: GameState, msg: string, type: LogType = 'info'): void {
  state.log.unshift({ msg, type });
  if (state.log.length > 50) state.log.length = 50;
}

/** Friendly Chinese name for log lines: the human is "你", AI slots are
 *  numbered from 1. */
export function sideName(player: PlayerId): string {
  return player === 0 ? '你' : `AI ${player}`;
}

/** Find a card by id in any of a player's zones (hand/company/projects). */
export function findCardOwner(
  state: GameState,
  player: PlayerId,
  cardId: string,
): 'hand' | 'company' | 'projects' | null {
  const p = state.players[player];
  if (p.hand.some((c) => c.id === cardId)) return 'hand';
  if (p.company.some((c) => c.id === cardId)) return 'company';
  if (p.projects.some((c) => c.id === cardId)) return 'projects';
  return null;
}

/** Type guard convenience used by tests/UI. */
export function isCard(c: Card | undefined | null): c is Card {
  return c !== undefined && c !== null;
}
