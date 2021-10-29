import { Seat, Colour, Size } from "../homeworlds";

export interface IShip {
    owner: Seat;
    colour: Colour;
    size: Size;
}

export class Ship implements IShip {
    public owner: Seat;
    public colour: Colour;
    public readonly size: Size;

    constructor(colour: Colour, size: Size, owner: Seat) {
        this.owner = owner;
        this.colour = colour;
        this.size = size;
    }

    public id(): string {
        return this.colour + this.size.toString() + this.owner;
    }

    public clone(): Ship {
        return new Ship(this.colour, this.size, this.owner);
    }
}