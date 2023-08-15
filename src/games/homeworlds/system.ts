import { Star, Seat, Colour, Size, HomeworldsErrors as HWErrors } from "../homeworlds";
import { Ship, IShip } from "./ship";
import { UserFacingError } from "../../common";
import i18next from "i18next";

interface ISysRender {
    name: string;
    stars: string[];
    seat?: Seat;
}

export interface ISystem {
    name: string;
    owner?: Seat;
    stars: Star[];
    ships: IShip[];
}

export class System implements ISystem {
    public readonly name: string;
    public owner?: Seat;
    public stars: Star[];
    public ships: Ship[];

    public static nameValid(name: string): boolean {
        if ( (name.length < 1) || (name.length > 25) ) {
            return false;
        }
        if (! name.match(/^[A-Za-z0-9][A-Za-z0-9_-]*$/)) {
            return false;
        }
        return true;
    }

    public static deserialize(json: ISystem): System {
        const newsys = new System(json.name, json.stars, json.owner);
        for (const s of json.ships) {
            newsys.dock(new Ship(s.colour, s.size, s.owner));
        }
        return newsys;
    }

    constructor(name: string, stars: Star[], owner?: Seat/* , checkStars = true*/) {
        // // Only home systems can have two stars
        // if (checkStars) {
        //     if ( (stars.length > 1) && (owner === undefined) ) {
        //         throw new Error(`Only home systems can have two stars: ${name}`);
        //     }
        // }
        if (! System.nameValid(name)) {
            throw new UserFacingError(HWErrors.SYSTEM_BADNAME, i18next.t("apgames:homeworlds.SYSTEM_BADNAME", {name}));
        }

        this.name = name;
        this.stars = stars;
        this.ships = [];
        if (owner !== undefined) {
            this.owner = owner;
        }
    }

    public isHome() {
        return (this.owner !== undefined);
    }

    public dock(ship: Ship): System {
        if ( (this.isHome()) && (this.ships.length >= 16)) {
            throw new UserFacingError(HWErrors.SYSTEM_FULL, i18next.t("apgames:homeworlds.SYSTEM_FULL", {system: this.name}));
        } else if (this.ships.length >= 24) {
            throw new UserFacingError(HWErrors.SYSTEM_FULL, i18next.t("apgames:homeworlds.SYSTEM_FULL", {system: this.name}));
        }
        this.ships.push(ship);
        return this;
    }

    public undock(ship: string): Ship {
        const idx = this.ships.findIndex(x => x.id() === ship);
        if (idx < 0) {
            throw new UserFacingError(HWErrors.SYSTEM_NOSHIP, i18next.t("apgames:homeworlds.SYSTEM_NOSHIP", {ship}));
        }
        const shipObj = this.ships[idx];
        this.ships.splice(idx, 1);
        return shipObj;
    }

    public hasShip(ship: string): boolean {
        const idx = this.ships.findIndex(x => x.id() === ship);
        if (idx < 0) {
            return false;
        }
        return true;
    }

    public getShip(shipID: string): Ship {
        const ship = this.ships.find(x => x.id() === shipID);
        if (ship === undefined) {
            throw new UserFacingError(HWErrors.SYSTEM_NOSHIP, i18next.t("apgames:homeworlds.SYSTEM_NOSHIP", {ship: shipID}));
        }
        return ship;
    }

    public getLargestShip(owner: Seat): Size {
        const sizes = this.ships.filter(s => s.owner === owner).map(s => s.size);
        return Math.max(...sizes) as Size;
    }

    public countShips(owner: Seat): number {
        return this.ships.filter(s => s.owner === owner).length;
    }

    public ownsShipColour(colour: Colour, seat: Seat): boolean {
        const ship = this.ships.find(s => ((s.colour === colour) && (s.owner === seat)));
        if (ship === undefined) {
            return false;
        }
        return true;
    }

    public hasTech(colour: Colour, seat: Seat): boolean {
        for (const star of this.stars) {
            if (star[0] === colour) {
                return true;
            }
        }
        for (const ship of this.ships) {
            if ( (ship.owner === seat) && (ship.colour === colour) ) {
                return true;
            }
        }
        return false;
    }

    public isConnected(system: System): boolean {
        for (const from of this.stars) {
            for (const to of system.stars) {
                if (from[1] === to[1]) {
                    return false;
                }
            }
        }
        return true;
    }

    public canCatastrophe(c: Colour): boolean {
        let count = 0;
        for (const star of this.stars) {
            if (star[0] === c) {
                count++;
            }
        }
        for (const ship of this.ships) {
            if (ship.colour === c) {
                count++;
            }
        }

        if (count >= 4) {
            return true;
        } else {
            return false;
        }
    }

    public catastrophe(c: Colour): System {
        if (! this.canCatastrophe(c)) {
            throw new UserFacingError(HWErrors.CMD_CATA_INVALID, i18next.t("apgames:homeworlds.CMD_CATA_INVALID", {colour: c, system: this.name}));
        }

        this.stars = [...this.stars.filter(x => x[0] !== c)];
        this.ships = [...this.ships.filter(x => x.colour !== c)];
        return this;
    }

    public casualties(c: Colour): [Colour, Size][] {
        const lst: [Colour, Size][] = [];
        for (const star of this.stars) {
            if (star[0] === c) {
                lst.push(star);
            }
        }
        for (const ship of this.ships) {
            if (ship.colour === c) {
                lst.push([ship.colour, ship.size]);
            }
        }
        return lst;
    }

    public renderSys(): ISysRender {
        const ret: ISysRender = {
            name: this.name,
            stars: this.stars.map(s => s[0] + s[1].toString())
        };
        if (this.owner !== undefined) {
            ret.seat = this.owner;
        }
        return ret;
    }

    public renderShips(): string[] {
        return this.ships.map(x => 'p' + x.id());
    }

    public clone(): System {
        const newSys = new System(this.name, [...this.stars], this.owner/* , false*/);
        newSys.ships = this.ships.map(s => s.clone());
        return newSys;
    }
}
