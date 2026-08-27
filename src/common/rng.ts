import seedrandom from "seedrandom";

/**
 * Seeded PRNG for solo play (`numplayers === 1`). Wraps `seedrandom.alea` so every
 * draw increments a logical counter for mid-game catch-up and seed+move replay.
 */
export class GameRng {
    private _seed: string;
    private _counter: number;
    private _alea: seedrandom.PRNG;

    public constructor(seed: string, counter = 0) {
        this._seed = seed;
        this._counter = 0;
        this._alea = seedrandom.alea(seed);
        this.fastForward(counter);
    }

    /** Draw a float in [0, 1). Each call advances the logical counter. */
    public random(): number {
        const value = this._alea();
        this._counter++;
        return value;
    }

    /** Inclusive integer in [min, max]. One counter unit per call. */
    public randomInt(max: number, min = 1): number {
        const lo = Math.ceil(min);
        const hi = Math.floor(max);
        return Math.floor(this.random() * (hi - lo + 1)) + lo;
    }

    /** Fisher–Yates shuffle; each swap index consumes one counter unit. */
    public shuffle<T>(items: T[]): T[] {
        const working = [...items];
        let remaining = working.length;

        while (remaining) {
            const randomIdx = Math.floor(this.random() * remaining--);
            const t = working[remaining];
            working[remaining] = working[randomIdx];
            working[randomIdx] = t;
        }

        return working;
    }

    public getCounter(): number {
        return this._counter;
    }

    public getSeed(): string {
        return this._seed;
    }

    /** Re-instantiate alea(seed) and fast-forward to counter draws. */
    public restore(seed: string, counter: number): void {
        this._seed = seed;
        this._counter = 0;
        this._alea = seedrandom.alea(seed);
        this.fastForward(counter);
    }

    private fastForward(count: number): void {
        for (let i = 0; i < count; i++) {
            this._alea();
        }
        this._counter = count;
    }
}
