// Solitaire e2e save-state helpers.
//
// Builds `szsol.save` payloads that survive the engine's `loadGame` schema
// checks (freeCells length === FREE_CELL_COUNT, foundations must cover every
// colour, history entries must have a tableau) and injects them BEFORE any
// page script runs via `addInitScript`. A malformed save is silently ignored
// by loadGame (the game starts a random new deal instead), so every injection
// must be followed by `expectInjected` — asserting the seeded cards are
// actually on the board.
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { COLORS, FREE_CELL_COUNT, STORAGE_SAVE } from '../../src/game/constants';
import type { Card, CardColor, FreeCell, Saveable, Snapshot } from '../../src/game/types';

/** Number card with a caller-controlled id (ids must be unique board-wide). */
export function num(id: string, color: CardColor, rank: number): Card {
  return { id, type: 'number', color, rank };
}

export function dragon(id: string, color: CardColor): Card {
  return { id, type: 'dragon', color };
}

export function flower(id: string): Card {
  return { id, type: 'flower' };
}

export interface SaveSeed {
  tableau: Card[][];
  freeCells?: FreeCell[];
  foundations?: Partial<Record<CardColor, Card[]>>;
  flowerSlot?: Card | null;
  history?: Snapshot[];
}

/** Assemble a save payload. Defaults mirror a fresh board. */
export function makeSave(seed: SaveSeed): Saveable {
  return {
    tableau: seed.tableau,
    freeCells: seed.freeCells ?? Array.from({ length: FREE_CELL_COUNT }, () => null),
    foundations: {
      red: seed.foundations?.red ?? [],
      black: seed.foundations?.black ?? [],
      green: seed.foundations?.green ?? [],
    },
    flowerSlot: (seed.flowerSlot ?? null) as Saveable['flowerSlot'],
    history: seed.history ?? [],
  };
}

/**
 * Inject a save before any page script runs, then reload-safe goto.
 * Returns after the seeded marker cards are visible (self-check against
 * silent random-deal fallback).
 */
export async function seedSave(page: Page, save: Saveable, markerIds: string[]): Promise<void> {
  await page.addInitScript(
    ([key, json]) => {
      localStorage.clear();
      localStorage.setItem(key, json);
    },
    [STORAGE_SAVE, JSON.stringify(save)] as const,
  );
  await page.goto('/games/solitaire/');
  // `attached`, not visible: sealed dragon piles hide their real dragon
  // cards via the iOS-13 visibility fallback after the seal flip.
  await expect(page.locator('#board .card').first()).toBeAttached();
  // Self-check: a malformed save is silently dropped → random deal. The
  // marker cards must actually be on the board, otherwise the test is
  // exercising an unknown layout.
  for (const id of markerIds) {
    await expect(page.locator(`.card[data-id="${id}"]`)).toBeAttached();
  }
}

export { COLORS, FREE_CELL_COUNT };

