import { GameBase } from "../_base";
import { APMoveResult } from "../../schemas/moveresults";
import i18next from "i18next";

type playerid = 1 | 2;
const checkDirs = [[1, 0], [0, 1], [1, 1], [1, -1]] as const;
const columnLabels = "abcdefghijklmnopqrstuvwxyz".split("");

export abstract class InARowBase extends GameBase {
    // A base class for Gomoku, Renju, Pente, Connect6, Connect4.
    // All protected methods should be safe to call from child classes.
    // private ones may have a bit of setup because some of them (the Renju ones) assume
    // some mutation of the board state in the algorithm.
    public coords2algebraic(x: number, y: number): string {
        return GameBase.coords2algebraic(x, y, this.boardSize);
    }

    public algebraic2coords(cell: string): [number, number] {
        return GameBase.algebraic2coords(cell, this.boardSize);
    }

    abstract winningLineLength: number;
    abstract boardSize: number;
    abstract board: Map<string, playerid>;
    abstract swapped: boolean;
    public toroidal = false;
    public toroidalPadding = 5;

    protected getBoardSize(): number {
        // Get board size from variants.
        if (this.variants !== undefined && this.variants.length > 0 && this.variants[0] !== undefined && this.variants[0].length > 0) {
            const sizeVariants = this.variants.filter(v => v.includes("standard") || v.includes("toroidal"))
            if (sizeVariants.length > 0) {
                const size = sizeVariants[0].match(/\d+/);
                return parseInt(size![0], 10);
            }
            if (isNaN(this.boardSize)) {
                throw new Error(`Could not determine the board size from variant "${this.variants[0]}"`);
            }
        }
        return 19;
    }

    protected pastOpeningFunc(actualPlacements: number, swapOpportunities: number, swapAfterLast: boolean, buffer: number): boolean {
        // This is the algorithm for determining if we are past the opening phase.
        // `actualPlacements` is the number of placements involved in the opening phase.
        // `swapOpportunities` is the number of opportunities to invoke the pie rule in between. This does not include the last move.
        // `swapAfterLast` is whether the pie rule can be invoked after the last placement in the opening.
        // `buffer` is the number of moves to consider after the opening phase.
        if (this.stack.length > actualPlacements + swapOpportunities + (swapAfterLast ? 1 : 0) + buffer) { return true; }
        let count = 0;
        let pastOpening = 0
        let swapIgnoreAfterLast = swapAfterLast;
        for (const [i, slice] of this.stack.entries()) {
            if (count >= actualPlacements) {
                if (count === actualPlacements && slice.lastmove === "pass" && swapIgnoreAfterLast) {
                    swapIgnoreAfterLast = false;
                    // We need to consider that pass after the last placement separately.
                    if (buffer === 0 && i === this.stack.length - 1) { return true; }
                } else {
                    pastOpening++;
                    if (pastOpening >= buffer) { return true; }
                }
            } else if (slice.lastmove !== undefined && slice.lastmove !== "pass") {
                count++;
                if (count >= actualPlacements && !swapAfterLast && buffer === 0 && i === this.stack.length - 1) { return true; }
            }
        }
        return false;
    }

    protected placeMoveCount(): number {
        // Count the moves that involve some form of placement (non-passes) before this turn.
        // This makes it easier to determine when to invoke logic when moves in
        // the stack are interspersed with passes.
        // In order to avoid unnecessary computation, I usually only call
        // this method if `this.stack.length` is smaller than some max threshold.
        let count = 0;
        for (const slice of this.stack) {
            if (slice.lastmove !== undefined && slice.lastmove !== "pass") { count++; }
        }
        return count;
    }

    private checkLines(startX: number, startY: number, dx: number, dy: number, inARow = 5, exact: playerid[], toroidal = false, border = 0): string[][] {
        // Check for winning lines in a given direction.
        // Returns an array of winning lines, which are arrays of cells that are all occupied by the same player.
        // `inARow` is the minimum number of pieces in a row to return a winning line.
        // `exact` determines whether the line must be exactly `inARow` or at least `inARow`.
        // `toroidal` determines if lines can wrap aronud.
        let currentPlayer: playerid | undefined;
        let currentCounter = 0;
        let cells: string[] = [];
        const winningLines: string[][] = [];
        let x = startX;
        let y = startY;
        let c = 0;
        // If toroidal, the first stone could be a continuation of a line from the other side of the board.
        // If it is, we will not count put it into the winnig line on the first pass, but add it as part
        // of the last line as it wraps around.
        let skipFirst = false;
        let skipPlayer: playerid | undefined;
        if (toroidal && this.board.has(this.coords2algebraic(startX, startY))) {
            const [finalX, finalY, ] = this.wrap(startX - dx, startY - dy, border);
            if (
                this.board.has(this.coords2algebraic(finalX, finalY)) &&
                this.board.get(this.coords2algebraic(startX, startY)) ===
                this.board.get(this.coords2algebraic(finalX, finalY))
            ) {
                skipFirst = true;
                skipPlayer = this.board.get(this.coords2algebraic(startX, startY));
            }
        }
        // We loop until we reach the boardSize, or if it's toroidal, we continue until currentCounter !== skipPlayer.
        while (c < this.boardSize - 2 * border || toroidal && skipPlayer !== undefined && currentPlayer === skipPlayer ) {
            const cell = this.coords2algebraic(x, y);
            const player = this.board.has(cell) ? this.board.get(cell) : undefined;
            if (player !== undefined && currentPlayer === player) {
                currentCounter++;
                cells.push(cell);
            }
            let wrapped = false;
            [x, y, wrapped] = this.wrap(x + dx, y + dy, border);
            if (player !== currentPlayer || !toroidal && wrapped) {
                if (currentPlayer !== undefined && (
                    exact.includes(currentPlayer) && currentCounter === inARow ||
                    !exact.includes(currentPlayer) && currentCounter >= inARow
                )) {
                    if (!skipFirst) {
                        winningLines.push(cells);
                    }
                }
                if (skipFirst && skipPlayer !== player) { skipFirst = false; }
                currentPlayer = !toroidal && wrapped ? undefined : player;
                currentCounter = currentPlayer === undefined ? 0 : 1;
                if (cells.length > 0) { cells = []; }
                if (player !== undefined) { cells.push(cell); }
            }
            c++;
        }
        return winningLines;
    }

    protected getWinningLinesMap(exact: playerid[] = [], border = 0): Map<playerid, string[][]> {
        // To get the winning lines so that we can highlight it at the end of the game.
        // `exact` is an array of player ids that require an exact winning line.
        // Note that playerid 1 is not necessarily the first player. Call `player1` and `player2` to get the playerids.
        const winningLines = new Map<playerid, string[][]>([
            [1, []],
            [2, []],
        ]);
        // Check rows
        for (let j = border; j < this.boardSize - 2 * border; j++) {
            const lines = this.checkLines(border, j, 1, 0, this.winningLineLength, exact, this.toroidal);
            for (const line of lines) {
                const player = this.board.get(line[0]);
                winningLines.get(player!)!.push(line);
            }
        }
        // Check columns
        for (let i = border; i < this.boardSize - 2 * border; i++) {
            const lines = this.checkLines(i, border, 0, 1, this.winningLineLength, exact, this.toroidal);
            for (const line of lines) {
                const player = this.board.get(line[0]);
                winningLines.get(player!)!.push(line);
            }
        }
        // Check upwards diagonals
        for (let i = border; i < this.boardSize - 2 * border; i++) {
            const lines = this.checkLines(i, border, -1, 1, this.winningLineLength, exact, this.toroidal)
            for (const line of lines) {
                const player = this.board.get(line[0]);
                winningLines.get(player!)!.push(line);
            }
        }
        // Check downwards diagonals
        for (let i = border; i < this.boardSize - 2 * border; i++) {
            const lines = this.checkLines(i, border, 1, 1, this.winningLineLength, exact, this.toroidal)
            for (const line of lines) {
                const player = this.board.get(line[0]);
                winningLines.get(player!)!.push(line);
            }
        }

        return winningLines;
    }

    protected player1(): playerid {
        // Get the playerid of the first player.
        return this.swapped ? 2 : 1;
    }

    protected player2(): playerid {
        // Get the playerid of the second player.
        return this.swapped ? 1 : 2;
    }

    protected hasEmptySpace(excludeBorders = false, border = 0): boolean {
        // Check if there is any empty space on the board.
        // This is used to determine if there are still moves left.
        for (let i = excludeBorders ? border : 0; i < this.boardSize - (excludeBorders ? 2 * border : 0); i++) {
            for (let j = excludeBorders ? border : 0; j < this.boardSize - (excludeBorders ? 2 * border : 0); j++) {
                if (!this.board.has(this.coords2algebraic(j, i))) { return true; }
            }
        }
        return false;
    }

    protected isNearCentre(cell: string, distance: number): boolean {
        // Check if a cell is within a certain Manhattan distance from the centre.
        const [x, y] = this.algebraic2coords(cell);
        const centre = (this.boardSize - 1) / 2;
        return Math.abs(x - centre) <= distance && Math.abs(y - centre) <= distance;
    }

    protected wrap(x: number, y: number, border = 0): [number, number, boolean] {
        // Return the wrapped coordinates and whether the coordinates were wrapped.
        let wrapped = false;
        if (x < border) { x += this.boardSize - 2 * border; wrapped = true; }
        if (x >= this.boardSize - border) { x -= this.boardSize - 2 * border; wrapped = true; }
        if (y < border) { y += this.boardSize - 2 * border; wrapped = true; }
        if (y >= this.boardSize - border) { y -= this.boardSize - 2 * border; wrapped = true; }
        return [x, y, wrapped];
    }

    private placeInARowCount(x: number, y: number, dx: number, dy: number, player: playerid, border = 0): number {
        // Count the number of pieces in a row in a given dx and dy assuming that a piece is placed.
        // Placement need not actually be done for this method.
        let countTotal = 1;
        for (const sign of [-1, 1]) {
            let count = 1;
            while (countTotal < this.boardSize - 2 * border) {
                const [x1, y1, wrapped] = this.wrap(x + count * sign * dx, y + count * sign * dy, border);
                if (!this.toroidal && wrapped) { break; }
                if (this.board.get(this.coords2algebraic(x1, y1)) !== player) { break; }
                count++;
                countTotal++;
            }
        }
        return countTotal;
    }

    private isOverline(x: number, y: number, dx: number, dy: number, player: playerid, winningLineLength = this.winningLineLength, border = 0): boolean {
        // Check if a player has an overline.
        return this.placeInARowCount(x, y, dx, dy, player, border) > winningLineLength;
    }

    protected isOverlineAll(x: number, y: number, player: playerid, winningLineLength = this.winningLineLength, border = 0): boolean {
        // Check if a player has an overline in any direction.
        for (const [dx, dy] of checkDirs) {
            if (this.isOverline(x, y, dx, dy, player, winningLineLength, border)) { return true; }
        }
        return false;
    }

    protected orthNeighbours(cell: string, border = 0): string[] {
        // Get all orthogonal neighbours of a cell.
        const [x, y] = this.algebraic2coords(cell);
        const neighbours: string[] = [];
        for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
            const [x1, y1, wrapped] = this.wrap(x + dx, y + dy, border);
            if (!this.toroidal && wrapped) { continue; }
            neighbours.push(this.coords2algebraic(x1, y1));
        }
        return neighbours;
    }

    protected hasInARow(x: number, y: number, player: playerid, inARow: number, exact: boolean): boolean {
        // Check if placement at x, y results in a player having `inARow` in a row.
        // If `exact` is true, it must be exactly `inARow` in a row, otherwise, it is at least `inARow`.
        // Placement need not actually be done for this method.
        for (const [dx, dy] of checkDirs) {
            const inRowCount = this.placeInARowCount(x, y, dx, dy, player);
            if (exact && inRowCount === inARow || !exact && inRowCount >= inARow) { return true; }
        }
        return false;
    }

    // Renju-related methods
    // Note: For now, these only work if border is 0.

    protected isRenjuFoul(x: number, y: number, player: playerid): boolean {
        // Check if a player has a foul by Renju rules.
        // Player colour check is not done here.
        return this.isOverlineAll(x, y, player, 5) || this.isDoubleFour(x, y, player) || this.isDoubleOpenThree(x, y, player);
    }

    protected isFiveAll(x: number, y: number, player: playerid): boolean {
        // Check if a player has a five-in-a-row.
        // This is useful because a five-in-a-row takes priority over a foul.
        // Placement need not actually be done for this method.
        return this.hasInARow(x, y, player, 5, true);
    }

    protected isDoubleFour(x: number, y: number, player: playerid): boolean {
        // Check if there are two 4-in-a-row in any direction.
        let fourCount = 0;
        const cell = this.coords2algebraic(x, y);
        const placed = !this.board.has(cell);
        if (placed) { this.board.set(cell, player) };
        for (const [dx, dy] of checkDirs) {
            fourCount += this.fourCountOpen(x, y, dx, dy, player)[0];
        }
        if (placed) { this.board.delete(cell) };
        if (fourCount >= 2) { return true; }
        return false;
    }

    protected isDoubleOpenThree(x: number, y: number, player: playerid): boolean {
        // Check if there are two open threes in any direction.
        // Note that this implementation calls `isRenjuFoul`, so this will not work for
        // variants that restrict double open threes without also restricting double fours or overlines.
        let openThreeCount = 0;
        const cell = this.coords2algebraic(x, y);
        const placed = !this.board.has(cell);
        if (placed) { this.board.set(cell, player) };
        for (const [dx, dy] of checkDirs) {
            if (this.isOpenThree(x, y, dx, dy, player)) {
                openThreeCount++;
            }
        }
        if (placed) { this.board.delete(cell) };
        if (openThreeCount >= 2) { return true; }
        return false;
    }

    protected getRestrictions(player: playerid): Map<string, "33" | "44" | "6+"> {
        // Get all restrictions for `player` assuming that faults apply.
        const faults = new Map<string, "33" | "44" | "6+">();
        for (let i = 0; i < this.boardSize; i++) {
            for (let j = 0; j < this.boardSize; j++) {
                const cell = this.coords2algebraic(j, i);
                if (this.board.has(cell)) { continue; }
                if (this.isFiveAll(j, i, player)) { continue; }
                if (this.isDoubleOpenThree(j, i, player)) {
                    faults.set(cell, "33");
                } else if (this.isDoubleFour(j, i, player)) {
                    faults.set(cell, "44");
                } else if (this.isOverlineAll(j, i, player, 5)) {
                    faults.set(cell, "6+");
                }
            }
        }
        return faults;
    }

    private isFive(x: number, y: number, dx: number, dy: number, player: playerid): boolean {
        // Check if there are 5 pieces in a row in a given direction.
        // Placement need not actually be done for this method.
        return this.placeInARowCount(x, y, dx, dy, player) === 5;
    }

    private fourCountOpen(x: number, y: number, dx: number, dy: number, player: playerid): [number, boolean] {
        // Check the number of fours that can be turned into a 5-in-a-row in a given direction.
        // Also return whether the four is open.
        // Open fours count as single fours.
        // Assume placement is done.
        let countTotal = 1;
        let foursCount = 0;
        for (const sign of [-1, 1]) {
            let count = 1;
            while (countTotal < this.boardSize) {
                const [x1, y1, wrapped] = this.wrap(x + count * sign * dx, y + count * sign * dy);
                if (!this.toroidal && wrapped) { break; }
                if (!this.board.has(this.coords2algebraic(x1, y1))) {
                    if (this.isFive(x1, y1, dx, dy, player)) { foursCount++; }
                    break;
                }
                count++;
                countTotal++;
            }
        }
        if (foursCount === 2 && countTotal === 4) { return [1, true]; }
        return [foursCount, false];
    }

    private isOpenFour(x: number, y: number, dx: number, dy: number, player: playerid): boolean {
        // Check if there is an open four in a given direction.
        // Assume placement is done.
        return this.fourCountOpen(x, y, dx, dy, player)[1];
    }

    private isOpenThree(x: number, y: number, dx: number, dy: number, player: playerid): boolean {
        // Check if there is an open three in a given direction.
        // Note that this implementation calls `isRenjuFoul`, so this will not work for
        // variants that restrict double open threes without also restricting double fours or overlines.
        // Assume placement is done.
        let countTotal = 1;
        for (const sign of [-1, 1]) {
            let count = 1;
            while (countTotal < this.boardSize) {
                const [x1, y1, wrapped] = this.wrap(x + count * sign * dx, y + count * sign * dy);
                if (!this.toroidal && wrapped) { break; }
                if (!this.board.has(this.coords2algebraic(x1, y1))) {
                    let foundOpenThree = false;
                    const cell = this.coords2algebraic(x1, y1);
                    this.board.set(cell, player);
                    if (this.isOpenFour(x1, y1, dx, dy, player) && !this.isRenjuFoul(x1, y1, player)) {
                        foundOpenThree = true;
                    }
                    this.board.delete(cell);
                    if (foundOpenThree) { return true; }
                    break;
                }
                count++;
                countTotal++;
            }
        }
        return false;
    }

    public getPlayerColour(p: playerid): number | string {
        if (p === 1) {
            return this.swapped ? 2 : 1;
        }
        return this.swapped ? 1 : 2;
    }

    // Toroidal-board-related methods for rendering
    // These can be called even if the board is not toroidal.

    protected renderCoords2algebraic(x: number, y: number): string {
        // Get the algebraic notation for a given coordinates from the renderer.
        return this.coords2algebraic(...this.renderCoords(x, y));
    }

    protected renderAlgebraic2coords(cell: string): [number, number][] {
        // Get the coordinates that can be rendered for a given algebraic notation on the toroidal board.
        // This mapping is one to many in the case of the toroidal board.
        const [x, y] = this.algebraic2coords(cell);
        return this.renderCoordsAll(x, y);
    }

    private renderCoords(x: number, y: number): [number, number] {
        // On the toroidal board, we pad the board with spaces equal to the
        // winning line length - 1 on each side.
        if (!this.toroidal) {
            return [x, y];
        }
        let actualX = x;
        let actualY = y;
        if (x < this.toroidalPadding) {
            actualX = x + this.boardSize - this.toroidalPadding;
        } else if (x >= this.boardSize + this.toroidalPadding) {
            actualX = x - this.boardSize - this.toroidalPadding;
        } else {
            actualX = x - this.toroidalPadding;
        }
        if (y < this.toroidalPadding) {
            actualY = y + this.boardSize - this.toroidalPadding;
        } else if (y >= this.boardSize + this.toroidalPadding) {
            actualY = y - this.boardSize - this.toroidalPadding;
        } else {
            actualY = y - this.toroidalPadding;
        }
        return [actualX, actualY];
    }

    protected renderCoordsAll(x: number, y: number): [number, number][] {
        // Get all render coordinates that are equivalent to the given coordinates on the toroidal board.
        if (!this.toroidal) {
            return [[x, y]];
        }
        const renderCoords: [number, number][] = [];
        const xs = [x + this.toroidalPadding];
        const ys = [y + this.toroidalPadding];
        if (x < this.toroidalPadding) {
            xs.push(x + this.boardSize + this.toroidalPadding);
        } else if (x >= this.boardSize - this.toroidalPadding) {
            xs.push(x - this.boardSize + this.toroidalPadding);
        }
        if (y < this.toroidalPadding) {
            ys.push(y + this.boardSize + this.toroidalPadding);
        } else if (y >= this.boardSize - this.toroidalPadding) {
            ys.push(y - this.boardSize + this.toroidalPadding);
        }
        for (const x1 of xs) {
            for (const y1 of ys) {
                renderCoords.push([x1, y1]);
            }
        }
        return renderCoords
    }

    protected renderColLabels(): string[] {
        // Get the column labels. On a toroidal board, the board gets wrapped around.
        const actualColumnLabels = columnLabels.slice(0, this.boardSize);
        if (!this.toroidal) {
            return actualColumnLabels;
        }
        return [
            ...actualColumnLabels.slice(this.boardSize - this.toroidalPadding),
            ...actualColumnLabels,
            ...actualColumnLabels.slice(0, this.toroidalPadding),
        ];
    }

    protected renderRowLabels(): string[] {
        // Get the row labels. On a toroidal board, the board gets wrapped around.
        const actualRowLabels = Array.from({length: this.boardSize}, (z, i) => (i + 1).toString());
        if (!this.toroidal) {
            return actualRowLabels;
        }
        return [
            ...actualRowLabels.slice(this.boardSize - this.toroidalPadding),
            ...actualRowLabels,
            ...actualRowLabels.slice(0, this.toroidalPadding),
        ];
    }

    protected isAdjacent(x1: number, y1: number, x2: number, y2: number): boolean {
        // Check if two coordinates are adjacent.
        if (x1 === x2 && y1 === y2) { return false; }
        return Math.abs(x1 - x2) <= 1 && Math.abs(y1 - y2) <= 1;
    }

    protected renderWinningLines(winningLines: string[][]): [number, number][][] {
        // Get all winning lines to be displayed on the board.
        // On a toroidal board, each winning line can be displayed multiple times.
        if (winningLines.length === 0) {
            return [];
        }
        if (!this.toroidal) {
            return winningLines.map(line => line.map(cell => this.algebraic2coords(cell)));
        }
        const allRenderLines: [number, number][][] = [];
        for (const line of winningLines) {
            const renderLines: [number, number][][] = [];
            for (const cell of line) {
                const [x, y] = this.algebraic2coords(cell);
                for (const coords of this.renderCoordsAll(x, y)) {
                    let foundNeighbour = false;
                    for (const renderLine of renderLines) {
                        if (this.isAdjacent(...coords, ...renderLine[renderLine.length - 1])) {
                            renderLine.push(coords);
                            foundNeighbour = true;
                            break;
                        }
                    }
                    if (!foundNeighbour) {
                        renderLines.push([coords]);
                    }
                }
            }
            allRenderLines.push(...renderLines);
        }
        return allRenderLines;
    }

    public chat(node: string[], player: string, results: APMoveResult[], r: APMoveResult): boolean {
        let resolved = false;
        switch (r.type) {
            case "place":
                node.push(i18next.t("apresults:PLACE.nowhat", { player, where: r.where }));
                resolved = true;
                break;
            case "pie":
                node.push(i18next.t("apresults:PIE", { player }));
                resolved = true;
                break;
            case "pass":
                if (r.why === "tiebreaker") {
                    node.push(i18next.t("apresults:PASS.tiebreaker", { player }));
                    resolved = true;
                } else {
                    node.push(i18next.t("apresults:PASS.simple", { player }));
                    resolved = true;
                }
                break;
        }
        return resolved;
    }
}
