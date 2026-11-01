import type { ACityColor, ACityMarkerPos, ACityPiece, IACityState, IMoveState, playerid } from "../../src/games/acity";
import { ACityGame } from "../../src/games/acity";

/** Default opening stashes (same as {@link ACityGame} constructor). */
export const ACITY_DEFAULT_STASHES: [ACityPiece[], ACityPiece[]] = [
    ["RD", "RD", "RD", "BD", "BD", "BD", "GD", "GD", "GD", "ND", "ND", "ND", "RT", "RT", "RT", "BT", "BT", "GT", "GT"],
    ["RD", "RD", "RD", "BD", "BD", "BD", "GD", "GD", "GD", "ND", "ND", "ND", "RT", "RT", "BT", "BT", "BT", "GT", "GT"],
];

export const ACITY_ALL_PIECES: ACityPiece[] = ["RD", "RT", "BD", "BT", "GD", "GT", "ND"];

function uniformStart(colour: ACityColor = "N", pos: ACityMarkerPos = 0): [ACityColor, ACityMarkerPos][] {
    return Array.from({ length: 20 }, () => [colour, pos] as [ACityColor, ACityMarkerPos]);
}

function startByTile(colours: ACityColor[]): [ACityColor, ACityMarkerPos][] {
    return colours.map((c) => [c, 0] as [ACityColor, ACityMarkerPos]);
}

export interface ACityGoldenFixtureSpec {
    id: string;
    currplayer: playerid;
    startpos: [ACityColor, ACityMarkerPos][];
    board: [string, ACityPiece][];
    stashes: [ACityPiece[], ACityPiece[]];
    claimed: [string[], string[]];
    /** Extra {@link ACityGame.validateMove} inputs beyond the placement grid. */
    extraValidations?: string[];
    /** Pairs passed to {@link ACityGame.goldenRealDistance}. */
    distancePairs?: [string, string][];
}

export const ACITY_GOLDEN_FIXTURES: ACityGoldenFixtureSpec[] = [
    {
        id: "fresh-open",
        currplayer: 1,
        startpos: uniformStart("N", 0),
        board: [],
        stashes: [ACITY_DEFAULT_STASHES[0].slice(), ACITY_DEFAULT_STASHES[1].slice()],
        claimed: [[], []],
    },
    {
        id: "road-pinch-open",
        currplayer: 1,
        startpos: uniformStart("N", 0),
        board: [10, 9, 8, 7, 6, 4, 3, 2, 1].map((row) => [`d${row}`, "ND"] as [string, ACityPiece]),
        stashes: [ACITY_DEFAULT_STASHES[0].slice(), ACITY_DEFAULT_STASHES[1].slice()],
        claimed: [[], []],
        extraValidations: ["ND-d5"],
    },
    {
        id: "isolation-corner",
        currplayer: 1,
        startpos: uniformStart("N", 0),
        board: [
            ["a10", "ND"],
            ["b10", "ND"],
        ],
        stashes: [ACITY_DEFAULT_STASHES[0].slice(), ACITY_DEFAULT_STASHES[1].slice()],
        claimed: [[], []],
        extraValidations: ["ND-a9"],
    },
    {
        id: "dome-off-colour-blocked",
        currplayer: 1,
        startpos: startByTile(["B", ...Array<ACityColor>(19).fill("N")]),
        board: [],
        stashes: [ACITY_DEFAULT_STASHES[0].slice(), ACITY_DEFAULT_STASHES[1].slice()],
        claimed: [[], []],
        extraValidations: ["BD-c7", "BD-b9"],
    },
    {
        id: "dome-off-colour-allowed",
        currplayer: 1,
        startpos: uniformStart("N", 0),
        board: [],
        stashes: [ACITY_DEFAULT_STASHES[0].slice(), ACITY_DEFAULT_STASHES[1].slice()],
        claimed: [[], []],
        extraValidations: ["BD-c7"],
    },
    {
        id: "tower-first-two",
        currplayer: 1,
        startpos: startByTile(["R", ...Array<ACityColor>(19).fill("N")]),
        board: [],
        stashes: [ACITY_DEFAULT_STASHES[0].slice(), ACITY_DEFAULT_STASHES[1].slice()],
        claimed: [[], []],
        extraValidations: ["BT-b9", "RT-b9"],
    },
    {
        id: "tower-third-structure",
        currplayer: 1,
        startpos: startByTile(["R", ...Array<ACityColor>(19).fill("N")]),
        board: [
            ["a10", "RD"],
            ["b10", "RD"],
        ],
        stashes: [ACITY_DEFAULT_STASHES[0].slice(), ACITY_DEFAULT_STASHES[1].slice()],
        claimed: [[], []],
        extraValidations: ["BT-b9"],
    },
    {
        id: "marker-blocked",
        currplayer: 1,
        startpos: uniformStart("N", 0),
        board: [],
        stashes: [ACITY_DEFAULT_STASHES[0].slice(), ACITY_DEFAULT_STASHES[1].slice()],
        claimed: [[], []],
        extraValidations: ["ND-c10"],
    },
    {
        id: "marker-allowed",
        currplayer: 1,
        startpos: uniformStart("N", 0),
        board: [
            ["d10", "ND"],
            ["c9", "ND"],
            ["d9", "ND"],
        ],
        stashes: [ACITY_DEFAULT_STASHES[0].slice(), ACITY_DEFAULT_STASHES[1].slice()],
        claimed: [[], []],
        extraValidations: ["ND-c10"],
    },
    {
        id: "midgame-claims",
        currplayer: 1,
        startpos: uniformStart("N", 0),
        board: [
            ["b9", "RT"],
            ["c9", "BT"],
            ["d9", "GT"],
            ["e9", "ND"],
        ],
        stashes: [
            ["ND", "ND", "RD", "RT", "BT"],
            ["ND", "GD", "GT", "RT", "BT", "BT"],
        ],
        claimed: [["b9"], ["c9"]],
        extraValidations: ["RT-a8(c9)", "RT-a8(b9)", "ND-f1"],
    },
    {
        id: "claim-ends-construction",
        currplayer: 1,
        startpos: uniformStart("N", 0),
        board: [["b9", "BT"]],
        stashes: [["RT"], []],
        claimed: [[], []],
        extraValidations: ["RT-e5", "RT-e5(b9)"],
    },
    {
        id: "scoring-customers",
        currplayer: 1,
        startpos: uniformStart("N", 0),
        board: [
            ["a10", "RT"],
            ["a8", "RT"],
            ["c10", "ND"],
        ],
        stashes: [ACITY_DEFAULT_STASHES[0].slice(), ACITY_DEFAULT_STASHES[1].slice()],
        claimed: [["a10"], []],
        distancePairs: [
            ["a10", "a8"],
            ["a10", "c10"],
            ["a8", "c10"],
        ],
    },
];

export function gameFromGoldenFixture(spec: ACityGoldenFixtureSpec): ACityGame {
    const moveState: IMoveState = {
        _version: ACityGame.gameinfo.version,
        _results: [],
        _timestamp: new Date(0),
        currplayer: spec.currplayer,
        board: new Map(spec.board),
        stashes: [spec.stashes[0].slice(), spec.stashes[1].slice()],
        claimed: [spec.claimed[0].slice(), spec.claimed[1].slice()],
    };
    const state: IACityState = {
        game: ACityGame.gameinfo.uid,
        numplayers: 2,
        variants: [],
        gameover: false,
        winner: [],
        stack: [moveState],
        startpos: spec.startpos.map((t) => [t[0], t[1]] as [ACityColor, ACityMarkerPos]),
    };
    return new ACityGame(state);
}
