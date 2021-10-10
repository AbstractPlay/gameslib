import { APGamesInformation } from '../schemas/gameinfo';
import { APRenderRep } from "@abstractplay/renderer/src/schema";

const columnLabels = "abcdefghijklmnopqrstuvwxyz".split("");

export abstract class GameBase {
    public static readonly gameinfo: APGamesInformation;
    public static info(): string {
        return JSON.stringify(this.gameinfo)
    }
    public static coords2algebraic(x: number, y: number, height: number): string {
        return columnLabels[x] + (height - y).toString();
    }

    public static algebraic2coords(cell: string, height: number): [number, number] {
        const pair: string[] = cell.split("");
        const num = (pair.slice(1)).join("");
        const x = columnLabels.indexOf(pair[0]);
        if ( (x === undefined) || (x < 0) ) {
            throw new Error(`The column label is invalid: ${pair[0]}`);
        }
        const y = parseInt(num, 10);
        if ( (y === undefined) || (isNaN(y)) ) {
            throw new Error(`The row label is invalid: ${pair[1]}`);
        }
        return [x, height - y];
    }

    public status(): string {
        return "";
    }

    public abstract gameover: boolean;
    public abstract numplayers: number;
    public abstract winner?: any[];

    public abstract move(move: string): GameBase;
    public abstract render(): APRenderRep;
}
