/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import { GorogoGame } from '../../src/games';

describe("GoRoGo", () => {
    it ("Placements & Captures", () => {
        const g = new GorogoGame();
        g.move("&a5");
        for (const cell of ["b3", "c2", "c4", "d3"]) {
            g.board.set(cell, 1);
        }
        expect(g.canPlace("c3")).to.be.false;
        g.board.set("b3", "X");
        expect(g.canPlace("c3")).to.be.true;
    });
    it ("Bug state", () => {
        const state = `{"game":"gorogo","numplayers":2,"variants":[],"gameover":false,"winner":[],"stack":[{"_version":"20250425","_results":[],"_timestamp":"2025-04-30T14:26:20.025Z","currplayer":1,"board":{"dataType":"Map","value":[]},"pieces":[{"normal":10,"neutral":3},{"normal":10,"neutral":2}]},{"_version":"20250425","_results":[{"type":"place","where":"b3","what":"henge"}],"_timestamp":"2025-05-03T14:41:19.482Z","currplayer":2,"lastmove":"&b3","board":{"dataType":"Map","value":[["b3","X"]]},"pieces":[{"normal":10,"neutral":2},{"normal":10,"neutral":2}]},{"_version":"20250425","_results":[{"type":"place","where":"a2","what":"piece"}],"_timestamp":"2025-05-03T14:41:24.554Z","currplayer":1,"lastmove":"a2","board":{"dataType":"Map","value":[["b3","X"],["a2",2]]},"pieces":[{"normal":10,"neutral":2},{"normal":9,"neutral":2}]},{"_version":"20250425","_results":[{"type":"place","where":"b2","what":"piece"}],"_timestamp":"2025-05-03T14:41:25.536Z","currplayer":2,"lastmove":"b2","board":{"dataType":"Map","value":[["b3","X"],["a2",2],["b2",1]]},"pieces":[{"normal":9,"neutral":2},{"normal":9,"neutral":2}]},{"_version":"20250425","_results":[{"type":"place","where":"c2","what":"piece"}],"_timestamp":"2025-05-03T14:41:26.242Z","currplayer":1,"lastmove":"c2","board":{"dataType":"Map","value":[["b3","X"],["a2",2],["b2",1],["c2",2]]},"pieces":[{"normal":9,"neutral":2},{"normal":8,"neutral":2}]},{"_version":"20250425","_results":[{"type":"place","where":"c3","what":"piece"}],"_timestamp":"2025-05-03T14:41:28.817Z","currplayer":2,"lastmove":"c3","board":{"dataType":"Map","value":[["b3","X"],["a2",2],["b2",1],["c2",2],["c3",1]]},"pieces":[{"normal":8,"neutral":2},{"normal":8,"neutral":2}]},{"_version":"20250425","_results":[{"type":"place","where":"d3","what":"piece"}],"_timestamp":"2025-05-03T14:41:29.262Z","currplayer":1,"lastmove":"d3","board":{"dataType":"Map","value":[["b3","X"],["a2",2],["b2",1],["c2",2],["c3",1],["d3",2]]},"pieces":[{"normal":8,"neutral":2},{"normal":7,"neutral":2}]},{"_version":"20250425","_results":[{"type":"place","where":"d4","what":"piece"}],"_timestamp":"2025-05-03T14:41:30.041Z","currplayer":2,"lastmove":"d4","board":{"dataType":"Map","value":[["b3","X"],["a2",2],["b2",1],["c2",2],["c3",1],["d3",2],["d4",1]]},"pieces":[{"normal":7,"neutral":2},{"normal":7,"neutral":2}]},{"_version":"20250425","_results":[{"type":"place","where":"e3","what":"piece"}],"_timestamp":"2025-05-03T14:41:30.914Z","currplayer":1,"lastmove":"e3","board":{"dataType":"Map","value":[["b3","X"],["a2",2],["b2",1],["c2",2],["c3",1],["d3",2],["d4",1],["e3",2]]},"pieces":[{"normal":7,"neutral":2},{"normal":6,"neutral":2}]},{"_version":"20250425","_results":[{"type":"place","where":"c5","what":"piece"}],"_timestamp":"2025-05-03T14:41:31.782Z","currplayer":2,"lastmove":"c5","board":{"dataType":"Map","value":[["b3","X"],["a2",2],["b2",1],["c2",2],["c3",1],["d3",2],["d4",1],["e3",2],["c5",1]]},"pieces":[{"normal":6,"neutral":2},{"normal":6,"neutral":2}]},{"_version":"20250425","_results":[{"type":"place","where":"e1","what":"piece"}],"_timestamp":"2025-05-03T14:41:51.860Z","currplayer":1,"lastmove":"e1","board":{"dataType":"Map","value":[["b3","X"],["a2",2],["b2",1],["c2",2],["c3",1],["d3",2],["d4",1],["e3",2],["c5",1],["e1",2]]},"pieces":[{"normal":6,"neutral":2},{"normal":5,"neutral":2}]},{"_version":"20250425","_results":[{"type":"place","where":"b4","what":"piece"}],"_timestamp":"2025-05-03T14:41:52.967Z","currplayer":2,"lastmove":"b4","board":{"dataType":"Map","value":[["b3","X"],["a2",2],["b2",1],["c2",2],["c3",1],["d3",2],["d4",1],["e3",2],["c5",1],["e1",2],["b4",1]]},"pieces":[{"normal":5,"neutral":2},{"normal":5,"neutral":2}]}]}`;
        const g = new GorogoGame(state);
        expect(g.moves().includes("c4")).to.be.true;
    });
});

