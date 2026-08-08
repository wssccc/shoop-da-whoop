// Engine action-unit tests — the single source of truth for the operation
// sequence model (beginUnit → stepUnit* → endUnit). The animation layer
// consumes engine.stepUnit() verbatim, so these tests pin the exact order
// every unit must be presented in: 收龙 dragons FREE-CELL first (they vacate
// their slots, guaranteeing the fresh pile always has a home — a
// column-top dragon collected into an all-dragon-free-cell board would
// otherwise land on a ghost freeCells[-1] and vanish), column tops last,
// then auto-moves in nextAutoMove's true convergence order (flower first,
// ranks ascending, column tie-break).

import { describe, expect, it } from 'vitest';
import { RANK_MAX } from './constants';
import { SolitaireEngine, type UnitAction } from './engine';
import { fromLayout } from './state';
import type {
    Card,
    CardColor,
    DragonCard,
    FlowerCard,
    NumberCard,
} from './types';

function num(color: CardColor, rank: number, n = 0): NumberCard {
    return { id: `${color}-${rank}-${n}`, type: 'number', color, rank };
}
function dragon(color: CardColor, n = 0): DragonCard {
    return { id: `dragon-${color}-${n}`, type: 'dragon', color };
}
function flower(): FlowerCard {
    return { id: 'flower-0', type: 'flower' };
}
function foundation(ranks: number[], color: CardColor): NumberCard[] {
    return ranks.map((r, i) => num(color, r, i));
}
function emptyFoundations() {
    return { red: [], black: [], green: [] };
}

function engineWith(layout: {
    tableau: Card[][];
    freeCells?: (NumberCard | DragonCard | null)[];
    foundations?: Record<CardColor, NumberCard[]>;
    flowerSlot?: FlowerCard | null;
}) {
    const e = new SolitaireEngine();
    e.setState(
        fromLayout({
            tableau: layout.tableau,
            freeCells: layout.freeCells ?? [],
            foundations: layout.foundations ?? emptyFoundations(),
            flowerSlot: layout.flowerSlot ?? null,
        }),
    );
    return e;
}

function ids(actions: UnitAction[]): string[] {
    return actions.map((a) => a.id);
}

/** Consume every remaining step of the current unit (the executor's loop). */
function drain(e: SolitaireEngine): UnitAction[] {
    const actions: UnitAction[] = [];
    let a: UnitAction | null;
    while ((a = e.stepUnit()) !== null) actions.push(a);
    return actions;
}

/** Begin a move unit, apply the user step, drain the cascade, end the unit. */
function moveAndDrain(e: SolitaireEngine, run: Card[], dest: Parameters<SolitaireEngine['move']>[1]) {
    e.beginUnit('move');
    const r = e.move(run, dest);
    expect(r.ok).toBe(true);
    const actions = drain(e);
    e.endUnit();
    return actions;
}

describe('action units — engine operation sequence', () => {
    it('a move unit: user step is NOT in the sequence; flower flies first, before safe number runs', () => {
        const e = engineWith({
            tableau: [
                [num('black', 2, 0), flower()], // flower exposed on top
                [num('red', 1, 0)], // safe red-1 exposed
                [num('black', 9, 0)], // the user-step card (not safe: black=0)
            ],
            freeCells: [null],
        });

        // User step: park black-9 in the free cell — it is NOT safe (black
        // foundation is empty), so it never re-enters the cascade.
        const actions = moveAndDrain(e, [num('black', 9, 0)], { type: 'freecell', index: 0 });

        expect(ids(actions)).toEqual(['flower-0', 'red-1-0']);
        expect(e.state.flowerSlot?.id).toBe('flower-0');
        expect(e.state.foundations.red.map((c) => c.rank)).toEqual([1]);
        // black-2 is NOT safe (black foundation still empty) → stays in the column.
        expect(e.state.tableau[0].map((c) => c.id)).toEqual(['black-2-0']);
    });

    it('ranks fly ascending, one cascade exposing the next', () => {
        const e = engineWith({
            tableau: [
                [num('red', 2, 0)], // red-2 exposed (red=1 → safe)
                [num('black', 3, 0)], // black-3 needs black=2 → only after red-2
            ],
            foundations: {
                red: foundation([1], 'red'),
                black: foundation([1, 2], 'black'),
                green: foundation([1, 2], 'green'),
            },
            freeCells: [null],
        });

        const actions = moveAndDrain(e, [num('red', 2, 0)], { type: 'freecell', index: 0 });

        expect(ids(actions)).toEqual(['red-2-0', 'black-3-0']);
        expect(e.state.foundations.red.map((c) => c.rank)).toEqual([1, 2]);
        expect(e.state.foundations.black.map((c) => c.rank)).toEqual([1, 2, 3]);
    });

    it('across columns: same-rank cards fly in column order, NOT colour-grouped', () => {
        // Both black-4 (col A) and red-4 (col B) are simultaneously safe
        // (both need their colour at 3 and the others at ≥3). The engine
        // exposes them in column order → black first. The old animation diff
        // grouped by colour (reds before blacks) and would have flown red-4
        // first — this test pins the engine order.
        const e = engineWith({
            tableau: [
                [num('black', 4, 0)],
                [num('red', 4, 0)],
                [num('black', 9, 0)], // user-step card (not safe: black=3)
            ],
            foundations: {
                red: foundation([1, 2, 3], 'red'),
                black: foundation([1, 2, 3], 'black'),
                green: foundation([1, 2, 3], 'green'),
            },
            freeCells: [null],
        });

        // User step parks black-9 in the free cell — it stays out of the
        // cascade, so both 4s remain exposed in their original columns.
        const actions = moveAndDrain(e, [num('black', 9, 0)], { type: 'freecell', index: 0 });

        expect(ids(actions)).toEqual(['black-4-0', 'red-4-0']);
        expect(e.state.foundations.black.map((c) => c.rank)).toEqual([1, 2, 3, 4]);
        expect(e.state.foundations.red.map((c) => c.rank)).toEqual([1, 2, 3, 4]);
    });

    it('converges a same-column cascade, stopping at the first unsafe card', () => {
        // Column bottom→top: black-6, red-5, black-4 (top). black-4 is safe
        // (black=3, others ≥3); flying it exposes red-5 (red=4, others ≥4,
        // safe); flying that exposes black-6 which needs black=5 → stays.
        const e = engineWith({
            tableau: [[num('black', 6, 0), num('red', 5, 0), num('black', 4, 0)]],
            foundations: {
                red: foundation([1, 2, 3, 4], 'red'),
                black: foundation([1, 2, 3], 'black'),
                green: foundation([1, 2, 3, 4], 'green'),
            },
            freeCells: [null],
        });

        const actions = moveAndDrain(e, [num('black', 4, 0)], { type: 'freecell', index: 0 });

        expect(ids(actions)).toEqual(['black-4-0', 'red-5-0']);
        expect(e.state.tableau[0].map((c) => c.id)).toEqual(['black-6-0']);
        expect(e.state.foundations.black.map((c) => c.rank)).toEqual([1, 2, 3, 4]);
        expect(e.state.foundations.red.map((c) => c.rank)).toEqual([1, 2, 3, 4, 5]);
    });

    it('stepUnit returns null outside a unit and after endUnit; abortUnit pops the snapshot', () => {
        const e = engineWith({
            tableau: [[num('red', 1, 0)]],
            freeCells: [null],
        });
        expect(e.stepUnit()).toBeNull(); // no unit → no steps

        e.beginUnit('move');
        expect(e.move([num('red', 1, 0)], { type: 'freecell', index: 0 }).ok).toBe(true);
        expect(drain(e)).toHaveLength(1);

        // endUnit closes the unit — further steps are refused.
        e.endUnit();
        expect(e.stepUnit()).toBeNull();

        // An aborted unit (failed move) leaves no undo step behind.
        const before = e.state.history.length;
        e.beginUnit('move');
        expect(e.move([num('red', 1, 0)], { type: 'freecell', index: 1 }).ok).toBe(false);
        e.abortUnit();
        expect(e.state.history).toHaveLength(before);
    });

    it('a win via the last auto-move fires onWin once at endUnit', () => {
        const red = foundation([1, 2, 3, 4, 5, 6, 7, 8, 9], 'red');
        const black = foundation([1, 2, 3, 4, 5, 6, 7, 8, 9], 'black');
        const green = foundation([1, 2, 3, 4, 5, 6, 7, 8], 'green');
        const green9 = num('green', 9, 0);
        const red5 = num('red', 5, 0);
        const e = engineWith({
            tableau: [[green9], [red5]],
            foundations: { red, black, green },
            flowerSlot: flower(),
            freeCells: [null, null],
        });
        let winCount = 0;
        // `as Card | null`: without the assertion TS narrows the variable to
        // the literal `null` initializer at reads after the callback
        // assignment (closure CFG), making `lastCard?.id` resolve to `never`.
        let lastCard: Card | null = null as Card | null;
        e.onWin = (c) => {
            winCount += 1;
            lastCard = c;
        };

        // A user move triggers the cascade: green-9 is safe (green=8, others
        // ≥8) and its auto-move completes the board → win at endUnit.
        e.beginUnit('move');
        expect(e.move([red5], { type: 'freecell', index: 0 }).ok).toBe(true);
        expect(ids(drain(e))).toEqual(['green-9-0']);
        expect(e.state.foundations.green).toHaveLength(RANK_MAX);
        expect(winCount).toBe(0); // not yet — the unit hasn't settled
        e.endUnit();
        expect(winCount).toBe(1);
        // The last collected card (the auto-move that completed the board)
        // travels with the win — the UI hashes it into the celebration gif.
        expect(lastCard?.id).toBe('green-9-0');

        // Guarded: another move does not re-award.
        e.beginUnit('move');
        e.move([red5], { type: 'freecell', index: 1 });
        e.endUnit();
        expect(winCount).toBe(1);
    });

    it('a dragon collect unit: free cells first (vacate the target slot), column tops last, then the cascade', () => {
        const e = engineWith({
            tableau: [
                [dragon('red', 0)],
                [num('black', 8, 0), dragon('red', 1)], // longer column — flies AFTER the free cell
                [dragon('red', 2)],
                [num('red', 1, 0)], // safe red-1 exposed after the collect
            ],
            freeCells: [dragon('red', 3), null],
            foundations: { red: [], black: [], green: [] },
        });

        expect(e.collectDragons('red')).toBe(true); // validates + begins the unit
        const actions = drain(e);
        e.endUnit();

        // 4 dragon steps: free cell FIRST (vacates a slot for the fresh
        // pile), then columns 0→2 in engine column order.
        expect(ids(actions)).toEqual([
            'dragon-red-3',
            'dragon-red-0',
            'dragon-red-1',
            'dragon-red-2',
            'red-1-0',
        ]);
        // Every dragon step targets the SAME locked pile (the fresh pile
        // lands in the slot the first free-cell dragon just vacated — index
        // 0 here).
        for (const a of actions.slice(0, 4)) {
            expect(a.to).toEqual({ type: 'dragonpile', index: 0 });
        }
        const pile = e.state.freeCells.find(
            (c) => c !== null && c.type === 'dragonpile',
        );
        expect(pile).toBeDefined();
        expect(pile!.cards.map((c) => c.id)).toEqual([
            'dragon-red-3',
            'dragon-red-0',
            'dragon-red-1',
            'dragon-red-2',
        ]);
        expect(e.state.foundations.red.map((c) => c.rank)).toEqual([1]);
    });

    it('collects a column-top dragon when ALL free cells hold same-colour dragons (no empty slot)', () => {
        // Regression: the column-top dragon must NOT vanish into a ghost
        // freeCells[-1] — free-cell dragons are collected first, vacating a
        // slot for the fresh pile. Every dragon step must animate.
        const e = engineWith({
            tableau: [[num('red', 9, 0), dragon('red', 3)]],
            freeCells: [dragon('red', 0), dragon('red', 1), dragon('red', 2)],
            foundations: { red: [], black: [], green: [] },
        });
        expect(e.collectDragons('red')).toBe(true);
        const actions = drain(e);
        e.endUnit();
        expect(ids(actions)).toEqual([
            'dragon-red-0',
            'dragon-red-1',
            'dragon-red-2',
            'dragon-red-3',
        ]);
        // Every step lands in a REAL slot index (0..2) — never a ghost -1.
        for (const a of actions) {
            expect(a.to.type).toBe('dragonpile');
            expect((a.to as { index: number }).index).toBeGreaterThanOrEqual(0);
        }
        const pile = e.state.freeCells.find(
            (c) => c !== null && c.type === 'dragonpile',
        );
        expect(pile).toBeDefined();
        expect(pile!.cards.map((c) => c.id)).toEqual([
            'dragon-red-0',
            'dragon-red-1',
            'dragon-red-2',
            'dragon-red-3',
        ]);
        // The column-top dragon's original column keeps its number card.
        expect(e.state.tableau[0].map((c) => c.id)).toEqual(['red-9-0']);
    });

    it('a dragon collect unit is rejected when the dragons are not all exposed', () => {
        const e = engineWith({
            tableau: [
                [dragon('red', 0), num('black', 5, 0)], // red-0 buried — not exposed
                [dragon('red', 1)],
                [dragon('red', 2)],
                [dragon('red', 3)],
            ],
            freeCells: [null, null],
            foundations: { red: [], black: [], green: [] },
        });

        expect(e.collectDragons('red')).toBe(false);
        expect(e.state.history).toHaveLength(0); // no snapshot, nothing moved
        expect(e.stepUnit()).toBeNull();
    });
});
