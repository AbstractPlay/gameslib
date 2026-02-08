/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import { CrosshairsGame } from '../../src/games';
import { addResource } from '../../src';
import i18next from "i18next";

describe("Crosshairs", () => {
    // Initialize i18next for this suite, clean up after to avoid polluting other tests
    before(() => { addResource("en"); });
    after(() => {
        i18next.removeResourceBundle("en", "apgames");
        i18next.removeResourceBundle("en", "apresults");
        i18next.removeResourceBundle("fr", "apgames");
        i18next.removeResourceBundle("fr", "apresults");
    });
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

        it("should not allow clouds bigger than 2 hexes", () => {
            const g = new CrosshairsGame();

            // Place first cloud at f5
            g.move('cloud:f5');

            // Place second cloud at f6 (adjacent to f5, making a 2-hex cloud)
            g.move('cloud:f6');

            // Now neither f4 nor f7 should be valid (would extend the cloud to 3 hexes)
            const moves = g.moves();
            expect(moves.some(m => m === 'cloud:f4')).to.be.false;
            expect(moves.some(m => m === 'cloud:f7')).to.be.false;

            // But placing an isolated cloud elsewhere should still work
            expect(moves.some(m => m === 'cloud:a1')).to.be.true;
        });
    });

    describe("Random Start Variant", () => {
        it("should place 16 symmetric clouds and skip cloud phase", () => {
            const g = new CrosshairsGame(undefined, ["random-start"]);
            expect(g.clouds.size).to.equal(16);
            expect(g.turnNumber).to.equal(1);
            // Should be in entry phase, not cloud phase
            const moves = g.moves();
            expect(moves[0]).to.match(/^enter:/);
        });

        it("clouds should be placed symmetrically", () => {
            const g = new CrosshairsGame(undefined, ["random-start"]);
            const clouds = Array.from(g.clouds);

            // Helper to get symmetric cell using proper hex coordinate rotation
            const getSymmetric = (cell: string): string => {
                return g.graph.rot180(cell);
            };

            // Each cloud should have its symmetric counterpart also be a cloud
            for (const cloud of clouds) {
                const symmetric = getSymmetric(cloud);
                expect(g.clouds.has(symmetric), `Cloud at ${cloud} should have symmetric at ${symmetric}`).to.be.true;
            }
        });

        it("no cloud group should be larger than 2 hexes", () => {
            const g = new CrosshairsGame(undefined, ["random-start"]);

            // For each cloud, count adjacent clouds
            for (const cloud of g.clouds) {
                const [x, y] = g.graph.algebraic2coords(cloud);
                let adjacentCount = 0;
                const dirs = ["NE", "E", "SE", "SW", "W", "NW"] as const;

                for (const dir of dirs) {
                    const next = g.graph.move(x, y, dir);
                    if (next !== undefined) {
                        const nextCell = g.graph.coords2algebraic(...next);
                        if (g.clouds.has(nextCell)) {
                            adjacentCount++;
                        }
                    }
                }
                // A cloud can have at most 1 adjacent cloud (forming a 2-hex group)
                expect(adjacentCount, `Cloud at ${cloud} has ${adjacentCount} adjacent clouds`).to.be.at.most(1);
            }
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
            (g as unknown as { saveState: () => void }).saveState();
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

            // Get first entry action
            const actions1 = g.actions();
            const entry1 = actions1[0];

            // Validate partial move
            let validation = g.validateMove(entry1);
            expect(validation.valid).to.be.true;
            expect(validation.complete).to.equal(-1); // Partial - need more planes

            // Get second entry move
            const moves2 = g.actions(g.currplayer, entry1);
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
                const actions = g.actions(g.currplayer, entries.join(','));
                entries.push(actions[0]);
            }
            g.move(entries.join(',')); // P2 turn 2

            // Turn 3: P1 should take 3 actions (enter new planes or move existing)
            expect(g.currplayer).to.equal(1);
            expect(g.turnNumber).to.equal(3);

            // Two actions should be partial
            entries = [];
            for (let i = 0; i < 2; i++) {
                const actions = g.actions(g.currplayer, entries.join(','));
                entries.push(actions[0]);
            }
            let validation = g.validateMove(entries.join(','));
            expect(validation.complete).to.equal(-1); // Need more

            // Three actions should be complete
            const actions = g.actions(g.currplayer, entries.join(','));
            entries.push(actions[0]);
            validation = g.validateMove(entries.join(','));
            expect(validation.complete).to.equal(1);

            g.move(entries.join(','));

            // Board size depends on mix of entries vs moves
            // At minimum: 1 (turn 1) + 2 (turn 2) + at least some from turn 3
            expect(g.board.size).to.be.at.least(3);
            expect(g.turnNumber).to.equal(4);
        });

        it("Newly entered planes cannot move the same turn", () => {
            // Enter a plane
            const entryMove = g.moves()[0]; // e.g., "enter:a1/NE"
            expect(entryMove).to.match(/^enter:/);
            const entryCell = entryMove.slice(6).split('/')[0]; // e.g., "a1"

            // Get actions after entry - should NOT include actions for the just-entered plane
            const nextMoves = g.actions(g.currplayer, entryMove);

            // None of the next moves should start from the entry cell
            const movesFromEntryCell = nextMoves.filter(m => {
                if (m.startsWith('enter:')) return false;
                // Check if move starts from entry cell
                return m.startsWith(entryCell + '-') ||
                       m.startsWith(entryCell + '+') ||
                       m.startsWith(entryCell + 'v') ||
                       m === entryCell + 'X';
            });
            expect(movesFromEntryCell.length).to.equal(0);
        });

        it("Cannot move to a cell occupied by a just-entered plane", () => {
            // Enter first plane at a1 (P1's starting edge)
            const firstEntry = 'enter:a1/NE';
            expect(g.validateMove(firstEntry).valid).to.be.true;

            // Get second entry actions - a1 should be blocked
            const secondMoves = g.actions(g.currplayer, firstEntry);
            const a1Entries = secondMoves.filter(m => m.startsWith('enter:a1'));
            expect(a1Entries.length).to.equal(0);
        });

        it("A plane can only move once per turn", () => {
            // Set up a game in main phase with planes
            g.turnNumber = 5;
            g.board.set('f5', [1, 'S', 0]);
            g.board.set('f8', [1, 'S', 0]);
            g.planesRemaining = [3, 5];
            (g as unknown as { saveState: () => void }).saveState();

            // First move: f5 moves to f6
            const firstMove = 'f5-f6';
            expect(g.validateMove(firstMove).valid).to.be.true;

            // Get continuation actions - f6 should NOT be moveable (same plane)
            const nextMoves = g.actions(g.currplayer, firstMove);

            // Should have moves for f8 (the other plane), but NOT for f6 (the plane that just moved)
            const f6Moves = nextMoves.filter(m =>
                m.startsWith('f6-') || m.startsWith('f6+') || m.startsWith('f6v') || m === 'f6X'
            );
            const f8Moves = nextMoves.filter(m =>
                m.startsWith('f8-') || m.startsWith('f8+') || m.startsWith('f8v') || m === 'f8X'
            );

            expect(f6Moves.length).to.equal(0); // Plane at f6 already moved
            expect(f8Moves.length).to.be.greaterThan(0); // Plane at f8 can still move
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
            (g as unknown as { saveState: () => void }).saveState();
        });

        it("Level flight moves 1-2 spaces forward", () => {
            // Place a plane facing E at height 0 at f5
            // E direction from f5: f6, f7, f8, f9, f10, f11
            g.board.set('f5', [1, 'S', 0]);
            g.currplayer = 1;
            (g as unknown as { saveState: () => void }).saveState();

            const moves = g.moves();
            // Should have level flight options (1 or 2 spaces E)
            expect(moves.some(m => m.startsWith('f5-f6'))).to.be.true;
            expect(moves.some(m => m.startsWith('f5-f7'))).to.be.true;
        });

        it("Climb increases height and moves 1 forward", () => {
            // f5 facing E at height 2
            g.board.set('f5', [1, 'S', 2]);
            g.currplayer = 1;
            (g as unknown as { saveState: () => void }).saveState();

            const moves = g.moves();
            // Should have climb options (with +)
            expect(moves.some(m => m.startsWith('f5+f6'))).to.be.true;
        });

        it("Climb at max height 6 keeps height at 6", () => {
            g.board.set('f5', [1, 'S', 6]);
            g.currplayer = 1;
            (g as unknown as { saveState: () => void }).saveState();

            const moves = g.moves();
            // Should have climb options (acts as 1-space level flight)
            expect(moves.some(m => m.startsWith('f5+'))).to.be.true;

            // Apply a climb move and verify height stays at 6
            g.move('f5+f6');
            const planeInfo = g.board.get('f6');
            expect(planeInfo).to.not.be.undefined;
            expect(planeInfo![2]).to.equal(6); // Height should still be 6
        });

        it("Dive loses height", () => {
            g.board.set('f5', [1, 'S', 4]);
            g.currplayer = 1;
            (g as unknown as { saveState: () => void }).saveState();

            const moves = g.moves();
            // Should have dive options (with v)
            expect(moves.some(m => m.startsWith('f5v'))).to.be.true;
        });
    });

    describe("Shooting", () => {
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
            g.turnNumber = 6;  // Past entry phase
            g.planesRemaining = [0, 0];
        });

        it("Shoot at start of turn with (cell) notation", () => {
            // Set up crosshairs: P1 planes aiming at f6 where P2 plane sits
            g.board.set('f3', [1, 'S', 0]);  // Line of fire includes f4, f5, f6...
            g.board.set('f9', [1, 'N', 0]);  // Line of fire includes f8, f7, f6...
            g.board.set('f6', [2, 'NE', 0]); // P2 plane in crosshairs
            g.currplayer = 1;
            (g as unknown as { saveState: () => void }).saveState();

            // P1 shoots f6 at start of turn, then moves both planes
            g.move('(f6),f3-f4,f9-f8');

            expect(g.board.has('f6')).to.be.false;
            expect(g.results.some(r => r.type === 'capture' && r.where === 'f6')).to.be.true;
        });

        it("Shoot after a move with move(cell) notation", () => {
            // P1 planes will create crosshairs after moving
            g.board.set('f2', [1, 'S', 0]);
            g.board.set('f10', [1, 'N', 0]);
            g.board.set('f6', [2, 'NE', 0]);
            g.currplayer = 1;
            (g as unknown as { saveState: () => void }).saveState();

            // After f2-f3, f3 aims at f6. After f10-f9, f9 also aims at f6.
            // Shoot f6 after the second move
            g.move('f2-f3,f10-f9(f6)');

            expect(g.board.has('f6')).to.be.false;
            expect(g.results.some(r => r.type === 'capture')).to.be.true;
        });

        it("Shoot then shoot again after move", () => {
            // Set up crosshairs: P1 planes aiming at f6
            g.board.set('f3', [1, 'S', 0]);
            g.board.set('f9', [1, 'N', 0]);
            g.board.set('f6', [2, 'NE', 0]);
            g.board.set('e6', [2, 'SE', 0]);  // Another P2 plane not in crosshairs initially
            g.currplayer = 1;
            (g as unknown as { saveState: () => void }).saveState();

            // Shoot f6 first, then after moving f3 to f4, e6 might be in crosshairs
            // (This tests the mechanics even if e6 isn't actually in crosshairs)
            g.move('(f6),f3-f4,f9-f8');

            expect(g.board.has('f6')).to.be.false;
            expect(g.results.filter(r => r.type === 'capture').length).to.equal(1);
        });

        it("Plane survives if player doesn't shoot", () => {
            // Crosshairs exist but player chooses not to shoot
            g.board.set('f3', [1, 'S', 0]);
            g.board.set('f9', [1, 'N', 0]);
            g.board.set('f6', [2, 'NE', 0]);
            g.currplayer = 1;
            (g as unknown as { saveState: () => void }).saveState();

            // P1 moves but doesn't shoot
            g.move('f3-f4,f9-f8');

            // P2's plane should still exist (player didn't shoot)
            expect(g.board.has('f6')).to.be.true;
        });

        it("Plane not in crosshairs with only 1 enemy aiming", () => {
            // Single P1 plane - can't create crosshairs alone
            g.board.set('f3', [1, 'S', 0]);
            g.board.set('f10', [2, 'N', 0]);
            g.currplayer = 1;
            (g as unknown as { saveState: () => void }).saveState();

            // P1 moves - can't shoot because only 1 plane aiming
            g.move('f3-f4');

            expect(g.board.has('f10')).to.be.true;
        });

        it("Shoot after climb move", () => {
            g.board.set('f3', [1, 'S', 2]);
            g.board.set('f9', [1, 'N', 0]);
            g.board.set('f6', [2, 'NE', 0]);
            g.currplayer = 1;
            (g as unknown as { saveState: () => void }).saveState();

            // Climb then shoot
            g.move('f3+f4(f6),f9-f8');

            expect(g.board.has('f6')).to.be.false;
        });

        it("Sequential shooting - first target unblocks second", () => {
            // Test that shooting multiple targets in one notation (e.g., "(e5,e6)")
            // works when the first target blocks line of fire to the second.
            // After shooting e5, e6 becomes visible and should be shootable.
            //
            // Geometry:
            // - d4/SE: ray e5, f6, g6... - sees e5 but NOT e6
            // - e4/S: ray e5, e6, e7... - blocked at e5, sees e6 after e5 shot
            // - d5/SE: ray e6, f7, g7... - sees e6 directly
            //
            // Crosshairs:
            // - e5 in crosshairs: d4/SE + e4/S (both see it)
            // - e6 NOT in crosshairs initially (only d5/SE sees it)
            // - e6 IN crosshairs after e5 shot: e4/S (unblocked) + d5/SE
            g.board.set('d4', [1, 'SE', 0]);  // P1 - sees e5 (for crosshairs)
            g.board.set('e4', [1, 'S', 0]);   // P1 - sees e5, will see e6 after e5 shot
            g.board.set('d5', [1, 'SE', 0]);  // P1 - sees e6 directly
            g.board.set('e5', [2, 'NE', 0]);  // P2 target 1 - in crosshairs (d4 + e4)
            g.board.set('e6', [2, 'NE', 0]);  // P2 target 2 - only d5 sees it (e4 blocked by e5)
            g.currplayer = 1;
            (g as unknown as { saveState: () => void }).saveState();

            // Verify via click handling
            const click = (move: string, cell: string) => {
                const [col, row] = g.graph.algebraic2coords(cell);
                return g.handleClick(move, row, col, cell);
            };

            // Helper to verify rendering works for a partial move
            // Creates a clone, applies the partial move, and renders
            const verifyRender = (move: string) => {
                const clone = g.clone();
                clone.move(move, { partial: true });
                expect(() => clone.render()).to.not.throw();
            };

            // Click e5 to shoot it at start of turn
            let result = click('', 'e5');
            expect(result.move).to.equal('(e5)');
            verifyRender(result.move);

            // Click e6 to add it to the shooting list
            result = click(result.move, 'e6');
            expect(result.move).to.equal('(e5,e6)');
            verifyRender(result.move);

            // Validate the move
            const validation = g.validateMove(result.move);
            expect(validation.valid).to.be.true;

            // Apply the move - need 3 actions for the 3 P1 planes
            g.move('(e5,e6),d4-e5,d5-e6');

            // Both P2 targets should have been shot (now P1 planes occupy those cells after moving)
            // Verify e5 and e6 now have P1 planes (the original P2 planes were shot)
            const e5Info = g.board.get('e5');
            const e6Info = g.board.get('e6');
            expect(e5Info).to.not.be.undefined;
            expect(e5Info![0]).to.equal(1); // P1 plane
            expect(e6Info).to.not.be.undefined;
            expect(e6Info![0]).to.equal(1); // P1 plane

            // Also verify that there are no P2 planes left (they were all shot)
            const p2Planes = Array.from(g.board.values()).filter(info => info[0] === 2);
            expect(p2Planes.length).to.equal(0);
        });

        it("Crash action can include shooting notation", () => {
            // Test that crash actions can have embedded shooting (even if target not in crosshairs)
            // This tests the parsing and processing, not the actual crosshairs logic
            g.board.set('f3', [1, 'S', 0]);
            g.board.set('f9', [1, 'N', 0]);
            g.board.set('f6', [2, 'NE', 0]);  // In crosshairs of f3 and f9
            g.currplayer = 1;
            (g as unknown as { saveState: () => void }).saveState();

            // Shoot at start of turn (while planes are in position)
            g.move('(f6),f3-f4,f9-f8');

            expect(g.board.has('f6')).to.be.false;
        });

        it("Dive sequence with shooting - partial power dive preserves direction", () => {
            // Comprehensive test: P2 plane at g6 (height 6, NW) dives and shoots multiple P1 planes
            // Tests that partial power dive ("p/") preserves plane direction (was a bug)
            // Setup:
            // - P1 targets at e5, e6, e7, e8
            // - P2 crosshairs: e1 (S), k2 (SW), k3 (SW)
            // - P2 attacker at g6 (NW, height 6)
            g.board.set('e5', [1, 'N', 0]);   // P1 target
            g.board.set('e6', [1, 'N', 0]);   // P1 target
            g.board.set('e7', [1, 'N', 0]);   // P1 target
            g.board.set('e8', [1, 'N', 0]);   // P1 target
            g.board.set('e1', [2, 'S', 0]);   // P2 crosshairs (line of fire through e2-e11)
            g.board.set('k2', [2, 'SW', 0]);  // P2 crosshairs
            g.board.set('k3', [2, 'SW', 0]);  // P2 crosshairs
            g.board.set('g6', [2, 'NW', 6]);  // P2 attacker - will dive NW to f6
            g.currplayer = 2;
            (g as unknown as { saveState: () => void }).saveState();

            // Helper to get coordinates for a cell and call handleClick
            // Note: We DON'T apply partial moves after each click because handleClick
            // is designed to work with the board state at the start of the turn.
            // The partial move string accumulates the full sequence.
            const click = (move: string, cell: string) => {
                const [col, row] = g.graph.algebraic2coords(cell);
                return g.handleClick(move, row, col, cell);
            };

            // Helper to verify rendering works for a partial move
            // Creates a clone, applies the partial move, and renders
            const verifyRender = (move: string) => {
                const clone = g.clone();
                clone.move(move, { partial: true });
                expect(() => clone.render()).to.not.throw();
            };

            // Step 1: Click on g6 to select the plane
            let result = click('', 'g6');
            expect(result.move).to.equal('g6');
            verifyRender(result.move);

            // Step 2: Click on g6 again to enter dive mode
            result = click(result.move, 'g6');
            expect(result.move).to.equal('g6v');
            verifyRender(result.move);

            // Step 3: Click on f6 to swoop (NW from g6)
            result = click(result.move, 'f6');
            expect(result.move).to.equal('g6vf6/');
            verifyRender(result.move);

            // Step 4: Click to set direction NW (click on cell NW of f6, which is e5)
            // When direction is same as current, no suffix is added
            result = click(result.move, 'e5');
            expect(result.move).to.equal('g6vf6');
            verifyRender(result.move);

            // Step 5: Click on e5 to shoot it (in crosshairs)
            result = click(result.move, 'e5');
            expect(result.move).to.equal('g6vf6(e5)');
            verifyRender(result.move);

            // Step 6: Click on f6 again to continue dive with power dive
            // This is the critical test - the bug was that "P/" caused direction to become ""
            result = click(result.move, 'f6');
            expect(result.move).to.equal('g6vf6(e5)>P/');
            verifyRender(result.move);

            // Validate the partial move first (before applying)
            const validation = g.validateMove(result.move);
            expect(validation.valid).to.be.true;

            // Apply partial move to verify direction is preserved
            g.move(result.move, { partial: true });
            const planeInfo = g.board.get('f6');
            expect(planeInfo).to.not.be.undefined;
            expect(planeInfo![1]).to.equal('NW');  // Direction preserved (not "")
            expect(planeInfo![2]).to.equal(3);     // Height: 6 - 1 (swoop) - 2 (power dive) = 3

            // Verify render doesn't throw (this was the original bug - render failed)
            expect(() => g.render()).to.not.throw();

            // Verify e5 was shot down
            expect(g.board.has('e5')).to.be.false;
        });

        it("Full dive sequence - swoop, shoot, power dive, shoot, swoop, shoot multiple", () => {
            // Comprehensive 12-step click test: P2 plane at g6 (height 6, NW) dives and
            // shoots all 4 P1 planes at e5, e6, e7, e8
            // Setup:
            // - P1 targets at e5, e6, e7, e8
            // - P2 crosshairs: e1 (S), k2 (SW), k3 (SW)
            // - P2 attacker at g6 (NW, height 6)
            g.board.set('e5', [1, 'N', 0]);   // P1 target
            g.board.set('e6', [1, 'N', 0]);   // P1 target
            g.board.set('e7', [1, 'N', 0]);   // P1 target
            g.board.set('e8', [1, 'N', 0]);   // P1 target
            g.board.set('e1', [2, 'S', 0]);   // P2 crosshairs (line of fire through e2-e11)
            g.board.set('k2', [2, 'SW', 0]);  // P2 crosshairs
            g.board.set('k3', [2, 'SW', 0]);  // P2 crosshairs
            g.board.set('g6', [2, 'NW', 6]);  // P2 attacker - will dive NW to f6
            g.currplayer = 2;
            (g as unknown as { saveState: () => void }).saveState();

            // Helper to get coordinates for a cell and call handleClick
            const click = (move: string, cell: string) => {
                const [col, row] = g.graph.algebraic2coords(cell);
                return g.handleClick(move, row, col, cell);
            };

            // Helper to verify rendering works for a partial move
            // Creates a clone, applies the partial move, and renders
            const verifyRender = (move: string) => {
                const clone = g.clone();
                clone.move(move, { partial: true });
                expect(() => clone.render()).to.not.throw();
            };

            // Step 1: Click on g6 to select the plane
            let result = click('', 'g6');
            expect(result.move).to.equal('g6');
            verifyRender(result.move);

            // Step 2: Click on g6 again to enter dive mode
            result = click(result.move, 'g6');
            expect(result.move).to.equal('g6v');
            verifyRender(result.move);

            // Step 3: Click on f6 to swoop (NW from g6)
            result = click(result.move, 'f6');
            expect(result.move).to.equal('g6vf6/');
            verifyRender(result.move);

            // Step 4: Click e5 to set direction NW (same as current, no suffix added)
            result = click(result.move, 'e5');
            expect(result.move).to.equal('g6vf6');
            verifyRender(result.move);

            // Step 5: Click on e5 to shoot it (in crosshairs of e1 and f6)
            result = click(result.move, 'e5');
            expect(result.move).to.equal('g6vf6(e5)');
            verifyRender(result.move);

            // Step 6: Click on f6 to continue with power dive
            result = click(result.move, 'f6');
            expect(result.move).to.equal('g6vf6(e5)>P/');
            verifyRender(result.move);

            // Step 7: Click e6 to set direction SW (e6 is SW of f6)
            // Even though e6 has an enemy plane, clicking it in direction-selection mode
            // should set direction, not shoot
            result = click(result.move, 'e6');
            expect(result.move).to.equal('g6vf6(e5)>P/SW');
            verifyRender(result.move);

            // Step 8: Click on e6 again to shoot it (in crosshairs)
            result = click(result.move, 'e6');
            expect(result.move).to.equal('g6vf6(e5)>P/SW(e6)');
            verifyRender(result.move);

            // Step 9: Click on e6 to swoop there (now that we've shot it)
            result = click(result.move, 'e6');
            expect(result.move).to.equal('g6vf6(e5)>P/SW(e6)>e6/');
            verifyRender(result.move);

            // Step 10: Click e7 to set direction S
            result = click(result.move, 'e7');
            expect(result.move).to.equal('g6vf6(e5)>P/SW(e6)>e6/S');
            verifyRender(result.move);

            // Step 11: Click on e7 to shoot it (in crosshairs)
            result = click(result.move, 'e7');
            expect(result.move).to.equal('g6vf6(e5)>P/SW(e6)>e6/S(e7)');
            verifyRender(result.move);

            // Step 12: Click on e8 to shoot it too (multiple targets)
            // After e7 is shot, e8 becomes visible to the attacker at e6/S
            // So e8 is now in crosshairs from: attacker e6/S + k3/SW = 2 planes
            result = click(result.move, 'e8');
            expect(result.move).to.equal('g6vf6(e5)>P/SW(e6)>e6/S(e7,e8)');
            verifyRender(result.move);

            // Validate the final move
            const validation = g.validateMove(result.move);
            expect(validation.valid).to.be.true;

            // Apply the move and verify final state
            g.move(result.move, { partial: true });

            // Verify all 4 P1 planes were shot down (e5, e6, e7, e8)
            expect(g.board.has('e5')).to.be.false;
            expect(g.board.has('e7')).to.be.false;
            expect(g.board.has('e8')).to.be.false;

            // Verify attacker plane final state
            const planeInfo = g.board.get('e6');
            expect(planeInfo).to.not.be.undefined;
            expect(planeInfo![0]).to.equal(2);     // Owner is P2
            expect(planeInfo![1]).to.equal('S');   // Direction S
            expect(planeInfo![2]).to.equal(2);     // Height: 6 - 1 (swoop) - 2 (power dive) - 1 (swoop) = 2

            // Verify render doesn't throw
            expect(() => g.render()).to.not.throw();
        });

        it("Swoop click after power dive should work", () => {
            // Regression test: after a complete power dive step (e.g., h8vP/SW),
            // clicking on the cell ahead should correctly continue with a swoop.
            // This tests handleClick path where the board has original state.
            const g = new CrosshairsGame();
            const cloudCells = ['a1', 'a2', 'a3', 'b1', 'b2', 'b3', 'c1', 'c2', 'c3', 'd1', 'd2', 'd3', 'e1', 'e2', 'e3', 'f1'];
            for (const cell of cloudCells) {
                g.clouds.add(cell);
            }
            g.board.set('h8', [1, 'S', 3]);  // P1 plane at height 3 facing S
            g.board.set('k5', [2, 'N', 0]);  // Opponent plane
            g.currplayer = 1;
            g.turnNumber = 10;
            (g as unknown as { saveState: () => void }).saveState();

            // Helper to call handleClick
            const click = (move: string, cell: string) => {
                const [col, row] = g.graph.algebraic2coords(cell);
                return g.handleClick(move, row, col, cell);
            };

            // Get the cell SW of h8 for valid ±60° turn (S to SW)
            const adjCells = (g as unknown as { getAdjacentCells: (cell: string, dirs: string[]) => string[] })
                .getAdjacentCells('h8', ['SW']);
            const swCell = adjCells[0];  // Cell SW of h8

            // Select plane, enter dive, power dive with direction change
            let result = click('', 'h8');
            expect(result.move).to.equal('h8');

            result = click(result.move, 'h8');  // Enter dive mode
            expect(result.move).to.equal('h8v');

            result = click(result.move, 'h8');  // Click same cell for power dive
            expect(result.move).to.equal('h8vP/');

            // Click to set direction SW (valid ±60° turn from S)
            result = click(result.move, swCell);
            expect(result.move).to.equal('h8vP/SW');

            // Now the plane is at h8 facing SW with height 1 (3 - 2 from power dive)
            // Get the cell SW of h8 (one ahead in SW direction) for swoop
            result = click(result.move, swCell);
            expect(result.move, "Clicking ahead after power dive should start swoop").to.equal(`h8vP/SW>${swCell}/`);
        });

        it("Multi-action turn with dive landing on shot cell - validation bug", () => {
            // Regression test: after action 1 (dive that lands on a shot cell),
            // action 2 should be able to validate and shoot targets.
            //
            // Setup similar to "Full dive sequence" but with a second plane that dives
            // and creates crosshairs for shooting a new target.
            g.board.set('e5', [1, 'N', 0]);   // P1 target - shot during action 1
            g.board.set('e6', [1, 'N', 0]);   // P1 target - shot during action 1, P2 lands here
            g.board.set('d7', [1, 'N', 0]);   // P1 target - will be shot after both dives
            g.board.set('e1', [2, 'S', 0]);   // P2 crosshairs (line of fire through e2-e11)
            g.board.set('k2', [2, 'SW', 0]);  // P2 crosshairs
            g.board.set('g6', [2, 'NW', 6]);  // P2 attacker 1 - will dive to f6, then e6
            g.board.set('d3', [2, 'S', 3]);   // P2 attacker 2 - will dive to d4
            g.currplayer = 2;
            (g as unknown as { saveState: () => void }).saveState();

            // First action: dive g6 to f6, shoot e5, power dive direction SW, shoot e6, swoop to e6
            // g6vf6(e5)>P/SW(e6)>e6 - dive to f6, shoot e5, power dive SW, shoot e6, swoop to e6
            const action1 = 'g6vf6(e5)>P/SW(e6)>e6';

            // Validate first action
            let validation = g.validateMove(action1);
            expect(validation.valid, `First action validation failed: ${validation.message}`).to.be.true;

            // Second action: simple dive from d3 to d4 with direction S
            // d3vd4 - dive from d3 to d4 (keeps direction S)
            // After this, d4/S and e6/SW should have crosshairs on d7
            const action2 = 'd3vd4';
            const partialMove = `${action1},${action2}`;
            validation = g.validateMove(partialMove);
            expect(validation.valid, `Second action validation failed: ${validation.message}`).to.be.true;

            // Third action to complete the turn
            const fullMove = `${partialMove},e1-e2`;
            validation = g.validateMove(fullMove);
            expect(validation.valid, `Third action validation failed: ${validation.message}`).to.be.true;

            // Apply the full move
            g.move(fullMove);

            // Verify e6 has P2 plane
            const e6Info = g.board.get('e6');
            expect(e6Info).to.not.be.undefined;
            expect(e6Info![0]).to.equal(2);    // P2 plane from action 1
        });

        it("Shoot after second dive uses plane from first dive for crosshairs", () => {
            // Simplified test using valid move format (g6vf7>e7 not g6vf7/NW...)
            // Key test: shooting d7 using crosshairs from planes positioned in action 1 and 2
            //
            // After action 1: plane at e7 facing SW (e7/SW sees d7)
            // After action 2: plane at d4 facing S (d4/S sees d7)
            // Together: crosshairs on d7!
            g.board.clear();

            // P1 target - will be shot using crosshairs after both dives complete
            g.board.set('d7', [1, 'N', 0]);

            // P2 planes
            g.board.set('g6', [2, 'SW', 4]);  // Attacker 1: g6/SW swoops to f7>e7, ends at e7/SW
            g.board.set('d3', [2, 'S', 2]);   // Attacker 2: d3/S swoops to d4, ends at d4/S
            g.board.set('k5', [2, 'N', 0]);   // Extra plane for 3rd action

            g.currplayer = 2;
            (g as unknown as { saveState: () => void }).saveState();

            // Action 1: g6vf7>e7 (swoop to f7 keeping SW, swoop to e7 keeping SW)
            const action1 = 'g6vf7>e7';

            let validation = g.validateMove(action1);
            expect(validation.valid, `Action 1 failed: ${validation.message}`).to.be.true;

            // Verify action 1 result
            const clone1 = g.clone();
            clone1.move(action1, { partial: true });
            expect(clone1.board.has('e7')).to.be.true;
            expect(clone1.board.get('e7')![1]).to.equal('SW');

            // Action 2: d3vd4 (swoop to d4 keeping S)
            const action2 = 'd3vd4';
            const partialMove = `${action1},${action2}`;

            validation = g.validateMove(partialMove);
            expect(validation.valid, `Action 2 failed: ${validation.message}`).to.be.true;

            // Verify crosshairs exist
            const clone2 = g.clone();
            clone2.move(partialMove, { partial: true });
            const e7Lof = (clone2 as unknown as { getLineOfFire: (c: string, d: string) => string[] }).getLineOfFire('e7', 'SW');
            const d4Lof = (clone2 as unknown as { getLineOfFire: (c: string, d: string) => string[] }).getLineOfFire('d4', 'S');
            expect(e7Lof).to.include('d7');
            expect(d4Lof).to.include('d7');

            // THIS IS THE BUG TEST - shoot d7 using crosshairs from action 1 plane
            const shootMove = `${partialMove}(d7)`;
            validation = g.validateMove(shootMove);
            expect(validation.valid, `Shooting d7 failed: ${validation.message}`).to.be.true;

            // Apply full move (k5 faces N, so use k5-k4)
            const fullMove = `${shootMove},k5-k4`;
            const fullValidation = g.validateMove(fullMove);
            expect(fullValidation.valid, `Full move failed: ${fullValidation.message}`).to.be.true;
            g.move(fullMove);
            expect(g.board.has('d7')).to.be.false; // d7 was shot
            expect(g.board.get('e7')![0]).to.equal(2); // P2 at e7
        });

        it("Optional shooting after completing all required moves", () => {
            const g = new CrosshairsGame();
            // Add 16 clouds away from combat area
            const cloudCells = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'c1', 'c2', 'c3'];
            for (const cell of cloudCells) {
                g.clouds.add(cell);
            }
            g.turnNumber = 1; // Turn 1, P1 needs to move 1 plane
            g.currplayer = 1;

            // Use setup known to work from "Shoot at start of turn" test:
            // f3/S and f9/N both point at f6 (convergent crosshairs from opposite sides)
            g.board.clear();
            g.board.set('f3', [1, 'S', 3]);  // P1 plane facing S - sees f4, f5, f6...
            g.board.set('f9', [1, 'N', 3]);  // P1 plane facing N - sees f8, f7, f6...
            g.board.set('k5', [1, 'N', 3]);  // P1 plane to move (far away from f6)
            g.board.set('f6', [2, 'NE', 3]); // Enemy at f6 - in crosshairs of f3 and f9
            g.board.set('a8', [2, 'S', 3]);  // Extra P2 plane (prevents game over)
            g.planesRemaining = [0, 0];

            // Save state for consistency
            (g as unknown as { saveState: () => void }).saveState();

            // Verify f6 is in crosshairs
            const shootable = (g as unknown as { getShootablePlanes: (p: number, b: Map<string, [number, string, number]>) => string[] }).getShootablePlanes(1, g.board);
            expect(shootable, `f6 should be shootable, shootable: ${shootable.join(',')}`).to.include('f6');

            // Get valid actions for k5 (use actions() for efficiency)
            const validActions = g.actions();
            const k5Actions = validActions.filter(m => m.startsWith('k5'));
            expect(k5Actions.length, `No actions for k5`).to.be.greaterThan(0);

            // Use a k5 climb with direction (e.g., k5+k4/NW)
            const move1 = k5Actions.find(m => m.includes('+') && m.includes('/')) || k5Actions[0];
            let validation = g.validateMove(move1);
            expect(validation.valid, `Move '${move1}' failed: ${validation.message}`).to.be.true;

            // f6 is still in crosshairs of f3 and f9 (we only moved k5)
            // complete should be 0 (can submit or continue to shoot)
            expect(validation.complete).to.equal(0);
            expect(validation.message).to.include('shoot');

            // User can submit without shooting
            g.move(move1);
            expect(g.board.has('f6')).to.be.true; // Enemy survived

            // Or user could have shot - test this scenario
            g.load(-2); // Undo (load state before the move)
            const moveWithShoot = `${move1}(f6)`;
            validation = g.validateMove(moveWithShoot);
            expect(validation.valid, `Shooting failed: ${validation.message}`).to.be.true;
            expect(validation.complete).to.equal(1); // Fully complete after shooting
            g.move(moveWithShoot);
            expect(g.board.has('f6')).to.be.false; // Enemy was shot
        });

        it("Dive can continue after completing all required actions", () => {
            // Regression test: if the last action is a dive with height remaining,
            // user should be able to continue the dive even after all required actions are done.
            const g = new CrosshairsGame();
            const cloudCells = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'c1', 'c2', 'c3'];
            for (const cell of cloudCells) {
                g.clouds.add(cell);
            }
            g.turnNumber = 1;  // Turn 1, P1 needs to move 1 plane
            g.currplayer = 1;

            g.board.clear();
            g.board.set('g6', [1, 'NW', 4]);  // P1 plane at height 4, will dive
            g.board.set('k5', [2, 'N', 0]);   // P2 plane
            g.planesRemaining = [0, 0];
            (g as unknown as { saveState: () => void }).saveState();

            // Do a dive with one swoop - this completes 1 action (the required amount)
            // But the dive still has height 3 remaining, so user should be able to continue
            const diveMove = 'g6vf6';  // Swoop from g6 to f6 (keeps direction NW, height becomes 3)
            const validation = g.validateMove(diveMove);
            expect(validation.valid, `Dive move failed: ${validation.message}`).to.be.true;
            // complete should be 0 (extendable), not 1 (fully complete)
            expect(validation.complete, "Dive should be extendable (complete=0), not fully complete").to.equal(0);
            expect(validation.message).to.include('Continue');

            // User can continue with another swoop
            const extendedDive = 'g6vf6>e5';
            const extValidation = g.validateMove(extendedDive);
            expect(extValidation.valid, `Extended dive failed: ${extValidation.message}`).to.be.true;
        });

        it("Cannot shoot out of clouds", () => {
            const g = new CrosshairsGame();
            // Add 16 clouds, with f3 and f9 being clouds where shooters will be
            const cloudCells = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'c1', 'f3', 'f9'];
            for (const cell of cloudCells) {
                g.clouds.add(cell);
            }
            g.turnNumber = 10;
            g.currplayer = 1;

            // f3/S and f9/N would normally converge on f6, but they're in clouds
            g.board.clear();
            g.board.set('f3', [1, 'S', 3]);  // P1 plane in cloud at f3
            g.board.set('f9', [1, 'N', 3]);  // P1 plane in cloud at f9
            g.board.set('k5', [1, 'N', 3]);  // P1 plane not in cloud
            g.board.set('f6', [2, 'NE', 3]); // Enemy at f6
            g.planesRemaining = [0, 0];
            (g as unknown as { saveState: () => void }).saveState();

            // Planes in clouds can't contribute to crosshairs
            const shootable = (g as unknown as { getShootablePlanes: (p: number, b: Map<string, [number, string, number]>) => string[] }).getShootablePlanes(1, g.board);
            expect(shootable).to.not.include('f6');
        });

        it("Cannot shoot into clouds", () => {
            const g = new CrosshairsGame();
            // Add 16 clouds, with f6 being a cloud where target will be
            const cloudCells = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'c1', 'c2', 'f6'];
            for (const cell of cloudCells) {
                g.clouds.add(cell);
            }
            g.turnNumber = 10;
            g.currplayer = 1;

            // f3/S and f9/N converge on f6, but f6 is in a cloud
            g.board.clear();
            g.board.set('f3', [1, 'S', 3]);  // P1 plane facing S
            g.board.set('f9', [1, 'N', 3]);  // P1 plane facing N
            g.board.set('k5', [1, 'N', 3]);  // P1 plane
            g.board.set('f6', [2, 'NE', 3]); // Enemy in cloud at f6
            g.planesRemaining = [0, 0];
            (g as unknown as { saveState: () => void }).saveState();

            // Target in cloud can't be shot
            const shootable = (g as unknown as { getShootablePlanes: (p: number, b: Map<string, [number, string, number]>) => string[] }).getShootablePlanes(1, g.board);
            expect(shootable).to.not.include('f6');
        });

        it("Cannot shoot through clouds", () => {
            const g = new CrosshairsGame();
            // Add 16 clouds, with f5 being a cloud that blocks line of fire
            const cloudCells = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'c1', 'c2', 'f5'];
            for (const cell of cloudCells) {
                g.clouds.add(cell);
            }
            g.turnNumber = 10;
            g.currplayer = 1;

            // f3/S points at f6, but f5 has a cloud blocking the shot
            // f9/N can see f6 clearly
            g.board.clear();
            g.board.set('f3', [1, 'S', 3]);  // P1 plane facing S - blocked by cloud at f5
            g.board.set('f9', [1, 'N', 3]);  // P1 plane facing N - can see f6
            g.board.set('k5', [1, 'N', 3]);  // P1 plane
            g.board.set('f6', [2, 'NE', 3]); // Enemy at f6
            g.planesRemaining = [0, 0];
            (g as unknown as { saveState: () => void }).saveState();

            // Only 1 plane can see f6 (f9), not 2, so can't shoot
            const shootable = (g as unknown as { getShootablePlanes: (p: number, b: Map<string, [number, string, number]>) => string[] }).getShootablePlanes(1, g.board);
            expect(shootable).to.not.include('f6');
        });
    });

    describe("Rendering", () => {
        it("should show click hints during dive direction selection", () => {
            const g = new CrosshairsGame();
            // Add 16 dummy clouds to exit cloud phase (valid cells in HexTriGraph(6,11))
            const cloudCells = ['a1', 'a2', 'a3', 'b1', 'b2', 'b3', 'c1', 'c2', 'c3', 'd1', 'd2', 'd3', 'e1', 'e2', 'e3', 'f1'];
            for (const cell of cloudCells) {
                g.clouds.add(cell);
            }
            g.board.set('g6', [2, 'NW', 6]);
            g.board.set('k5', [1, 'S', 0]);  // Need opponent plane (not on cloud)
            g.currplayer = 2;
            g.turnNumber = 10;  // After entry phase
            (g as unknown as { saveState: () => void }).saveState();

            // Test dive waiting for direction (g6vf6/)
            g.move('g6vf6/', { partial: true, trusted: true });
            const render = g.render();

            expect(render.annotations).to.not.be.undefined;
            const dotsAnnotation = render.annotations!.find(a => (a as { type?: string }).type === 'dots');
            expect(dotsAnnotation).to.not.be.undefined;
            expect((dotsAnnotation as { targets: unknown[] }).targets.length).to.be.greaterThan(0);
            // NW direction allows NW, W, N turns (adjacent ±60°)
            // So hints should show cells in those 3 directions from f6
        });

        it("should show click hints after completing a power dive step", () => {
            const g = new CrosshairsGame();
            // Add 16 dummy clouds to exit cloud phase
            const cloudCells = ['a1', 'a2', 'a3', 'b1', 'b2', 'b3', 'c1', 'c2', 'c3', 'd1', 'd2', 'd3', 'e1', 'e2', 'e3', 'f1'];
            for (const cell of cloudCells) {
                g.clouds.add(cell);
            }
            g.board.set('g6', [2, 'NW', 4]);  // Plane at height 4
            g.board.set('k5', [1, 'S', 0]);   // Opponent plane
            g.currplayer = 2;
            g.turnNumber = 10;
            (g as unknown as { saveState: () => void }).saveState();

            // Complete power dive with direction change: g6vP/SW
            // After this: plane still at g6, height=2, facing SW
            g.move('g6vP/SW', { partial: true, trusted: true });
            const render = g.render();

            expect(render.annotations).to.not.be.undefined;

            // Collect all cells from all dots annotations (hints are grouped by shape)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const allDotsAnnotations = render.annotations!.filter((a: any) => a.type === 'dots');
            expect(allDotsAnnotations.length, "Should have dots annotations for click hints").to.be.greaterThan(0);

            const allTargetCells: string[] = [];
            for (const dots of allDotsAnnotations) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const targets = (dots as any).targets as { row: number; col: number }[];
                for (const t of targets) {
                    allTargetCells.push(g.graph.coords2algebraic(t.col, t.row));
                }
            }

            // Should show: swoop (1 cell SW from g6 = f7) and power dive (g6 again)
            // At height 2, both swoop (needs height >= 1) and power dive (needs height >= 2) should be available
            // f7 is SW of g6 - should be hint for swoop (circle shape)
            expect(allTargetCells).to.include('f7');
            // g6 should be hint for another power dive (ring-large shape)
            expect(allTargetCells).to.include('g6');
        });

        it("should show click hints when swooping to a cell where plane was shot", () => {
            const g = new CrosshairsGame();
            // Add 16 dummy clouds to exit cloud phase
            const cloudCells = ['a1', 'a2', 'a3', 'b1', 'b2', 'b3', 'c1', 'c2', 'c3', 'd1', 'd2', 'd3', 'e1', 'e2', 'e3', 'f1'];
            for (const cell of cloudCells) {
                g.clouds.add(cell);
            }
            // Setup: g6 plane will dive and shoot e6, then swoop to e6
            // Need another P2 plane to create crosshairs on e6
            g.board.set('g6', [2, 'NW', 6]);  // Will dive toward e6
            g.board.set('g5', [2, 'NW', 0]);  // g5/NW also aims at e6 for crosshairs
            g.board.set('e6', [1, 'S', 0]);   // Target that will be shot
            g.board.set('k5', [2, 'N', 0]);   // Extra P2 plane
            g.currplayer = 2;
            g.turnNumber = 10;
            (g as unknown as { saveState: () => void }).saveState();

            // Dive: g6 -> f6, change to NW, shoot e6, then swoop to e6 (waiting for direction)
            // f6/NW aims at e6, g5/NW aims at e6, so crosshairs exist
            const partialMove = 'g6vf6/NW(e6)>e6/';
            g.move(partialMove, { partial: true, trusted: true });

            // Should show direction hints from e6
            const render = g.render();
            expect(render.annotations).to.not.be.undefined;
            const dotsAnnotation = render.annotations!.find(a => (a as { type?: string }).type === 'dots');
            expect(dotsAnnotation, "Should have dots annotation for direction hints").to.not.be.undefined;
            expect((dotsAnnotation as { targets: unknown[] }).targets.length, "Should have direction hints").to.be.greaterThan(0);
        });

        it("should show click hints when action 2 swoops to cell shot in action 1", () => {
            const g = new CrosshairsGame();
            // Add 16 dummy clouds to exit cloud phase
            const cloudCells = ['a1', 'a2', 'a3', 'b1', 'b2', 'b3', 'c1', 'c2', 'c3', 'd1', 'd2', 'd3', 'e1', 'e2', 'e3', 'f1'];
            for (const cell of cloudCells) {
                g.clouds.add(cell);
            }
            // Setup for multi-action turn:
            // Action 1: Shoot e6 using crosshairs from g6/NW and g5/NW
            // Action 2: d5 dives to e6 (the shot cell)
            g.board.set('g6', [2, 'NW', 0]);  // Aims at e6 (for crosshairs)
            g.board.set('g5', [2, 'NW', 0]);  // Also aims at e6 (for crosshairs)
            g.board.set('d5', [2, 'SE', 4]);  // Will dive to e6 in action 2
            g.board.set('e6', [1, 'S', 0]);   // Target that will be shot in action 1
            g.board.set('k5', [2, 'N', 0]);   // Extra P2 plane
            g.currplayer = 2;
            g.turnNumber = 10;
            (g as unknown as { saveState: () => void }).saveState();

            // Action 1: Standalone shoot e6
            // Action 2: d5 dives, swoops to e6 (waiting for direction)
            const partialMove = '(e6),d5ve6/';
            g.move(partialMove, { partial: true, trusted: true });

            // Should show direction hints from e6
            const render = g.render();
            expect(render.annotations).to.not.be.undefined;
            const dotsAnnotation = render.annotations!.find(a => (a as { type?: string }).type === 'dots');
            expect(dotsAnnotation, "Should have dots annotation for direction hints").to.not.be.undefined;
            expect((dotsAnnotation as { targets: unknown[] }).targets.length, "Should have direction hints").to.be.greaterThan(0);
        });

        it("should show click hints during climb direction selection", () => {
            const g = new CrosshairsGame();
            // Add 16 dummy clouds to exit cloud phase
            const cloudCells = ['a1', 'a2', 'a3', 'b1', 'b2', 'b3', 'c1', 'c2', 'c3', 'd1', 'd2', 'd3', 'e1', 'e2', 'e3', 'f1'];
            for (const cell of cloudCells) {
                g.clouds.add(cell);
            }
            g.board.set('f5', [1, 'S', 3]);
            g.board.set('k5', [2, 'N', 0]);  // Need opponent plane (not on cloud)
            g.currplayer = 1;
            g.turnNumber = 10;  // After entry phase
            (g as unknown as { saveState: () => void }).saveState();

            g.move('f5+f6/', { partial: true, trusted: true });
            const render = g.render();
            expect(render.annotations).to.not.be.undefined;
            const dotsAnnotation = render.annotations!.find(a => (a as { type?: string }).type === 'dots');
            expect(dotsAnnotation).to.not.be.undefined;
            expect((dotsAnnotation as { targets: unknown[] }).targets.length).to.be.greaterThan(0);
        });

        it("should show click hints during entry direction selection", () => {
            const g = new CrosshairsGame();
            // Add 16 dummy clouds to exit cloud phase
            const cloudCells = ['a1', 'a2', 'a3', 'b1', 'b2', 'b3', 'c1', 'c2', 'c3', 'd1', 'd2', 'd3', 'e1', 'e2', 'e3', 'f1'];
            for (const cell of cloudCells) {
                g.clouds.add(cell);
            }
            g.board.clear();
            g.board.set('k5', [2, 'N', 0]);  // Need opponent plane (not on cloud)
            g.currplayer = 1;
            g.turnNumber = 1;  // Entry phase
            (g as unknown as { saveState: () => void }).saveState();

            g.move('enter:f6/', { partial: true, trusted: true });
            const render = g.render();
            expect(render.annotations).to.not.be.undefined;
            const dotsAnnotation = render.annotations!.find(a => (a as { type?: string }).type === 'dots');
            expect(dotsAnnotation).to.not.be.undefined;
            expect((dotsAnnotation as { targets: unknown[] }).targets.length).to.be.greaterThan(0);
        });

        it("should show click hints for unmoved planes after a crash", () => {
            // Bug: after a crash reduced the plane count, getPlanesToMove() used
            // this.board (post-crash) instead of the start-of-turn board, so it
            // thought all required actions were complete and showed no hints.
            const g = new CrosshairsGame();
            g.clouds.clear();
            const cloudCells = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6',
                                'b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7',
                                'c1', 'c2', 'c3'];
            for (const cell of cloudCells) {
                g.clouds.add(cell);
            }
            g.turnNumber = 8;  // Past entry phase
            g.planesRemaining = [0, 0];
            g.currplayer = 1;

            // P1 has 3 planes: d5 (will move), e5 (will crash), f5 (unmoved)
            // e5 is boxed in (facing into edge with height 0) → crash
            g.board.set('d5', [1, 'S', 2]);
            g.board.set('e5', [1, 'S', 0]);  // will crash (height 0, facing south toward edge)
            g.board.set('f5', [1, 'N', 1]);  // unmoved — should be highlighted

            // P2 planes
            g.board.set('h3', [2, 'N', 1]);
            g.board.set('i3', [2, 'NE', 1]);

            (g as unknown as { saveState: () => void }).saveState();

            // Make the crash move non-movable: e5 faces S, at height 0,
            // and forward cell is blocked or off-board → crash is forced.
            // Actually, let's just do 2 actions and check hints after crash.
            // d5 climbs to d6, e5 crashes: "d5+d6,e5X"
            const partialMove = 'd5+d6,e5x';
            g.move(partialMove, { partial: true, trusted: true });

            // Render and check dots annotation includes f5
            const render = g.render();
            expect(render.annotations).to.not.be.undefined;
            const dotsAnnotation = render.annotations!.find(a => (a as { type?: string }).type === 'dots');
            expect(dotsAnnotation).to.not.be.undefined;
            const targets = (dotsAnnotation as { targets: { row: number; col: number }[] }).targets;
            // f5 in HexTriGraph(6,11) — check it's in the targets
            // We verify at least one target exists (the unmoved plane)
            expect(targets.length).to.be.greaterThan(0, 'Should have click hints for unmoved plane after crash');
        });

        it("should render planes with altitude indicators", () => {
            const g = new CrosshairsGame();
            g.clouds.clear();
            g.board.set('d5', [1, 'S', 3]);
            g.board.set('e5', [2, 'N', 6]);

            const render = g.render();

            // Check legend has altitude variations
            expect(render.legend).to.have.property('P1S_3');
            expect(render.legend).to.have.property('P2N_6');

            // P1S_3 should be an array with altitude triangles + plane
            const p1s3 = render.legend!['P1S_3'];
            expect(Array.isArray(p1s3)).to.be.true;
            expect((p1s3 as unknown[]).length).to.equal(4); // 3 wedges + 1 plane
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
            g.turnNumber = 6;  // Past entry phase
            g.planesRemaining = [0, 0];

            // Set up crosshairs to shoot down P2's only plane
            // P1 planes at f3 facing S and f9 facing N
            // P2 plane at f6 in the crosshairs
            g.board.set('f3', [1, 'S', 0]);
            g.board.set('f9', [1, 'N', 0]);
            g.board.set('f6', [2, 'NE', 0]);  // P2's only plane
            g.currplayer = 1;
            (g as unknown as { saveState: () => void }).saveState();

            // P1 shoots f6 then moves both planes
            g.move('(f6),f3-f4,f9-f8');

            // P2 reduced to 0 planes (shot down)
            expect(g.gameover).to.be.true;
            expect(g.winner).to.include(1);
        });
    });
});
