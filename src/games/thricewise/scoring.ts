import { Card } from "../../common/decktet/index.js";
import { getSharedSuits } from "../quincunx.js";
import { QuincunxBoard } from "../quincunx/board.js";
import { QuincunxCard } from "../quincunx/card.js";
import { oppositeDirections } from "../../common/index.js";

const getNextRank = (curr: number, dir: "A"|"D"): number|null => {
    if (curr === 0) {
        return null;
    }
    if (curr === 1 && dir === "D") {
        return null;
    }
    if (curr === 10 && dir === "A") {
        return null;
    }
    if (curr <= 8 || (curr === 9 && dir === "D")) {
        return dir === "A" ? curr + 1 : curr - 1;
    }
    if (dir === "A") {
        return 10;
    }
    return 9;
};

/** Lowest number rank (2–9) among three cards; 0 if none. */
export function threesomeValue(uids: string[]): number {
    let min = Infinity;
    for (const uid of uids) {
        const c = Card.deserialize(uid)!;
        if (c.rank.seq >= 2 && c.rank.seq <= 9) {
            min = Math.min(min, c.rank.seq);
        }
    }
    return min === Infinity ? 0 : min;
}

function isSet(uids: string[]): boolean {
    const ranks = uids.map(u => Card.deserialize(u)!.rank.uid);
    return ranks[0] === ranks[1] && ranks[1] === ranks[2];
}

function isStraight(uids: string[]): boolean {
    const seqs = uids.map(u => Card.deserialize(u)!.rank.seq).sort((a, b) => a - b);
    const [a, b, c] = seqs;
    if (a === b || b === c) {
        return false;
    }
    return (
        (getNextRank(a, "A") === b && getNextRank(b, "A") === c) ||
        (getNextRank(c, "D") === b && getNextRank(b, "D") === a)
    );
}

function lineThroughCard(
    board: QuincunxBoard,
    placed: QuincunxCard,
    dir: "N"|"NE"|"E"|"SE",
): QuincunxCard[] {
    const gOcc = board.graphOcc;
    const rel = board.abs2rel(placed.x, placed.y);
    if (rel === undefined) {
        return [placed];
    }
    const node = gOcc.coords2algebraic(...rel);
    const rayPrime = gOcc.ray(node, dir).map(n => {
        const [ax, ay] = board.rel2abs(...gOcc.algebraic2coords(n));
        return board.getCardAt(ax, ay)!;
    });
    const oppDir = oppositeDirections.get(dir)!;
    const rayOpp = gOcc.ray(node, oppDir).map(n => {
        const [ax, ay] = board.rel2abs(...gOcc.algebraic2coords(n));
        return board.getCardAt(ax, ay)!;
    });
    return [...rayOpp.reverse(), placed, ...rayPrime];
}

/** Points scored by placing `placed` on `board` (board already contains the card). */
export function scorePlacement(board: QuincunxBoard, placed: QuincunxCard): number {
    let total = 0;
    const counted = new Set<string>();

    for (const dir of ["N", "NE", "E", "SE"] as const) {
        const line = lineThroughCard(board, placed, dir);
        const uids = line.map(c => c.card.uid);
        for (let i = 0; i <= uids.length - 3; i++) {
            const triple = uids.slice(i, i + 3);
            if (!triple.includes(placed.card.uid)) {
                continue;
            }
            const key = [...triple].sort().join("|");
            const value = threesomeValue(triple);
            if (value === 0 && !isSet(triple)) {
                continue;
            }
            if (isSet(triple)) {
                const k = `set:${key}`;
                if (!counted.has(k)) {
                    counted.add(k);
                    total += value;
                }
            }
            if (isStraight(triple)) {
                const k = `str:${key}`;
                if (!counted.has(k)) {
                    counted.add(k);
                    total += value;
                }
            }
            const suits = getSharedSuits(triple);
            for (const suit of suits) {
                const k = `flush:${suit}:${key}`;
                if (!counted.has(k)) {
                    counted.add(k);
                    total += value;
                }
            }
        }
    }
    return total;
}
