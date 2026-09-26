/** Local simultaneous round coordination (mirrors node-backend applySimultaneousMove). */

export const ELIM_TOKEN = "\u0091";

export const STORAGE = {
    mode: "playgroundSimMode",
    seat: "playgroundSeat",
    partialMove: "playgroundPartialMove",
    toMove: "playgroundToMove",
    stripHidden: "playgroundStripHidden",
    /** Omniscient snapshot when `state` is stored stripped for one seat. */
    stateFull: "playgroundStateFull",
    interimPerspective: "playgroundInterimPerspective",
};

export function isSeatMode() {
    return window.localStorage.getItem(STORAGE.mode) === "seat";
}

export function isGodMode() {
    return !isSeatMode();
}

export function getStoredSeat(numPlayers) {
    const raw = window.localStorage.getItem(STORAGE.seat);
    const n = raw ? parseInt(raw, 10) : 1;
    if (!Number.isFinite(n) || n < 1) {
        return 1;
    }
    return Math.min(n, numPlayers || n);
}

export function setStoredSeat(seat) {
    window.localStorage.setItem(STORAGE.seat, String(seat));
}

export function shouldStripHiddenOnSave() {
    return window.localStorage.getItem(STORAGE.stripHidden) === "true";
}

export function splitPartialRow(partialMove, numPlayers) {
    if (partialMove === undefined || partialMove === null || partialMove === "") {
        return Array(numPlayers).fill("");
    }
    const moves = partialMove.split(",");
    while (moves.length < numPlayers) {
        moves.push("");
    }
    return moves.slice(0, numPlayers);
}

export function joinPartialRow(moves) {
    return moves.join(",");
}

export function buildMaskedPartialMove(seat, fragment, numPlayers) {
    return Array.from({ length: numPlayers }, (_, i) =>
        i === seat - 1 ? fragment : "",
    ).join(",");
}

/** Mask other seats' fragments for Seat-mode display (own seat only). */
export function maskPartialMoveForSeat(partialMove, seat, numPlayers) {
    const moves = splitPartialRow(partialMove, numPlayers);
    return moves
        .map((m, i) => (i === seat - 1 ? m : m === "" ? "" : "•••"))
        .join(",");
}

export function loadPartialMove() {
    const v = window.localStorage.getItem(STORAGE.partialMove);
    return v === null ? undefined : v;
}

export function savePartialMove(partialMove) {
    if (partialMove === undefined) {
        window.localStorage.removeItem(STORAGE.partialMove);
    } else {
        window.localStorage.setItem(STORAGE.partialMove, partialMove);
    }
}

export function loadToMove(game) {
    const raw = window.localStorage.getItem(STORAGE.toMove);
    if (!raw) {
        return initialToMove(game, game.numplayers);
    }
    try {
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr) || arr.length !== game.numplayers) {
            return initialToMove(game, game.numplayers);
        }
        return arr;
    } catch {
        return initialToMove(game, game.numplayers);
    }
}

export function saveToMove(toMove) {
    window.localStorage.setItem(STORAGE.toMove, JSON.stringify(toMove));
}

export function isSeatEliminated(engine, seat) {
    return (
        typeof engine?.isEliminated === "function" && engine.isEliminated(seat)
    );
}

export function initialToMove(engine, numPlayers) {
    const arr = [];
    for (let i = 1; i <= numPlayers; i++) {
        if (isSeatEliminated(engine, i)) {
            arr.push(false);
        } else {
            arr.push(true);
        }
    }
    return arr;
}

/** Keep `toMove` false for eliminated seats (e.g. after elimination mid-session). */
export function syncToMoveElimination(engine) {
    const toMove = loadToMove(engine);
    let changed = false;
    for (let i = 0; i < engine.numplayers; i++) {
        if (isSeatEliminated(engine, i + 1) && toMove[i]) {
            toMove[i] = false;
            changed = true;
        }
    }
    if (changed) {
        saveToMove(toMove);
    }
}

export function clearRoundBuffer() {
    window.localStorage.removeItem(STORAGE.partialMove);
    window.localStorage.removeItem(STORAGE.toMove);
}

export function ensureRoundBuffer(game) {
    if (!isSeatMode()) {
        return;
    }
    if (window.localStorage.getItem(STORAGE.toMove) === null) {
        saveToMove(initialToMove(game, game.numplayers));
    }
    syncToMoveElimination(game);
}

export function resetRoundBufferForNewPosition(game) {
    clearRoundBuffer();
    if (isSeatMode()) {
        saveToMove(initialToMove(game, game.numplayers));
    }
}

/**
 * Apply one seat's move. Mutates `engine` (disposable instance from committed state).
 * @param {object} params
 * @param {import("@abstractplay/gameslib").GameBase} params.engine
 * @param {number} params.numPlayers
 * @param {number} params.seatIndex 0-based
 * @param {string} params.move
 * @param {string|undefined} params.partialMove
 * @param {boolean[]} params.toMove
 */
export function applySeatSubmit({
    engine,
    numPlayers,
    seatIndex,
    move,
    partialMove,
    toMove,
}) {
    const moves = splitPartialRow(partialMove, numPlayers);
    const toMoveArr = [...toMove];
    const seat = seatIndex + 1;

    if (isSeatEliminated(engine, seat)) {
        throw new Error("This seat is eliminated and cannot submit a move.");
    }

    if (!toMoveArr[seatIndex]) {
        throw new Error("You have already submitted your move for this turn!");
    }

    moves[seatIndex] = move;
    toMoveArr[seatIndex] = false;

    for (let i = 0; i < numPlayers; i++) {
        if (isSeatEliminated(engine, i + 1)) {
            moves[i] = ELIM_TOKEN;
        }
    }

    let cnt = 0;
    for (let i = 0; i < numPlayers; i++) {
        if (moves[i] !== "") {
            cnt++;
        }
    }

    const combined = joinPartialRow(moves);

    if (cnt < numPlayers) {
        engine.move(combined, { partial: true });
        return {
            committed: false,
            partialMove: combined,
            toMove: toMoveArr,
        };
    }

    engine.move(combined);
    return {
        committed: true,
        partialMove: joinPartialRow(Array(numPlayers).fill("")),
        toMove: initialToMove(engine, numPlayers),
        serialized: engine.serialize(),
    };
}

export function clearActiveSeatSlot(game) {
    const numPlayers = game.numplayers;
    const seatIndex = getStoredSeat(numPlayers) - 1;
    const seat = seatIndex + 1;
    if (isSeatEliminated(game, seat)) {
        return;
    }
    const moves = splitPartialRow(loadPartialMove(), numPlayers);
    const toMove = loadToMove(game);
    moves[seatIndex] = "";
    toMove[seatIndex] = true;
    savePartialMove(joinPartialRow(moves));
    saveToMove(toMove);
}

export function serializeAfterCommit(engine, seat, strip) {
    if (strip && typeof engine.serialize === "function") {
        try {
            return engine.serialize({ strip: true, player: seat });
        } catch {
            return engine.serialize();
        }
    }
    return engine.serialize();
}

export function formatRoundStatus(game, gamename, getPlayerNamesForStatus) {
    if (!isSeatMode()) {
        return "";
    }
    const seat = getStoredSeat(game.numplayers);
    const toMove = loadToMove(game);
    const names = getPlayerNamesForStatus(game, gamename);
    if (isSeatEliminated(game, seat)) {
        return `Seat ${seat} (${names[seat - 1] || `Player ${seat}`}) is eliminated.`;
    }
    const waiting = [];
    for (let i = 0; i < game.numplayers; i++) {
        if (toMove[i]) {
            waiting.push(names[i] || `Player ${i + 1}`);
        }
    }
    if (toMove[seat - 1]) {
        return `Your turn to submit (acting as seat ${seat}).`;
    }
    if (waiting.length === 0) {
        return "Round complete — committed state will update on next full round.";
    }
    return `Submitted as seat ${seat}. Waiting: ${waiting.join(", ")}`;
}
