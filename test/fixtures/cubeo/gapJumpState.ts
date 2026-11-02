import type { ICubeoState } from "../../../src/games/cubeo.js";

/** Final position from cubeo.test.ts "Bug: Gap Jumping" (currplayer 2, 10 dice on board). */
export const gapJumpState: ICubeoState = {
    game: "cubeo",
    numplayers: 2,
    variants: [],
    gameover: false,
    winner: [],
    stack: [{
        _version: "20250105",
        _results: [],
        _timestamp: "2025-02-18T03:59:52.366Z",
        currplayer: 2,
        lastmove: "+-1,1",
        board: {
            _dice: [
                { _x: 0, _y: 0, _pips: 1, _owner: 1 },
                { _x: 1, _y: 0, _pips: 1, _owner: 2 },
                { _x: 1, _y: 1, _pips: 1, _owner: 2 },
                { _x: 1, _y: 2, _pips: 5, _owner: 1 },
                { _x: 0, _y: 2, _pips: 2, _owner: 2 },
                { _x: 1, _y: 3, _pips: 1, _owner: 2 },
                { _x: 2, _y: 1, _pips: 1, _owner: 2 },
                { _x: -1, _y: 0, _pips: 1, _owner: 1 },
                { _x: -1, _y: -1, _pips: 1, _owner: 2 },
                { _x: -1, _y: 1, _pips: 1, _owner: 1 },
            ],
        },
    }],
};
