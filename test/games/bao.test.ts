/* eslint-disable @typescript-eslint/no-unused-expressions */
import "mocha";
import { expect } from "chai";
import { BaoGame } from '../../src/games';
// import { BaoGraph } from "../../src/common";

describe("Bao", () => {
    it ("Cloning", () => {
        const g = new BaoGame();
        const cloned = BaoGame.clone(g);
        cloned.board[0] = [1,1,1,1,1,1,1,1];
        expect(g.board[0]).not.eql(cloned.board[0]);
    });

    it ("Move processing", () => {
        const g = new BaoGame();
        // basic starting moves
        let cloned = BaoGame.clone(g);
        let results = cloned.processMove("f2>*");
        expect(cloned.board[2][0]).eq(0);
        expect(cloned.board[2][1]).eq(0);
        expect(cloned.board[2][2]).eq(0);
        expect(cloned.board[2][3]).eq(0);
        expect(cloned.board[2][4]).eq(6);
        expect(cloned.board[2][5]).eq(0);
        expect(cloned.board[2][6]).eq(3);
        expect(cloned.board[2][7]).eq(1);
        expect(cloned.board[3][7]).eq(1);
        expect(results.captured.cells.length).eq(0);
        expect(results.captured.stones).eq(0);
        expect(results.complete).to.be.true;
        expect(results.infinite).to.be.false;
        expect(results.sown).eql(["f2"]);

        cloned = BaoGame.clone(g);
        results = cloned.processMove("b3<*");
        expect(cloned.board[1][0]).eq(0);
        expect(cloned.board[1][1]).eq(0);
        expect(cloned.board[1][2]).eq(3);
        expect(cloned.board[1][3]).eq(7);
        expect(cloned.board[1][4]).eq(1);
        expect(cloned.board[1][5]).eq(0);
        expect(cloned.board[1][6]).eq(0);
        expect(cloned.board[1][7]).eq(0);
        expect(cloned.board[0][0]).eq(0);
        expect(results.captured.cells.length).eq(0);
        expect(results.captured.stones).eq(0);
        expect(results.complete).to.be.true;
        expect(results.infinite).to.be.false;
        expect(results.sown).eql(["b3"]);

        cloned = BaoGame.clone(g);
        cloned.board = [
            [0,0,0,0,0,0,0,0],
            [0,1,2,6,1,0,0,0],
            [0,0,0,0,6,1,2,0],
            [0,0,0,0,0,0,0,0],
        ];
        results = cloned.processMove("e2>");
        expect(cloned.board[1]).eql([0,1,2,6,0,0,0,0]);
        expect(cloned.board[2]).eql([0,0,0,0,7,1,2,1]);
        expect(results.captured.cells).eql(["e3"]);
        expect(results.captured.stones).eq(1);

        cloned = BaoGame.clone(g);
        cloned.board = [
            [0,0,0,0,0,0,0,0],
            [0,1,2,6,1,0,0,0],
            [0,0,0,0,6,1,2,0],
            [0,0,0,0,0,0,0,0],
        ];
        results = cloned.processMove("e2<");
        expect(cloned.board[1]).eql([0,1,2,6,0,0,0,0]);
        expect(cloned.board[2]).eql([1,0,0,0,7,1,2,0]);
        expect(results.captured.cells).eql(["e3"]);
        expect(results.captured.stones).eq(1);

        cloned = BaoGame.clone(g);
        cloned.board = [
            [0,0,0,0,0,0,0,0],
            [0,3,1,6,0,1,0,0],
            [0,1,0,0,7,1,0,0],
            [0,0,0,0,0,0,0,0],
        ];
        results = cloned.processMove("b2<");
        expect(cloned.board[1]).eql([0,0,1,6,0,1,0,0]);
        expect(cloned.board[2]).eql([1,3,1,0,7,1,0,0]);
        expect(results.captured.cells).eql(["b3"]);
        expect(results.captured.stones).eq(3);

        cloned = BaoGame.clone(g);
        cloned.board = [
            [0,0,0,0,0,0,0,0],
            [0,0,2,6,1,1,0,0],
            [0,0,0,0,6,1,1,1],
            [0,0,0,0,0,0,0,0],
        ];
        results = cloned.processMove("e2>");
        expect(cloned.board[1]).eql([0,0,2,6,0,0,0,0]);
        expect(cloned.board[2]).eql([0,0,0,0,7,2,2,1]);
        expect(results.captured.cells).eql(["e3", "f3"]);
        expect(results.captured.stones).eq(2);

        cloned = BaoGame.clone(g);
        cloned.board = [
            [0,0,0,0,0,0,0,0],
            [0,2,2,6,0,7,0,0],
            [0,1,0,0,7,1,0,0],
            [0,0,0,0,0,0,0,0],
        ];
        results = cloned.processMove("f2>");
        expect(cloned.board[1]).eql([0,0,2,6,0,0,0,0]);
        expect(cloned.board[2]).eql([1,0,2,2,9,3,1,1]);
        expect(results.captured.cells).eql(["f3", "b3"]);
        expect(results.captured.stones).eq(9);

        cloned = BaoGame.clone(g);
        cloned.board = [
            [0,0,0,0,0,0,0,0],
            [5,0,2,6,0,0,0,0],
            [1,0,2,2,7,0,0,0],
            [0,0,0,0,0,0,0,0],
        ];
        results = cloned.processMove("a2>");
        expect(cloned.board[1]).eql([0,0,2,6,0,0,0,0]);
        expect(cloned.board[2]).eql([3,1,3,3,8,0,0,0]);
        expect(results.captured.cells).eql(["a3"]);
        expect(results.captured.stones).eq(5);
        expect(results.complete).to.be.false;

        cloned = BaoGame.clone(g);
        cloned.board = [
            [0,0,0,0,0,0,0,0],
            [5,0,2,6,0,0,0,0],
            [1,0,2,2,7,0,0,0],
            [0,0,0,0,0,0,0,0],
        ];
        results = cloned.processMove("a2>+");
        expect(cloned.board[1]).eql([0,0,2,6,0,0,0,0]);
        expect(cloned.board[2]).eql([3,1,3,3,0,1,1,1]);
        expect(cloned.board[3]).eql([0,0,0,1,1,1,1,1]);
        expect(results.captured.cells).eql(["a3"]);
        expect(results.captured.stones).eq(5);
        expect(results.complete).to.be.true;

        cloned = BaoGame.clone(g);
        cloned.board = [
            [0,0,0,0,0,0,0,0],
            [0,2,0,6,0,2,0,0],
            [0,0,0,0,6,0,0,0],
            [0,0,0,0,1,0,0,2],
        ];
        results = cloned.processMove("e2<*");
        expect(cloned.board[1]).eql([0,2,0,6,0,2,0,0]);
        expect(cloned.board[2]).eql([0,0,1,1,5,0,0,0]);
        expect(results.captured.cells).eql([]);
        expect(results.captured.stones).eq(0);
        expect(results.complete).to.be.true;
        expect(results.sown).eql(["e2"]);

        cloned = BaoGame.clone(g);
        cloned.inhand = [0,0];
        cloned.board = [
            [0,0,0,0,0,0,0,0],
            [0,1,2,2,0,1,0,0],
            [0,0,1,3,1,0,2,0],
            [0,0,0,0,3,0,0,2],
        ];
        results = cloned.processMove("d2>*");
        expect(cloned.board[2]).eql([0,0,1,0,2,1,0,1]);
        expect(cloned.board[3]).eql([0,0,0,0,3,0,1,3]);
        expect(results.captured.cells).eql([]);
        expect(results.captured.stones).eq(0);
        expect(results.complete).to.be.true;
        expect(results.sown).eql(["d2", "g2"]);

        cloned = BaoGame.clone(g);
        cloned.inhand = [0,0];
        cloned.board = [
            [0,0,0,0,0,0,0,0],
            [0,1,2,0,1,0,0,0],
            [0,0,0,1,1,0,1,0],
            [0,0,0,0,3,0,0,2],
        ];
        results = cloned.processMove("h1>*");
        expect(cloned.board[1]).eql([0,1,2,0,1,0,0,0]);
        expect(cloned.board[2]).eql([0,0,1,2,0,1,0,1]);
        expect(cloned.board[3]).eql([0,0,0,0,3,0,0,0]);
        expect(results.captured.cells).eql([]);
        expect(results.captured.stones).eq(0);
        expect(results.complete).to.be.true;
        expect(results.sown).eql(["h1", "g2", "e2"]);

        cloned = BaoGame.clone(g);
        cloned.inhand = [0,0];
        cloned.board = [
            [0,0,0,0,0,0,0,0],
            [0,0,0,1,3,1,6,0],
            [0,3,2,1,1,0,1,0],
            [0,0,0,0,0,2,3,1],
        ];
        results = cloned.processMove("b2>");
        expect(cloned.board[1]).eql([0,0,0,1,0,1,0,0]);
        expect(cloned.board[2]).eql([1,1,1,4,4,2,3,1]);
        expect(cloned.board[3]).eql([0,0,0,0,0,2,3,1]);
        expect(results.captured.cells).eql(["e3", "g3"]);
        expect(results.captured.stones).eq(9);
        expect(results.complete).to.be.true;
        expect(results.sown).eql(["b2", "c2"]);
    });

    it("Kutakatia", () => {
        let g = new BaoGame();
        g.inhand = [0,0];
        g.board = [
            [0,0,0,0,0,0,0,0],
            [0,5,0,0,1,0,2,0],
            [0,1,0,0,0,0,1,0],
            [0,2,3,0,0,0,0,0],
        ];
        g.move("c1<*", {skipEconomy: true});
        let blocked = g.getBlocked(2);
        expect(blocked).eq("b3");
        expect(g.lastmove).eq("c1<**");

        g = new BaoGame();
        g.inhand = [0,0];
        g.board = [
            [0,0,0,0,0,0,0,0],
            [0,6,0,0,2,0,2,0],
            [0,0,1,0,0,0,0,0],
            [2,3,0,0,0,0,4,0],
        ];
        g.move("a1<*", {skipEconomy: true});
        blocked = g.getBlocked(2);
        expect(blocked).eq("b3");
        expect(g.lastmove).eq("a1<**");
        // player 2 makes a kutakata move, setting up a second capture for south
        g.move("g3>*", {skipEconomy: true});
        expect(g.blocked).eql([undefined, "b3"]);
        expect(g.board[1]).eql([0,7,1,1,0,1,0,0]);
        // but south is required to capture the blocked pit
        expect(g.moves()).eql(["b1<"]);

        // can't block a functioning nyumba
        g = new BaoGame();
        g.inhand = [0,0];
        g.board = [
            [0,0,0,0,0,0,0,0],
            [0,0,0,7,2,0,2,0],
            [0,0,1,0,0,1,0,0],
            [3,5,0,0,0,0,4,0],
        ];
        g.move("b1<*", {skipEconomy: true});
        blocked = g.getBlocked(2);
        expect(blocked).to.be.undefined;
        expect(g.lastmove).eq("b1<*");

        // can't block only occupied pit
        g = new BaoGame();
        g.inhand = [0,0];
        g.board = [
            [0,0,3,0,0,0,7,0],
            [0,0,1,0,0,0,0,0],
            [0,0,0,1,0,1,0,0],
            [2,4,0,0,0,0,4,0],
        ];
        g.move("b1<*", {skipEconomy: true});
        blocked = g.getBlocked(2);
        expect(blocked).to.be.undefined;
        expect(g.lastmove).eq("b1<*");

        // can't block the only pit with >1 stones
        g = new BaoGame();
        g.inhand = [0,0];
        g.board = [
            [0,0,3,0,0,0,7,0],
            [0,0,2,0,1,0,1,1],
            [0,0,0,1,0,1,0,0],
            [2,4,0,0,0,0,4,0],
        ];
        g.move("b1<*", {skipEconomy: true});
        blocked = g.getBlocked(2);
        expect(blocked).to.be.undefined;
        expect(g.lastmove).eq("b1<*");
    });

    it ("Kutakatia clearing", () => {
        const state = `{"game":"bao","numplayers":2,"variants":["kujifunza"],"gameover":false,"winner":[],"stack":[{"_version":"20231126","_results":[],"_timestamp":"2023-12-18T23:36:45.093Z","currplayer":1,"board":[[2,2,2,2,2,2,2,2],[2,2,2,2,2,2,2,2],[2,2,2,2,2,2,2,2],[2,2,2,2,2,2,2,2]],"inhand":[0,0],"houses":[null,null],"blocked":[null,null],"deltas":[[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0]]},{"_version":"20231126","_results":[{"type":"move","from":"a2","to":"b2"},{"type":"capture","where":"c3, b3, g3, h3","count":8}],"_timestamp":"2023-12-18T23:38:47.302Z","currplayer":2,"lastmove":"a2>","board":[[2,2,2,2,2,2,2,2],[2,0,0,2,2,2,0,0],[3,1,0,4,4,4,1,5],[3,3,0,3,3,0,3,3]],"houses":[null,null],"inhand":[0,0],"blocked":[null,null],"deltas":[[0,0,0,0,0,0,0,0],[0,-2,-2,0,0,0,-2,-2],[1,-1,-2,2,2,2,-1,3],[1,1,-2,1,1,-2,1,1]]},{"_version":"20231126","_results":[{"type":"move","from":"f3","to":"e3"},{"type":"capture","where":"d2, e2, g2, h2, b2, a2","count":18}],"_timestamp":"2023-12-19T00:30:53.348Z","currplayer":1,"lastmove":"f3>","board":[[1,0,4,1,4,0,1,4],[6,4,0,2,3,5,1,6],[0,0,0,0,0,4,0,0],[3,3,0,3,3,0,3,3]],"houses":[null,null],"inhand":[0,0],"blocked":[null,null],"deltas":[[-1,-2,2,-1,2,-2,-1,2],[4,4,0,0,1,3,1,6],[-3,-1,0,-4,-4,0,-1,-5],[0,0,0,0,0,0,0,0]]},{"_version":"20231126","_results":[{"type":"move","from":"h1","to":"h2"},{"type":"capture","where":"f3","count":5}],"_timestamp":"2023-12-19T00:30:53.369Z","currplayer":2,"lastmove":"h1>","board":[[1,0,4,1,4,0,1,4],[6,4,0,2,3,0,1,6],[0,0,0,1,1,6,2,2],[3,3,0,3,3,0,3,0]],"houses":[null,null],"inhand":[0,0],"blocked":[null,null],"deltas":[[0,0,0,0,0,0,0,0],[0,0,0,0,0,-5,0,0],[0,0,0,1,1,2,2,2],[0,0,0,0,0,0,0,-3]]},{"_version":"20231126","_results":[{"type":"move","from":"h4","to":"h3"},{"type":"capture","where":"e2, h2, g2","count":5}],"_timestamp":"2023-12-19T00:31:14.649Z","currplayer":1,"lastmove":"h4<","board":[[1,0,4,1,4,0,1,0],[6,4,1,3,5,2,0,10],[0,0,0,1,0,6,0,0],[3,3,0,3,3,0,3,0]],"houses":[null,null],"inhand":[0,0],"blocked":[null,null],"deltas":[[0,0,0,0,0,0,0,-4],[0,0,1,1,2,2,-1,4],[0,0,0,0,-1,0,-2,-2],[0,0,0,0,0,0,0,0]]},{"_version":"20231126","_results":[{"type":"move","from":"f2","to":"e2"},{"type":"sow","pits":["f2","a1","e1"]}],"_timestamp":"2023-12-19T00:45:36.895Z","currplayer":2,"lastmove":"f2<*","board":[[1,0,4,1,4,0,1,0],[6,4,1,3,5,2,0,10],[1,1,1,2,1,0,0,1],[0,4,1,4,0,1,4,1]],"houses":[null,null],"inhand":[0,0],"blocked":[null,null],"deltas":[[0,0,0,0,0,0,0,0],[0,0,0,0,0,0,0,0],[1,1,1,1,1,-6,0,1],[-3,1,1,1,-3,1,1,1]]},{"_version":"20231126","_results":[{"type":"move","from":"h3","to":"h4"},{"type":"capture","where":"b2, a2, c2","count":3}],"_timestamp":"2023-12-19T00:55:30.675Z","currplayer":1,"lastmove":"h3<","board":[[1,3,7,1,0,3,1,0],[1,9,1,5,7,4,0,2],[0,0,0,2,1,0,0,1],[0,4,1,4,0,1,4,1]],"houses":[null,null],"inhand":[0,0],"blocked":[null,null],"deltas":[[0,3,3,0,-4,3,0,0],[-5,5,0,2,2,2,0,-8],[-1,-1,-1,0,0,0,0,0],[0,0,0,0,0,0,0,0]]}]}`;
        let g = new BaoGame(state);
        g.move("d2<*");
        expect(g.blocked).eql([null, "c3"]);
        g.move("c4>");
        expect(g.moves()).eql(["b1<"]);
        g.move("b1<");
        expect(g.blocked).eql([null,undefined]);

        g = new BaoGame(state);
        g.move("d2<*");
        expect(g.blocked).eql([null, "c3"]);
        g.move("f3>");
        expect(g.blocked).eql([null,undefined]);
    });

    it("Infinite loops", () => {
        const g = new BaoGame();
        g.inhand = [13,13];
        g.board = [
            [2,1,2,3,2,4,0,3],
            [0,2,0,0,3,0,0,0],
            [1,0,2,1,0,1,2,1],
            [2,0,1,2,0,1,2,0],
        ];
        let results = g.processMove("g2>*");
        expect(results.infinite).to.be.true;

        g.inhand = [1,1];
        g.board = [
            [2,2,2,3,4,4,5,3],
            [0,0,0,5,0,6,0,0],
            [3,2,1,0,1,0,5,4],
            [1,0,1,2,0,1,2,3],
        ];
        results = g.processMove("a2>*");
        expect(results.infinite).to.be.true;
    });
});

