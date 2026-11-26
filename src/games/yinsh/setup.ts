import type { IMoveState } from "./types.js";
import { MARKERS_PER_PLAYER, RINGS_PER_PLAYER } from "./types.js";

export function freshMoveState(version: string): IMoveState {
    return {
        _version: version,
        _results: [],
        _timestamp: new Date(),
        currplayer: 1,
        phase: "setup",
        rings: new Map(),
        markers: new Map(),
        ringsReserve: [RINGS_PER_PLAYER, RINGS_PER_PLAYER],
        markersInPool: MARKERS_PER_PLAYER,
        score: [0, 0],
    };
}