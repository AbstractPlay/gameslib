/**
 * Display-round helpers for sequenced move tables (gameplay UI only).
 * Export records stay on sparse engine.getRounds(); these densify seat cycles
 * when each actor appears at most once per ply.round.
 */

/** @typedef {"sparse" | "auto"} MoveTableDensity */

export const MOVE_TREE_DENSITY_STORAGE_KEY = "moveTreeDensity";

/**
 * @returns {MoveTableDensity}
 */
export function readMoveTableDensityPreference() {
  if (typeof globalThis.localStorage === "undefined") {
    return "auto";
  }
  return globalThis.localStorage.getItem(MOVE_TREE_DENSITY_STORAGE_KEY) === "sparse"
    ? "sparse"
    : "auto";
}

/**
 * @param {"sequential" | "simultaneous" | "sequenced" | "skip-turn"} model
 * @param {boolean} useRoundGrid
 * @returns {MoveTableDensity}
 */
export function resolveMoveTableDensity(model, useRoundGrid) {
  if (model !== "sequenced" || !useRoundGrid) {
    return "sparse";
  }
  return readMoveTableDensityPreference();
}

/**
 * @param {{ actor: number, move: string, playOrder?: number, results?: unknown[] }} ply
 * @returns {string | { move: string, sequence?: number, result?: unknown[] }}
 */
export function plyToRoundSlot(ply) {
  const results = ply.results ?? [];
  if (ply.playOrder !== undefined && ply.playOrder !== ply.actor) {
    if (results.length > 0) {
      return { move: ply.move, sequence: ply.playOrder, result: [...results] };
    }
    return { move: ply.move, sequence: ply.playOrder };
  }
  if (results.length > 0) {
    return { move: ply.move, result: [...results] };
  }
  return ply.move;
}

/**
 * @param {{ actor: number, move: string, playOrder?: number, results?: unknown[] }} ply
 * @param {number} numPlayers
 */
export function buildSparseRowFromPly(ply, numPlayers) {
  const row = new Array(numPlayers).fill(null);
  row[ply.actor - 1] = plyToRoundSlot(ply);
  return row;
}

/**
 * @param {{ actor: number, move: string, playOrder?: number, results?: unknown[] }[]} plies
 * @param {number} numPlayers
 */
export function buildDenseRowFromPlies(plies, numPlayers) {
  const row = new Array(numPlayers).fill(null);
  for (const ply of plies) {
    row[ply.actor - 1] = plyToRoundSlot(ply);
  }
  return row;
}

/**
 * @param {{ actor: number }[]} plies
 */
export function roundGroupHasDuplicateActor(plies) {
  const seen = new Set();
  for (const ply of plies) {
    if (seen.has(ply.actor)) {
      return true;
    }
    seen.add(ply.actor);
  }
  return false;
}

/**
 * @param {{ getPlies?: () => { actor: number, move: string, round: number, playOrder?: number, results?: unknown[] }[], numplayers?: number, numPlayers?: number }} engine
 * @returns {unknown[][]}
 */
export function buildDisplayRounds(engine) {
  if (typeof engine.getPlies !== "function") {
    throw new Error("buildDisplayRounds requires engine.getPlies()");
  }
  const plies = engine.getPlies();
  const numPlayers = engine.numplayers ?? engine.numPlayers;
  if (!numPlayers || numPlayers < 1) {
    throw new Error("buildDisplayRounds requires engine.numplayers");
  }

  /** @type {Map<number, typeof plies>} */
  const groups = new Map();
  for (const ply of plies) {
    const list = groups.get(ply.round);
    if (list) {
      list.push(ply);
    } else {
      groups.set(ply.round, [ply]);
    }
  }

  const roundIds = [...groups.keys()].sort((a, b) => a - b);
  /** @type {unknown[][]} */
  const displayRounds = [];

  for (const roundId of roundIds) {
    const group = groups.get(roundId);
    if (!group || group.length === 0) {
      continue;
    }
    if (roundGroupHasDuplicateActor(group)) {
      for (const ply of group) {
        displayRounds.push(buildSparseRowFromPly(ply, numPlayers));
      }
    } else {
      displayRounds.push(buildDenseRowFromPlies(group, numPlayers));
    }
  }

  return displayRounds;
}

/**
 * @param {{ getRounds?: () => unknown[][], getPlies?: () => unknown[] }} engine
 * @param {{ model?: string, useRoundGrid?: boolean, density?: MoveTableDensity }} layout
 * @returns {unknown[][] | undefined}
 */
export function getRoundsForLayout(engine, layout) {
  if (!layout.useRoundGrid) {
    return undefined;
  }
  if (
    layout.density === "auto" &&
    layout.model === "sequenced" &&
    typeof engine?.getPlies === "function"
  ) {
    try {
      return buildDisplayRounds(engine);
    } catch {
      return engine?.getRounds?.();
    }
  }
  return engine?.getRounds?.();
}
