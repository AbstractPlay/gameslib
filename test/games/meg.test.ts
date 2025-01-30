/* eslint-disable no-unused-expressions */
/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import { MegGame } from "../../src/games";

describe("Meg", () => {
    it ("EOG scenarios", () => {
        // no nutmeg
        let g = new MegGame();
        g.board.set("i9", "CUP");
        g.board.set("c8", "CUP");
        g.board.set("g6", "CUP");
        g.board.set("i6", "CAP");
        g.board.set("h5", "BALL");
        g.board.set("i5", "CUP");
        g.board.set("g4", "CAP");
        g.board.set("h4", "CAP");
        g.board.set("d3", "CUP");
        g.board.set("f2", "CUP");
        g.offense = 1;
        g.countdown = 10;
        g.move("h5-g6");
        expect(g.gameover).to.be.false;

        // nutmeg but too close
        g = new MegGame();
        g.board.set("i9", "CUP");
        g.board.set("c8", "CUP");
        g.board.set("g6", "CUP");
        g.board.set("i6", "CAP");
        g.board.set("h5", "BALL");
        g.board.set("i5", "CUP");
        g.board.set("g4", "CAP");
        g.board.set("h4", "CAP");
        g.board.set("e4", "CUP");
        g.board.set("f2", "CUP");
        g.offense = 1;
        g.countdown = 10;
        g.move("h5-g6-e4");
        expect(g.gameover).to.be.false;

        // just right
        g = new MegGame();
        g.board.set("i9", "CUP");
        g.board.set("c8", "CUP");
        g.board.set("g6", "CUP");
        g.board.set("i6", "CAP");
        g.board.set("h5", "BALL");
        g.board.set("i5", "CUP");
        g.board.set("g4", "CAP");
        g.board.set("h4", "CAP");
        g.board.set("d3", "CUP");
        g.board.set("f2", "CUP");
        g.offense = 1;
        g.countdown = 10;
        g.move("h5-g6-d3");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([1]);

        // clock counts down after placement
        g = new MegGame();
        g.move("a1");
        g.move("b1");
        g.move("c1");
        g.move("*c1");
        g.move("d1");
        g.move("e1");
        g.move("f1");
        g.move("g1");
        g.move("h1");
        g.move("i1");
        g.move("j1");
        g.move("a2");
        g.move("b2");
        g.move("c2");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([1]);

        // clock counts down after shot (bug report)
        g = new MegGame(`{"game":"meg","numplayers":2,"variants":[],"gameover":false,"winner":[],"stack":[{"_version":"20250126","_results":[],"_timestamp":"2025-01-27T17:23:49.319Z","currplayer":1,"board":{"dataType":"Map","value":[]}},{"_version":"20250126","_results":[{"type":"place","where":"g6","what":"cup"}],"_timestamp":"2025-01-27T17:34:18.328Z","currplayer":2,"lastmove":"g6","board":{"dataType":"Map","value":[["g6","CUP"]]}},{"_version":"20250126","_results":[{"type":"place","where":"f5","what":"cup"}],"_timestamp":"2025-01-27T20:05:34.957Z","currplayer":1,"lastmove":"f5","board":{"dataType":"Map","value":[["g6","CUP"],["f5","CUP"]]}},{"_version":"20250126","_results":[{"type":"place","where":"a3","what":"cup"}],"_timestamp":"2025-01-27T20:09:12.735Z","currplayer":2,"lastmove":"a3","board":{"dataType":"Map","value":[["g6","CUP"],["f5","CUP"],["a3","CUP"]]}},{"_version":"20250126","_results":[{"type":"place","where":"d3","what":"cup"}],"_timestamp":"2025-01-27T20:13:56.138Z","currplayer":1,"lastmove":"d3","board":{"dataType":"Map","value":[["g6","CUP"],["f5","CUP"],["a3","CUP"],["d3","CUP"]]}},{"_version":"20250126","_results":[{"type":"claim","where":"f5"}],"_timestamp":"2025-01-27T20:14:21.421Z","currplayer":2,"lastmove":"*f5","board":{"dataType":"Map","value":[["g6","CUP"],["f5","BALL"],["a3","CUP"],["d3","CUP"]]},"countdown":10,"offense":1},{"_version":"20250126","_results":[{"type":"place","where":"d5","what":"cap"}],"_timestamp":"2025-01-27T20:16:21.803Z","currplayer":1,"lastmove":"d5","board":{"dataType":"Map","value":[["g6","CUP"],["f5","BALL"],["a3","CUP"],["d3","CUP"],["d5","CAP"]]},"countdown":9,"offense":1},{"_version":"20250126","_results":[{"type":"place","where":"e4","what":"cup"}],"_timestamp":"2025-01-27T20:39:18.665Z","currplayer":2,"lastmove":"e4","board":{"dataType":"Map","value":[["g6","CUP"],["f5","BALL"],["a3","CUP"],["d3","CUP"],["d5","CAP"],["e4","CUP"]]},"countdown":8,"offense":1},{"_version":"20250126","_results":[{"type":"place","where":"c3","what":"cap"}],"_timestamp":"2025-01-27T20:42:09.644Z","currplayer":1,"lastmove":"c3","board":{"dataType":"Map","value":[["g6","CUP"],["f5","BALL"],["a3","CUP"],["d3","CUP"],["d5","CAP"],["e4","CUP"],["c3","CAP"]]},"countdown":7,"offense":1},{"_version":"20250126","_results":[{"type":"place","where":"d4","what":"cup"}],"_timestamp":"2025-01-27T21:11:08.767Z","currplayer":2,"lastmove":"d4","board":{"dataType":"Map","value":[["g6","CUP"],["f5","BALL"],["a3","CUP"],["d3","CUP"],["d5","CAP"],["e4","CUP"],["c3","CAP"],["d4","CUP"]]},"countdown":6,"offense":1},{"_version":"20250126","_results":[{"type":"place","where":"c4","what":"cap"}],"_timestamp":"2025-01-27T23:57:39.170Z","currplayer":1,"lastmove":"c4","board":{"dataType":"Map","value":[["g6","CUP"],["f5","BALL"],["a3","CUP"],["d3","CUP"],["d5","CAP"],["e4","CUP"],["c3","CAP"],["d4","CUP"],["c4","CAP"]]},"countdown":5,"offense":1},{"_version":"20250126","_results":[{"type":"place","where":"g3","what":"cup"}],"_timestamp":"2025-01-27T23:59:38.007Z","currplayer":2,"lastmove":"g3","board":{"dataType":"Map","value":[["g6","CUP"],["f5","BALL"],["a3","CUP"],["d3","CUP"],["d5","CAP"],["e4","CUP"],["c3","CAP"],["d4","CUP"],["c4","CAP"],["g3","CUP"]]},"countdown":4,"offense":1},{"_version":"20250126","_results":[{"type":"place","where":"e6","what":"cap"}],"_timestamp":"2025-01-28T00:46:44.154Z","currplayer":1,"lastmove":"e6","board":{"dataType":"Map","value":[["g6","CUP"],["f5","BALL"],["a3","CUP"],["d3","CUP"],["d5","CAP"],["e4","CUP"],["c3","CAP"],["d4","CUP"],["c4","CAP"],["g3","CUP"],["e6","CAP"]]},"countdown":3,"offense":1},{"_version":"20250126","_results":[{"type":"place","where":"i4","what":"cup"}],"_timestamp":"2025-01-28T00:57:04.880Z","currplayer":2,"lastmove":"i4","board":{"dataType":"Map","value":[["g6","CUP"],["f5","BALL"],["a3","CUP"],["d3","CUP"],["d5","CAP"],["e4","CUP"],["c3","CAP"],["d4","CUP"],["c4","CAP"],["g3","CUP"],["e6","CAP"],["i4","CUP"]]},"countdown":2,"offense":1},{"_version":"20250126","_results":[{"type":"place","where":"g4","what":"cap"}],"_timestamp":"2025-01-28T01:13:47.100Z","currplayer":1,"lastmove":"g4","board":{"dataType":"Map","value":[["g6","CUP"],["f5","BALL"],["a3","CUP"],["d3","CUP"],["d5","CAP"],["e4","CUP"],["c3","CAP"],["d4","CUP"],["c4","CAP"],["g3","CUP"],["e6","CAP"],["i4","CUP"],["g4","CAP"]]},"countdown":1,"offense":1}]}`);
        g.move("f5-g6");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([2]);
    });
});

