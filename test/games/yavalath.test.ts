/* eslint-disable no-unused-expressions */
/* eslint-disable @typescript-eslint/no-unused-expressions */

import "mocha";
import { expect } from "chai";
import { YavalathGame } from '../../src/games';

const bugState = `{"game":"yavalath","numplayers":3,"variants":[],"gameover":false,"winner":[],"stack":[{"_version":"20250112","_results":[],"_timestamp":"2025-01-23T17:17:29.832Z","currplayer":1,"board":{"dataType":"Map","value":[]}},{"_version":"20250112","_results":[{"type":"place","where":"e5"}],"_timestamp":"2025-01-23T22:12:49.748Z","currplayer":2,"lastmove":"e5","board":{"dataType":"Map","value":[["e5",1]]}},{"_version":"20250112","_results":[{"type":"place","where":"f6"}],"_timestamp":"2025-01-24T14:55:55.687Z","currplayer":3,"lastmove":"f6","board":{"dataType":"Map","value":[["e5",1],["f6",2]]}},{"_version":"20250112","_results":[{"type":"place","where":"c4"}],"_timestamp":"2025-01-24T17:48:30.490Z","currplayer":1,"lastmove":"c4","board":{"dataType":"Map","value":[["e5",1],["f6",2],["c4",3]]}},{"_version":"20250112","_results":[{"type":"place","where":"f4"}],"_timestamp":"2025-01-24T20:33:02.712Z","currplayer":2,"lastmove":"f4","board":{"dataType":"Map","value":[["e5",1],["f6",2],["c4",3],["f4",1]]}},{"_version":"20250112","_results":[{"type":"place","where":"d6"}],"_timestamp":"2025-01-24T20:34:45.056Z","currplayer":3,"lastmove":"d6","board":{"dataType":"Map","value":[["e5",1],["f6",2],["c4",3],["f4",1],["d6",2]]}},{"_version":"20250112","_results":[{"type":"place","where":"c5"}],"_timestamp":"2025-01-24T21:01:49.498Z","currplayer":1,"lastmove":"c5","board":{"dataType":"Map","value":[["e5",1],["f6",2],["c4",3],["f4",1],["d6",2],["c5",3]]}},{"_version":"20250112","_results":[{"type":"place","where":"h2"}],"_timestamp":"2025-01-24T22:47:35.703Z","currplayer":2,"lastmove":"h2","board":{"dataType":"Map","value":[["e5",1],["f6",2],["c4",3],["f4",1],["d6",2],["c5",3],["h2",1]]}},{"_version":"20250112","_results":[{"type":"place","where":"f5"}],"_timestamp":"2025-01-24T23:56:19.127Z","currplayer":3,"lastmove":"f5","board":{"dataType":"Map","value":[["e5",1],["f6",2],["c4",3],["f4",1],["d6",2],["c5",3],["h2",1],["f5",2]]}},{"_version":"20250112","_results":[{"type":"place","where":"g3"}],"_timestamp":"2025-01-25T21:20:11.852Z","currplayer":1,"lastmove":"g3","board":{"dataType":"Map","value":[["e5",1],["f6",2],["c4",3],["f4",1],["d6",2],["c5",3],["h2",1],["f5",2],["g3",3]]}},{"_version":"20250112","_results":[{"type":"place","where":"e7"}],"_timestamp":"2025-01-25T21:32:20.413Z","currplayer":2,"lastmove":"e7","board":{"dataType":"Map","value":[["e5",1],["f6",2],["c4",3],["f4",1],["d6",2],["c5",3],["h2",1],["f5",2],["g3",3],["e7",1]]}},{"_version":"20250112","_results":[{"type":"place","where":"d4"}],"_timestamp":"2025-01-25T23:53:32.966Z","currplayer":3,"lastmove":"d4","board":{"dataType":"Map","value":[["e5",1],["f6",2],["c4",3],["f4",1],["d6",2],["c5",3],["h2",1],["f5",2],["g3",3],["e7",1],["d4",2]]}},{"_version":"20250112","_results":[{"type":"place","where":"c7"}],"_timestamp":"2025-01-26T02:23:55.002Z","currplayer":1,"lastmove":"c7","board":{"dataType":"Map","value":[["e5",1],["f6",2],["c4",3],["f4",1],["d6",2],["c5",3],["h2",1],["f5",2],["g3",3],["e7",1],["d4",2],["c7",3]]}},{"_version":"20250112","_results":[{"type":"place","where":"c6"}],"_timestamp":"2025-01-26T13:02:39.795Z","currplayer":2,"lastmove":"c6","board":{"dataType":"Map","value":[["e5",1],["f6",2],["c4",3],["f4",1],["d6",2],["c5",3],["h2",1],["f5",2],["g3",3],["e7",1],["d4",2],["c7",3],["c6",1]]}},{"_version":"20250112","_results":[{"type":"place","where":"e3"}],"_timestamp":"2025-01-26T13:04:18.011Z","currplayer":3,"lastmove":"e3","board":{"dataType":"Map","value":[["e5",1],["f6",2],["c4",3],["f4",1],["d6",2],["c5",3],["h2",1],["f5",2],["g3",3],["e7",1],["d4",2],["c7",3],["c6",1],["e3",2]]}},{"_version":"20250112","_results":[{"type":"place","where":"g4"}],"_timestamp":"2025-01-27T00:46:21.529Z","currplayer":1,"lastmove":"g4","board":{"dataType":"Map","value":[["e5",1],["f6",2],["c4",3],["f4",1],["d6",2],["c5",3],["h2",1],["f5",2],["g3",3],["e7",1],["d4",2],["c7",3],["c6",1],["e3",2],["g4",3]]}},{"_version":"20250112","_results":[{"type":"place","where":"d3"}],"_timestamp":"2025-01-27T01:13:36.054Z","currplayer":2,"lastmove":"d3","board":{"dataType":"Map","value":[["e5",1],["f6",2],["c4",3],["f4",1],["d6",2],["c5",3],["h2",1],["f5",2],["g3",3],["e7",1],["d4",2],["c7",3],["c6",1],["e3",2],["g4",3],["d3",1]]}},{"_version":"20250112","_results":[{"type":"place","where":"c2"}],"_timestamp":"2025-01-30T22:41:14.068Z","currplayer":3,"lastmove":"c2","board":{"dataType":"Map","value":[["e5",1],["f6",2],["c4",3],["f4",1],["d6",2],["c5",3],["h2",1],["f5",2],["g3",3],["e7",1],["d4",2],["c7",3],["c6",1],["e3",2],["g4",3],["d3",1],["c2",2]]}},{"_version":"20250112","_results":[{"type":"place","where":"g6"}],"_timestamp":"2025-01-31T17:31:30.541Z","currplayer":1,"lastmove":"g6","board":{"dataType":"Map","value":[["e5",1],["f6",2],["c4",3],["f4",1],["d6",2],["c5",3],["h2",1],["f5",2],["g3",3],["e7",1],["d4",2],["c7",3],["c6",1],["e3",2],["g4",3],["d3",1],["c2",2],["g6",3]]}},{"_version":"20250112","_results":[{"type":"place","where":"g5"}],"_timestamp":"2025-01-31T19:32:46.615Z","currplayer":2,"lastmove":"g5","board":{"dataType":"Map","value":[["e5",1],["f6",2],["c4",3],["f4",1],["d6",2],["c5",3],["h2",1],["f5",2],["g3",3],["e7",1],["d4",2],["c7",3],["c6",1],["e3",2],["g4",3],["d3",1],["c2",2],["g6",3],["g5",1]]}},{"_version":"20250112","_results":[{"type":"place","where":"g2"}],"_timestamp":"2025-01-31T22:11:41.609Z","currplayer":3,"lastmove":"g2","board":{"dataType":"Map","value":[["e5",1],["f6",2],["c4",3],["f4",1],["d6",2],["c5",3],["h2",1],["f5",2],["g3",3],["e7",1],["d4",2],["c7",3],["c6",1],["e3",2],["g4",3],["d3",1],["c2",2],["g6",3],["g5",1],["g2",2]]}},{"_version":"20250112","_results":[{"type":"place","where":"b2"}],"_timestamp":"2025-02-01T17:14:13.482Z","currplayer":1,"lastmove":"b2","board":{"dataType":"Map","value":[["e5",1],["f6",2],["c4",3],["f4",1],["d6",2],["c5",3],["h2",1],["f5",2],["g3",3],["e7",1],["d4",2],["c7",3],["c6",1],["e3",2],["g4",3],["d3",1],["c2",2],["g6",3],["g5",1],["g2",2],["b2",3]]}},{"_version":"20250112","_results":[{"type":"place","where":"d7"}],"_timestamp":"2025-02-01T18:10:50.429Z","currplayer":2,"lastmove":"d7","board":{"dataType":"Map","value":[["e5",1],["f6",2],["c4",3],["f4",1],["d6",2],["c5",3],["h2",1],["f5",2],["g3",3],["e7",1],["d4",2],["c7",3],["c6",1],["e3",2],["g4",3],["d3",1],["c2",2],["g6",3],["g5",1],["g2",2],["b2",3],["d7",1]]}},{"_version":"20250112","_results":[{"type":"place","where":"c1"}],"_timestamp":"2025-02-03T10:24:32.329Z","currplayer":3,"lastmove":"c1","board":{"dataType":"Map","value":[["e5",1],["f6",2],["c4",3],["f4",1],["d6",2],["c5",3],["h2",1],["f5",2],["g3",3],["e7",1],["d4",2],["c7",3],["c6",1],["e3",2],["g4",3],["d3",1],["c2",2],["g6",3],["g5",1],["g2",2],["b2",3],["d7",1],["c1",2]]}},{"_version":"20250112","_results":[{"type":"place","where":"e8"}],"_timestamp":"2025-02-03T17:14:14.572Z","currplayer":1,"lastmove":"e8","board":{"dataType":"Map","value":[["e5",1],["f6",2],["c4",3],["f4",1],["d6",2],["c5",3],["h2",1],["f5",2],["g3",3],["e7",1],["d4",2],["c7",3],["c6",1],["e3",2],["g4",3],["d3",1],["c2",2],["g6",3],["g5",1],["g2",2],["b2",3],["d7",1],["c1",2],["e8",3]]}},{"_version":"20250112","_results":[{"type":"place","where":"a4"}],"_timestamp":"2025-02-03T23:19:20.379Z","currplayer":2,"lastmove":"a4","board":{"dataType":"Map","value":[["e5",1],["f6",2],["c4",3],["f4",1],["d6",2],["c5",3],["h2",1],["f5",2],["g3",3],["e7",1],["d4",2],["c7",3],["c6",1],["e3",2],["g4",3],["d3",1],["c2",2],["g6",3],["g5",1],["g2",2],["b2",3],["d7",1],["c1",2],["e8",3],["a4",1]]}},{"_version":"20250112","_results":[{"type":"place","where":"f3"}],"_timestamp":"2025-02-05T01:02:40.408Z","currplayer":3,"lastmove":"f3","board":{"dataType":"Map","value":[["e5",1],["f6",2],["c4",3],["f4",1],["d6",2],["c5",3],["h2",1],["f5",2],["g3",3],["e7",1],["d4",2],["c7",3],["c6",1],["e3",2],["g4",3],["d3",1],["c2",2],["g6",3],["g5",1],["g2",2],["b2",3],["d7",1],["c1",2],["e8",3],["a4",1],["f3",2]]}},{"_version":"20250112","_results":[{"type":"place","where":"b5"}],"_timestamp":"2025-02-05T01:42:27.036Z","currplayer":1,"lastmove":"b5","board":{"dataType":"Map","value":[["e5",1],["f6",2],["c4",3],["f4",1],["d6",2],["c5",3],["h2",1],["f5",2],["g3",3],["e7",1],["d4",2],["c7",3],["c6",1],["e3",2],["g4",3],["d3",1],["c2",2],["g6",3],["g5",1],["g2",2],["b2",3],["d7",1],["c1",2],["e8",3],["a4",1],["f3",2],["b5",3]]}}]}`;

describe("Yavalath", () => {
    it ("Three loses", () => {
        let g = new YavalathGame(2);
        g.board.set("e1", 1);
        g.board.set("e2", 1);
        g.move("e3");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([2]);

        g = new YavalathGame(2);
        g.board.set("i1", 1);
        g.board.set("h2", 1);
        g.move("g3");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([2]);

        g = new YavalathGame(2);
        g.board.set("i1", 1);
        g.board.set("h1", 1);
        g.move("g1");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([2]);
    });
    it ("Four wins", () => {
        let g = new YavalathGame(2);
        g.board.set("e1", 1);
        g.board.set("e2", 1);
        g.board.set("e4", 1);
        g.move("e3");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([1]);

        g = new YavalathGame(2);
        g.board.set("i1", 1);
        g.board.set("h2", 1);
        g.board.set("f4", 1);
        g.move("g3");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([1]);

        g = new YavalathGame(2);
        g.board.set("i1", 1);
        g.board.set("h1", 1);
        g.board.set("f1", 1);
        g.move("g1");
        expect(g.gameover).to.be.true;
        expect(g.winner).to.have.members([1]);
    });
    it ("3P must block", () => {
        let g = new YavalathGame(3);
        g.board.set("e1", 2);
        g.board.set("e2", 2);
        g.board.set("e4", 2);
        let bad = g.validateMove("a1");
        expect(bad.valid).to.be.false;
        let good = g.validateMove("e3");
        expect(good.valid).to.be.true;
        expect(good.complete).to.equal(1);

        // from bug report
        g = new YavalathGame(bugState);
        bad = g.validateMove("e1");
        expect(bad.valid).to.be.false;
        good = g.validateMove("e4");
        expect(good.valid).to.be.true;
        expect(good.complete).to.equal(1);
        good = g.validateMove("d2")
        expect(good.valid).to.be.true;
        expect(good.complete).to.equal(1);
    });
});

