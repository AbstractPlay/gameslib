import {
    StorisendeGame,
    type IStorisendeState,
    type playerid,
    type Tile,
} from "../../../src/games/storisende.js";
import { StorisendeHex } from "../../../src/games/storisende/hex.js";

type CellPatch = { tile?: Tile; stack?: playerid[] };

export function storisendeFromState(state: IStorisendeState): StorisendeGame {
    return new StorisendeGame(state);
}

export function storisendeFrom(opts: {
    variants?: string[];
    currplayer?: playerid;
    lastmove?: string;
    stackDepth?: number;
    cells?: Record<string, CellPatch>;
}): StorisendeGame {
    const variants = opts.variants ?? [];
    const seed = new StorisendeGame(undefined, variants);
    const hexes = seed.board.serialize().map(hex => {
        const alg = seed.board.hex2algebraic(hex);
        const patch = opts.cells?.[alg];
        if (patch === undefined) {
            return hex;
        }
        return StorisendeHex.create({
            q: hex.q,
            r: hex.r,
            tile: patch.tile ?? hex.tile,
            stack: patch.stack ?? hex.stack,
        });
    });

    const depth = opts.stackDepth ?? 3;
    const version = "20250109";
    const stack = [];
    for (let i = 0; i < depth; i++) {
        const isLast = i === depth - 1;
        stack.push({
            _version: version,
            _results: [],
            _timestamp: new Date(),
            currplayer: isLast ? (opts.currplayer ?? 1) : (((i + 1) % 2) + 1) as playerid,
            board: hexes,
            lastmove: isLast ? opts.lastmove : (i > 0 ? "pass" : undefined),
        });
    }

    const state: IStorisendeState = {
        game: "storisende",
        numplayers: 2,
        variants,
        gameover: false,
        winner: [],
        stack,
    };
    return new StorisendeGame(state);
}
