import type { Seat, Size, Star } from "../homeworlds.js";

export type TraditionalRow = 0 | 1 | 2;

export type BinarySizeToRow = Record<Size, TraditionalRow>;

export type BinaryPairingKind = "large" | "small" | "micro" | "asymmetric";

const ALL_SIZES: Size[] = [1, 2, 3];

export interface HomeworldsStackSnapshot {
    systems: {
        owner?: Seat;
        stars: Star[];
    }[];
}

export function distinctStarSizes(stars: Star[]): Size[] {
    const seen = new Set<Size>();
    const out: Size[] = [];
    for (const s of stars) {
        if (!seen.has(s[1])) {
            seen.add(s[1]);
            out.push(s[1]);
        }
    }
    return out;
}

function sizeSet(stars: Star[]): Set<Size> {
    return new Set(stars.map((s) => s[1]));
}

function isTwoDistinctStarHome(stars: Star[]): boolean {
    return stars.length === 2 && stars[0][1] !== stars[1][1];
}

export function classifyBinaryPairing(nStars: Star[], sStars: Star[]): BinaryPairingKind {
    const n = sizeSet(nStars);
    const s = sizeSet(sStars);
    const overlap = ALL_SIZES.filter((z) => n.has(z) && s.has(z)).length;

    const nTwoDistinct = isTwoDistinctStarHome(nStars);
    const sTwoDistinct = isTwoDistinctStarHome(sStars);
    if (nTwoDistinct && sTwoDistinct) {
        if (overlap === 1) {
            return "large";
        }
        if (overlap === 2) {
            return "small";
        }
    }
    if (nTwoDistinct !== sTwoDistinct) {
        return "asymmetric";
    }
    if (overlap === 0) {
        return "micro";
    }
    return "asymmetric";
}

function absentSize(sizes: Set<Size>): Size | undefined {
    const missing = ALL_SIZES.filter((z) => !sizes.has(z));
    return missing.length === 1 ? missing[0] : undefined;
}

export function binarySizeToRowMap(
    kind: BinaryPairingKind,
    nStars: Star[],
    sStars: Star[],
): BinarySizeToRow | undefined {
    const n = sizeSet(nStars);
    const s = sizeSet(sStars);

    switch (kind) {
        case "large": {
            const northAbsent = absentSize(n);
            const southAbsent = absentSize(s);
            if (northAbsent === undefined || southAbsent === undefined) {
                return undefined;
            }
            let shared: Size | undefined;
            for (const z of ALL_SIZES) {
                if (n.has(z) && s.has(z)) {
                    shared = z;
                    break;
                }
            }
            if (shared === undefined) {
                return undefined;
            }
            const rowFor = (z: Size): TraditionalRow => {
                if (z === northAbsent) {
                    return 0;
                }
                if (z === southAbsent) {
                    return 2;
                }
                return 1;
            };
            return { 1: rowFor(1), 2: rowFor(2), 3: rowFor(3) };
        }
        case "small": {
            const link = ALL_SIZES.find((z) => !n.has(z) && !s.has(z));
            if (link === undefined) {
                return undefined;
            }
            const onHomes = ALL_SIZES.filter((z) => z !== link).sort((a, b) => a - b);
            return {
                [link]: 0,
                [onHomes[0]!]: 1,
                [onHomes[1]!]: 2,
            } as BinarySizeToRow;
        }
        case "micro": {
            const map: Partial<Record<Size, TraditionalRow>> = {};
            for (const z of ALL_SIZES) {
                const onN = n.has(z);
                const onS = s.has(z);
                if (onN && !onS) {
                    map[z] = 0;
                } else if (onS && !onN) {
                    map[z] = 2;
                } else if (!onN && !onS) {
                    map[z] = 1;
                } else {
                    return undefined;
                }
            }
            return map as BinarySizeToRow;
        }
        default:
            return undefined;
    }
}

/** One-star periphery: size 1 → row 0, size 2 → row 1, size 3 → row 2. */
export const DETERMINISTIC_ROWS_BY_SIZE: BinarySizeToRow = { 1: 0, 2: 1, 3: 2 };

function tryBuildAsymmetricTwoSizeHomeMap(nStars: Star[], sStars: Star[]): BinarySizeToRow | undefined {
    const nTwoDistinct = isTwoDistinctStarHome(nStars);
    const sTwoDistinct = isTwoDistinctStarHome(sStars);
    if (nTwoDistinct === sTwoDistinct) {
        return undefined;
    }
    const twoSizeHomeIsNorth = nTwoDistinct;
    const twoSet = twoSizeHomeIsNorth ? sizeSet(nStars) : sizeSet(sStars);
    const absent = absentSize(twoSet);
    if (absent === undefined) {
        return undefined;
    }
    const remaining = ALL_SIZES.filter((z) => z !== absent);
    const absentRow: TraditionalRow = twoSizeHomeIsNorth ? 0 : 2;
    const otherRows: [TraditionalRow, TraditionalRow] = twoSizeHomeIsNorth ? [1, 2] : [0, 1];
    return {
        [absent]: absentRow,
        [remaining[0]!]: otherRows[0],
        [remaining[1]!]: otherRows[1],
    } as BinarySizeToRow;
}

export function tryBuildBinarySizeToRow(nStars: Star[], sStars: Star[]): BinarySizeToRow | undefined {
    const kind = classifyBinaryPairing(nStars, sStars);
    if (kind === "asymmetric") {
        return tryBuildAsymmetricTwoSizeHomeMap(nStars, sStars);
    }
    return binarySizeToRowMap(kind, nStars, sStars);
}

function homesFromSetupStack(setup: HomeworldsStackSnapshot): { n: Star[]; s: Star[] } | undefined {
    const nHome = setup.systems.find((sys) => sys.owner === "N");
    const sHome = setup.systems.find((sys) => sys.owner === "S");
    if (nHome === undefined || sHome === undefined) {
        return undefined;
    }
    return { n: nHome.stars, s: sHome.stars };
}

export function binarySizeToRowFromStack(
    stack: HomeworldsStackSnapshot[],
    numplayers: number,
): BinarySizeToRow | undefined {
    if (numplayers !== 2 || stack.length <= 2) {
        return undefined;
    }
    const homes = homesFromSetupStack(stack[2]!);
    if (homes === undefined) {
        return undefined;
    }
    return tryBuildBinarySizeToRow(homes.n, homes.s);
}

function peripheralRowsForRender(
    systems: { name: string; owner?: Seat; stars: Star[] }[],
    sizeToRow: BinarySizeToRow,
    requireAllOneStar: boolean,
): Map<string, TraditionalRow> | undefined {
    const rows = new Map<string, TraditionalRow>();
    for (const sys of systems) {
        if (sys.owner !== undefined) {
            continue;
        }
        const sizes = distinctStarSizes(sys.stars);
        if (sizes.length !== 1) {
            if (requireAllOneStar) {
                return undefined;
            }
            continue;
        }
        rows.set(sys.name, sizeToRow[sizes[0]!]);
    }
    return rows;
}

export function deterministicRowsForRender(
    systems: { name: string; owner?: Seat; stars: Star[] }[],
): Map<string, TraditionalRow> {
    return peripheralRowsForRender(systems, DETERMINISTIC_ROWS_BY_SIZE, false) ?? new Map();
}

export function traditionalRowsForRender(
    systems: { name: string; owner?: Seat; stars: Star[] }[],
    stack: HomeworldsStackSnapshot[],
    numplayers: number,
): Map<string, TraditionalRow> | undefined {
    const sizeToRow = binarySizeToRowFromStack(stack, numplayers);
    if (sizeToRow === undefined) {
        return undefined;
    }
    return peripheralRowsForRender(systems, sizeToRow, true);
}

/** Traditional row map when valid; otherwise deterministic rows by star size (2-player render fallback). */
export function traditionalOrDeterministicRowsForRender(
    systems: { name: string; owner?: Seat; stars: Star[] }[],
    stack: HomeworldsStackSnapshot[],
    numplayers: number,
): Map<string, TraditionalRow> {
    const traditional = traditionalRowsForRender(systems, stack, numplayers);
    if (traditional !== undefined) {
        return traditional;
    }
    return deterministicRowsForRender(systems);
}
