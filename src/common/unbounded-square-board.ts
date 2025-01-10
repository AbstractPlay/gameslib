// A board that can be expanded in all directions.
// This is a mapping from absolute x and y coordinates to a generic type T.
// It implements an iterable interface, so it can be used in for-of loops.
// Note that the absolute coordinates, the y-axis is positive downwards.
// For the purpose of recording notation in string form for the user,
// we will make the y-axis positive upwards with a provided helper function.
// Of course, the individual games may choose to use their own notation system.
export class UnboundedSquareBoard<T> implements Iterable<[number, number, T]> {
    private board: Map<string, T>;

    constructor() {
        this.board = new Map<string, T>();
    }

    private getKey(x: number, y: number): string {
        return `${x},${y}`;
    }

    public set(x: number, y: number, value: T): void {
        this.board.set(this.getKey(x, y), value);
    }

    public get(x: number, y: number): T | undefined {
        return this.board.get(this.getKey(x, y));
    }

    public has(x: number, y: number): boolean {
        return this.board.has(this.getKey(x, y));
    }

    public delete(x: number, y: number): boolean {
        return this.board.delete(this.getKey(x, y));
    }

    public clear(): void {
        this.board.clear();
    }

    public getAllPositions(): Array<[number, number]> {
        return Array.from(this.board.keys()).map(key => {
            const [x, y] = key.split(',');
            return [parseInt(x, 10), parseInt(y, 10)];
        });
    }

    public get size(): number {
        return this.board.size;
    }

    public get minX(): number {
        return Math.min(...this.getAllPositions().map(([x,]) => x));
    }

    public get maxX(): number {
        return Math.max(...this.getAllPositions().map(([x,]) => x));
    }

    public get minY(): number {
        return Math.min(...this.getAllPositions().map(([, y]) => y));
    }

    public get maxY(): number {
        return Math.max(...this.getAllPositions().map(([, y]) => y));
    }

    public get xRange(): [number, number] {
        return [this.minX, this.maxX];
    }

    public get yRange(): [number, number] {
        return [this.minY, this.maxY];
    }

    public get width(): number {
        const [minX, maxX] = this.xRange;
        return maxX - minX + 1;
    }

    public get height(): number {
        const [minY, maxY] = this.yRange;
        return maxY - minY + 1;
    }

    // Returns true if the given point expands the board in the x direction.
    public expandsX(x: number): boolean {
        const [minX, maxX] = this.xRange;
        if (x < minX || x > maxX) { return true; }
        return false;
    }

    // Returns true if the given point expands the board in the y direction.
    public expandsY(y: number): boolean {
        const [minY, maxY] = this.yRange;
        if (y < minY || y > maxY) { return true; }
        return false;
    }

    public *[Symbol.iterator](): Iterator<[number, number, T]> {
        for (const [key, value] of this.board) {
            const [x, y] = key.split(',').map(Number);
            yield [x, y, value];
        }
    }

    public *entries(): IterableIterator<[number, number, T]> {
        yield* this;
    }

    public *keys(): IterableIterator<[number, number]> {
        for (const [x, y] of this.getAllPositions()) {
            yield [x, y];
        }
    }

    public *values(): IterableIterator<T> {
        for (const [, , value] of this) {
            yield value;
        }
    }

    public forEach(callbackfn: (value: T, position: [number, number], board: this) => void): void {
        for (const [x, y, value] of this) {
            callbackfn(value, [x, y], this);
        }
    }

    // Takes an absolute coordinate and translates it to the relative version.
    // In relative coordinates, the point (0, 0) is the top-left corner of the current expanded board.
    // Negative x and y relative coordinates are allowed, and they indicate that
    // the point is outside the current expanded board.
    public abs2rel(absX: number, absY: number): [number, number] {
        if (this.size === 0) {
            throw new Error('The board is empty');
        }
        return [absX - this.minX, absY - this.minY];
    }

    // Takes a relative coordinate and translates it to the absolute version
    // In relative coordinates, the point (0, 0) is the top-left corner of the current expanded board.
    // Negative x and y relative coordinates are allowed, and they indicate that
    // the point is outside the current expanded board.
    public rel2abs(relX: number, relY: number): [number,number] {
        if (this.size === 0) {
            throw new Error('The board is empty');
        }
        return [relX + this.minX, relY + this.minY];
    }

    // Converts absolute coordinates to a string notation.
    // The notation is in the form "x,y", and unlike absolute coordinates,
    // y is positive upwards.
    public abs2notation(absX: number, absY: number): string {
        return `${absX},${-absY}`;
    }

    // Converts a string notation to absolute coordinates.
    // The notation is in the form "x,y", and unlike absolute coordinates,
    // y is positive upwards.
    public notation2abs(notation: string): [number, number] {
        const [x, y] = notation.split(',').map(Number);
        return [x, -y];
    }

    public clone(): UnboundedSquareBoard<T> {
        const newBoard = new UnboundedSquareBoard<T>();
        for (const [x, y, value] of this) {
            newBoard.set(x, y, value);
        }
        return newBoard;
    }

    public deepClone(): UnboundedSquareBoard<T> {
        const newBoard = new UnboundedSquareBoard<T>();
        for (const [x, y, value] of this) {
            // Use structured clone if available, otherwise fallback to JSON
            const clonedValue = (typeof structuredClone === 'function')
                ? structuredClone(value)
                : JSON.parse(JSON.stringify(value)) as T;
            newBoard.set(x, y, clonedValue);
        }
        return newBoard;
    }

    public static from<U>(board: UnboundedSquareBoard<U>): UnboundedSquareBoard<U> {
        const cloned = new UnboundedSquareBoard<U>();
        board.board.forEach((value, key) => { cloned.board.set(key, value); });
        return cloned;
    }
}