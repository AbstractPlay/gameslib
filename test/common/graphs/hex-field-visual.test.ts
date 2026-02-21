// import "mocha";
// import { HexFieldGraph } from "../../../src/common/graphs/hex-field";
// import { Orientation } from "honeycomb-grid";

// describe("HexFieldGraph Visual Validation", () => {
//     // Helper to print the graph
//     const printGraph = (g: HexFieldGraph, label: string) => {
//         console.log(`\n--- ${label} ---`);
//         for (let y = 0; y < g.height; y++) {
//             for (let x = 0; x < g.width; x++) {
//                 const cell = g.coords2algebraic(x, y);
//                 const neighbours = g.neighbours(cell);
//                 // Print cell and its neighbors
//                 console.log(`${cell} (${x},${y}) -> ${neighbours.join(", ")}`);
//             }
//         }
//     };

//     it("Visual Check Pointy Odd-R (Offset -1)", () => {
//         // Expected: (0,0) connected to (1,0) and (0,1) [SE]
//         const g = new HexFieldGraph(3, 3, Orientation.POINTY, -1);
//         printGraph(g, "Pointy Odd-R (Offset 1)");
//     });

//     it("Visual Check Pointy Even-R (Offset 1)", () => {
//         // Expected: (0,0) connected to (1,0) and (0,1) [SW]
//         const g = new HexFieldGraph(3, 3, Orientation.POINTY, 1);
//         printGraph(g, "Pointy Even-R (Offset -1)");
//     });

//     it("Visual Check Flat Odd-Q (Offset -1)", () => {
//         const g = new HexFieldGraph(3, 3, Orientation.FLAT, -1);
//         printGraph(g, "Flat Odd-Q (Offset 1)");
//     });

//     it("Visual Check Flat Even-Q (Offset 1)", () => {
//         const g = new HexFieldGraph(3, 3, Orientation.FLAT, 1);
//         printGraph(g, "Flat Even-Q (Offset -1)");
//     });
// });
