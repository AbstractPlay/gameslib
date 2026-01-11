/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import { CrosshairsGame } from '../../src/games';

describe("Crosshairs", () => {
    describe("Cloud Phase", () => {
        it("should start in cloud phase", () => {
            const g = new CrosshairsGame();
            expect(g.clouds.size).to.equal(0);
            expect(g.turnNumber).to.equal(0);
            expect(g.currplayer).to.equal(1);
        });

        it("should allow placing clouds", () => {
            const g = new CrosshairsGame();
            const moves = g.moves();
            expect(moves.length).to.be.greaterThan(0);
            expect(moves[0]).to.match(/^cloud:/);

            g.move(moves[0]);
            expect(g.clouds.size).to.equal(1);
            expect(g.currplayer).to.equal(2);
        });

        it("should end cloud phase after 16 clouds", () => {
            const g = new CrosshairsGame();
            for (let i = 0; i < 16; i++) {
                const moves = g.moves();
                g.move(moves[0]);
            }
            expect(g.clouds.size).to.equal(16);
            expect(g.turnNumber).to.equal(1);
            // Should no longer be in cloud phase
            const moves = g.moves();
            expect(moves[0]).to.not.match(/^cloud:/);
        });
    });

    describe("Entry Phase", () => {
        let g: CrosshairsGame;

        beforeEach(() => {
            g = new CrosshairsGame();
            // Skip cloud phase by manually setting clouds
            g.clouds.clear();
            // Place clouds away from starting edges
            const safeCells = ['d3', 'd4', 'd5', 'd6', 'e3', 'e4', 'e5', 'e6',
                               'f3', 'f4', 'f5', 'f6', 'g3', 'g4', 'g5', 'g6'];
            for (let i = 0; i < 16; i++) {
                g.clouds.add(safeCells[i]);
            }
            g.turnNumber = 1;
            // Save state to stack so clone() works correctly
            (g as any).saveState();
        });

        it("Turn 1: P1 enters 1 plane", () => {
            // Turn 1: P1 should enter 1 plane
            const moves = g.moves();
            expect(moves.length).to.be.greaterThan(0);
            expect(moves[0]).to.match(/^enter:/);

            // Single entry should be a complete move for turn 1
            const validation = g.validateMove(moves[0]);
            expect(validation.valid).to.be.true;
            expect(validation.complete).to.equal(1);

            g.move(moves[0]);
            expect(g.board.size).to.equal(1);
            expect(g.turnNumber).to.equal(2);
            expect(g.currplayer).to.equal(2);
        });

        it("Turn 2: P2 enters 2 planes", () => {
            // Complete turn 1
            g.move(g.moves()[0]);

            // Turn 2: P2 should enter 2 planes
            expect(g.currplayer).to.equal(2);

            // Get first entry move
            const moves1 = g.moves();
            const entry1 = moves1[0];

            // Validate partial move
            let validation = g.validateMove(entry1);
            expect(validation.valid).to.be.true;
            expect(validation.complete).to.equal(-1); // Partial - need more planes

            // Get second entry move
            const moves2 = g.moves(g.currplayer, entry1);
            const entry2 = moves2[0];

            // Complete move
            const fullMove = `${entry1},${entry2}`;
            validation = g.validateMove(fullMove);
            expect(validation.valid).to.be.true;
            expect(validation.complete).to.equal(1);

            g.move(fullMove);
            expect(g.board.size).to.equal(3); // 1 from P1 + 2 from P2
            expect(g.turnNumber).to.equal(3);
            expect(g.currplayer).to.equal(1);
        });

        it("Turn 3: P1 takes 3 actions (can enter or move)", () => {
            // Complete turns 1 and 2
            g.move(g.moves()[0]); // P1 turn 1

            let entries: string[] = [];
            for (let i = 0; i < 2; i++) {
                const moves = g.moves(g.currplayer, entries.join(','));
                entries.push(moves[0]);
            }
            g.move(entries.join(',')); // P2 turn 2

            // Turn 3: P1 should take 3 actions (enter new planes or move existing)
            expect(g.currplayer).to.equal(1);
            expect(g.turnNumber).to.equal(3);

            // Two actions should be partial
            entries = [];
            for (let i = 0; i < 2; i++) {
                const moves = g.moves(g.currplayer, entries.join(','));
                entries.push(moves[0]);
            }
            let validation = g.validateMove(entries.join(','));
            expect(validation.complete).to.equal(-1); // Need more

            // Three actions should be complete
            const moves = g.moves(g.currplayer, entries.join(','));
            entries.push(moves[0]);
            validation = g.validateMove(entries.join(','));
            expect(validation.complete).to.equal(1);

            g.move(entries.join(','));

            // Board size depends on mix of entries vs moves
            // At minimum: 1 (turn 1) + 2 (turn 2) + at least some from turn 3
            expect(g.board.size).to.be.at.least(3);
            expect(g.turnNumber).to.equal(4);
        });
    });

    describe("Movement", () => {
        let g: CrosshairsGame;

        beforeEach(() => {
            g = new CrosshairsGame();
            // Add 16 clouds in safe locations away from movement test areas
            const cloudCells = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6',
                                'b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7',
                                'c1', 'c2', 'c3'];
            for (const cell of cloudCells) {
                g.clouds.add(cell);
            }
            g.turnNumber = 5; // Main game phase
            g.planesRemaining = [0, 0];
            // Save state to stack so clone() works correctly
            (g as any).saveState();
        });

        it("Level flight moves 1-2 spaces forward", () => {
            // Place a plane facing E at height 0 at f5
            // E direction from f5: f6, f7, f8, f9, f10, f11
            g.board.set('f5', [1, 'E', 0]);
            g.currplayer = 1;
            (g as any).saveState();

            const moves = g.moves();
            // Should have level flight options (1 or 2 spaces E)
            expect(moves.some(m => m.startsWith('f5-f6'))).to.be.true;
            expect(moves.some(m => m.startsWith('f5-f7'))).to.be.true;
        });

        it("Climb increases height and moves 1 forward", () => {
            // f5 facing E at height 2
            g.board.set('f5', [1, 'E', 2]);
            g.currplayer = 1;
            (g as any).saveState();

            const moves = g.moves();
            // Should have climb options (with +)
            expect(moves.some(m => m.startsWith('f5+f6'))).to.be.true;
        });

        it("Cannot climb at max height 6", () => {
            g.board.set('f5', [1, 'E', 6]);
            g.currplayer = 1;
            (g as any).saveState();

            const moves = g.moves();
            // Should not have climb options
            expect(moves.every(m => !m.includes('+'))).to.be.true;
        });

        it("Dive loses height", () => {
            g.board.set('f5', [1, 'E', 4]);
            g.currplayer = 1;
            (g as any).saveState();

            const moves = g.moves();
            // Should have dive options (with v)
            expect(moves.some(m => m.startsWith('f5v'))).to.be.true;
        });
    });

    describe("Combat", () => {
        let g: CrosshairsGame;

        beforeEach(() => {
            g = new CrosshairsGame();
            // Add 16 clouds away from the combat test area
            const cloudCells = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6',
                                'b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7',
                                'c1', 'c2', 'c3'];
            for (const cell of cloudCells) {
                g.clouds.add(cell);
            }
            g.turnNumber = 5;
            g.planesRemaining = [0, 0];
        });

        it("Plane shot down when in crosshairs of 2+ enemies", () => {
            // Set up a true crosshairs situation with crossing fire
            // P1 plane at f2 facing E: line of fire f3, f4, f5, f6, f7, f8, f9, f10, f11
            // P1 plane at f10 facing W: line of fire f9, f8, f7, f6, f5, f4, f3, f2, f1
            // P2 plane at f6: in line of fire of BOTH P1 planes (crosshairs!)
            g.board.set('f2', [1, 'E', 0]);
            g.board.set('f10', [1, 'W', 0]);
            g.board.set('f6', [2, 'NE', 0]);  // P2 plane in the crosshairs
            g.currplayer = 1;
            (g as any).saveState();

            // P1 moves both planes (must move all planes per turn)
            // Keep them in position but move 1 space in their facing direction
            g.move('f2-f3,f10-f9');

            // After moves:
            // f3 facing E: line of fire includes f4, f5, f6, ... (hits f6)
            // f9 facing W: line of fire includes f8, f7, f6, ... (hits f6)
            // P2 plane at f6 is in crosshairs of both - should be shot down!
            expect(g.board.has('f6')).to.be.false;
            expect(g.results.some(r => r.type === 'capture')).to.be.true;
        });

        it("Plane not shot down with only 1 enemy aiming", () => {
            // Single P1 plane scenario
            g.board.set('f3', [1, 'E', 0]);
            g.board.set('f10', [2, 'W', 0]);
            g.currplayer = 1;
            (g as any).saveState();

            // P1 has only 1 plane to move
            g.move('f3-f4');

            // P2's plane should still exist (only 1 P1 plane aiming)
            expect(g.board.has('f10')).to.be.true;
        });
    });

    describe("Rendering", () => {
        it("should render planes with altitude indicators", () => {
            const g = new CrosshairsGame();
            g.clouds.clear();
            g.board.set('d5', [1, 'E', 3]);
            g.board.set('e5', [2, 'W', 6]);

            const render = g.render();

            // Check legend has altitude variations
            expect(render.legend).to.have.property('P1E_3');
            expect(render.legend).to.have.property('P2W_6');

            // P1E_3 should be an array with altitude triangles + plane
            const p1e3 = render.legend!['P1E_3'];
            expect(Array.isArray(p1e3)).to.be.true;
            expect((p1e3 as unknown[]).length).to.equal(4); // 3 triangles + 1 plane
        });
    });

    describe("Game End", () => {
        it("Player loses when reduced to 1 plane", () => {
            const g = new CrosshairsGame();
            // Add 16 clouds away from test area
            const cloudCells = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6',
                                'b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7',
                                'c1', 'c2', 'c3'];
            for (const cell of cloudCells) {
                g.clouds.add(cell);
            }
            g.turnNumber = 5;
            g.planesRemaining = [0, 0];

            // Set up crosshairs to shoot down P2's only plane
            // P1 planes at f2 facing E and f10 facing W
            // P2 plane at f6 in the crosshairs
            g.board.set('f2', [1, 'E', 0]);
            g.board.set('f10', [1, 'W', 0]);
            g.board.set('f6', [2, 'NE', 0]);  // P2's only plane
            g.currplayer = 1;
            (g as any).saveState();

            // P1 moves both planes, maintaining crosshairs on f6
            g.move('f2-f3,f10-f9');

            // P2 reduced to 0 planes (was 1, shot down in crosshairs)
            expect(g.gameover).to.be.true;
            expect(g.winner).to.include(1);
        });
    });
});
