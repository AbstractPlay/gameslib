import type { ICubeoState } from "../../../src/games/cubeo.js";

/** Greedy playout midgame (d10MidgameState); used as extended regression gate. */
export const d10MidgameState: ICubeoState = {
    "game": "cubeo",
    "numplayers": 2,
    "variants": [
        "d10"
    ],
    "gameover": false,
    "winner": [],
    "stack": [
        {
            "_version": "20250105",
            "_results": [
                {
                    "type": "move",
                    "from": "2,-1",
                    "to": "3,-1",
                    "what": "1"
                }
            ],
            "_timestamp": "2026-11-02T18:00:54.390Z",
            "currplayer": 1,
            "lastmove": "1,2,-1->3,-1",
            "board": {
                "_dice": [
                    {
                        "_x": 0,
                        "_y": 0,
                        "_pips": 1,
                        "_owner": 1
                    },
                    {
                        "_x": 1,
                        "_y": 0,
                        "_pips": 1,
                        "_owner": 2
                    },
                    {
                        "_x": 0,
                        "_y": -1,
                        "_pips": 1,
                        "_owner": 1
                    },
                    {
                        "_x": 2,
                        "_y": 0,
                        "_pips": 1,
                        "_owner": 2
                    },
                    {
                        "_x": -1,
                        "_y": 0,
                        "_pips": 1,
                        "_owner": 1
                    },
                    {
                        "_x": -1,
                        "_y": 1,
                        "_pips": 1,
                        "_owner": 1
                    },
                    {
                        "_x": -1,
                        "_y": 2,
                        "_pips": 1,
                        "_owner": 1
                    },
                    {
                        "_x": 1,
                        "_y": 2,
                        "_pips": 1,
                        "_owner": 2
                    },
                    {
                        "_x": 1,
                        "_y": 3,
                        "_pips": 1,
                        "_owner": 2
                    },
                    {
                        "_x": -1,
                        "_y": 5,
                        "_pips": 1,
                        "_owner": 1
                    },
                    {
                        "_x": 1,
                        "_y": 4,
                        "_pips": 1,
                        "_owner": 2
                    },
                    {
                        "_x": 1,
                        "_y": 5,
                        "_pips": 1,
                        "_owner": 2
                    },
                    {
                        "_x": 0,
                        "_y": 6,
                        "_pips": 1,
                        "_owner": 1
                    },
                    {
                        "_x": 0,
                        "_y": 2,
                        "_pips": 1,
                        "_owner": 2
                    },
                    {
                        "_x": -2,
                        "_y": 5,
                        "_pips": 1,
                        "_owner": 1
                    },
                    {
                        "_x": 3,
                        "_y": 0,
                        "_pips": 1,
                        "_owner": 2
                    },
                    {
                        "_x": 0,
                        "_y": 5,
                        "_pips": 1,
                        "_owner": 1
                    },
                    {
                        "_x": 2,
                        "_y": 5,
                        "_pips": 1,
                        "_owner": 2
                    },
                    {
                        "_x": 0,
                        "_y": 7,
                        "_pips": 1,
                        "_owner": 1
                    },
                    {
                        "_x": 3,
                        "_y": -1,
                        "_pips": 1,
                        "_owner": 2
                    }
                ]
            }
        }
    ]
} as ICubeoState;
