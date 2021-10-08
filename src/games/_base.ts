import { APGamesInformation } from '../schemas/gameinfo';
import { APRenderRep } from "@abstractplay/renderer/src/schema";

export abstract class GameBase {
    public static readonly gameinfo: APGamesInformation;
    public static info(): string {
        return JSON.stringify(this.gameinfo)
    }

    // public gameover: boolean;

    // constructor() {
    //     this.gameover = false;
    // }

    public abstract move(move: string): GameBase;
    public abstract render(): APRenderRep;
}
