import { defineHex, Orientation, Hex, type HexOffset } from "honeycomb-grid";

export type HexArgs = {q: number; r: number};

export interface ModularHex extends Hex {
    uid: string;
    col: number;
    row: number;
    dupe(): ModularHex;
}

export const createModularHex = (orientation: Orientation = Orientation.FLAT, offset: HexOffset = 1) => {
    return class ModularHexImpl extends defineHex({ offset, orientation }) implements ModularHex {
        public get uid(): string {
            return `${this.q},${this.r}`;
        }

        public get col(): number {
            if (orientation === Orientation.POINTY) {
                return this.q + (this.r + offset * (this.r & 1)) / 2;
            }
            return this.q;
        }

        public get row(): number {
            if (orientation === Orientation.POINTY) {
                return this.r;
            }
            return this.r + (this.q + offset * (this.q & 1)) / 2;
        }

        static create(args: HexArgs): ModularHex {
            return new ModularHexImpl({q: args.q, r: args.r});
        }

        public dupe(): ModularHex {
            return ModularHexImpl.create({q: this.q, r: this.r});
        }

        public static deserialize(hex: ModularHex): ModularHex {
            return ModularHexImpl.create({q: hex.q, r: hex.r});
        }
    };
}
