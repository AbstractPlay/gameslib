import { Colour, Size, HomeworldsErrors as HWErrors } from "../homeworlds";
import { UserFacingError } from "../../common";
import i18next from "i18next";
// tslint:disable-next-line: no-var-requires
const deepclone = require("rfdc/default");

interface IStashContents {
    R: [number, number, number];
    B: [number, number, number];
    G: [number, number, number];
    Y: [number, number, number];
}

interface IRendered {
    type: string;
    R: string;
    B: string;
    G: string;
    Y: string;
}

export class Stash {

    private contents: IStashContents;
    private maxStash: number;

    constructor(n: number) {
        this.maxStash = n;
        this.contents = {R: [n, n, n], B: [n, n, n], G: [n, n, n], Y: [n, n, n]};
    }

    public has(c: Colour, s: Size): boolean {
        return (this.contents[c][s - 1] > 0);
    }

    public render(): IRendered {
        const ret: IRendered = {type: "globalStash", R: "", G: "", B: "", Y: ""};
        for (const c of ["R" as Colour, "G" as Colour, "B" as Colour, "Y" as Colour]) {
            for (const s of [0, 1, 2]) {
                for (let i = 0; i < this.contents[c][s]; i++) {
                    ret[c] += (s+1).toString();
                }
            }
        }
        return ret;
    }

    public add(c: Colour, s: Size): Stash {
        if (this.contents[c][s-1] >= this.maxStash) {
            throw new Error(`You can't add more pieces than the maximum (${this.maxStash}).`);
        }
        this.contents[c][s-1]++;
        return this;
    }

    public remove(c: Colour, s: Size): Stash {
        if (this.contents[c][s-1] < 1) {
            throw new UserFacingError(HWErrors.STASH_EMPTY, i18next.t("apgames:homeworlds.STASH_EMPTY"));
        }
        this.contents[c][s-1]--;
        return this;
    }

    public takeSmallest(c: Colour): Size | undefined {
        for (let i = 0; i < 3; i++) {
            if (this.contents[c][i] > 0) {
                this.contents[c][i]--;
                return (i+1) as Size;
            }
        }
        return undefined;
    }

    public clone(): Stash {
        const newStash = new Stash(this.maxStash);
        newStash.contents = deepclone(this.contents);
        return newStash;
    }
}