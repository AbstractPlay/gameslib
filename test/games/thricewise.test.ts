import "mocha";
import { expect } from "chai";
import { ThricewiseGame } from "../../src/games/thricewise";
import { SIMULTANEOUS_ELIM_TOKEN } from "../../src/games/_turn-simultaneous";
import { scorePlacement, threesomeValue } from "../../src/games/thricewise/scoring";
import { QuincunxBoard } from "../../src/games/quincunx/board";
import { QuincunxCard } from "../../src/games/quincunx/card";
import { cardsBasic } from "../../src/common/decktet";
import { addResource } from "../../src";

function cardsOfRank(seq: number): string[] {
    return cardsBasic.filter(c => c.rank.seq === seq).map(c => c.uid);
}

describe("Thricewise", () => {
    it("turnModel is sequenced", () => {
        const g = new ThricewiseGame(2);
        expect(g.turnModel()).to.equal("sequenced");
    });

    it("export plies and rounds split N-part wire lastmove per seat", () => {
        const g = new ThricewiseGame(3);
        const twos = cardsOfRank(2);
        const aces = cardsOfRank(1);
        const fours = cardsOfRank(4);
        const fives = cardsOfRank(5);
        g.hands = [[fives[0], twos[0]], [aces[0], twos[1]], [fours[0], fives[1]]];
        g.move(`${fives[0]},${aces[0]},${fours[0]}`);
        expect(g.stack.length).to.equal(2);

        const plies = g.getPlies();
        expect(plies).to.have.length(3);
        expect(plies.map(p => p.actor)).to.deep.equal([1, 2, 3]);
        expect(plies.map(p => p.move)).to.deep.equal([fives[0], aces[0], fours[0]]);
        expect(plies.every(p => p.stackIndex === 1)).to.equal(true);

        const rounds = g.getRounds();
        expect(rounds).to.have.length(1);
        const slotMove = (slot: unknown): string => {
            if (slot == null) {
                return "";
            }
            if (typeof slot === "string") {
                return slot;
            }
            if (typeof slot === "object" && slot !== null && "move" in slot) {
                return String((slot as { move: unknown }).move);
            }
            return String(slot);
        };
        expect(slotMove(rounds[0]![0])).to.equal(fives[0]);
        expect(slotMove(rounds[0]![1])).to.equal(aces[0]);
        expect(slotMove(rounds[0]![2])).to.equal(fours[0]);
        expect(
            rounds[0]!.every(
                slot => slot == null || !slotMove(slot).includes(","),
            ),
        ).to.equal(true);

        const empty = g.legalEmpties()[0]!;
        const player = g.currplayer;
        const uid = g.trickCard[player - 1]!;
        const token = `${uid}@${empty[0]}.${empty[1]}`;
        const wire = Array.from({ length: g.numplayers }, (_, i) =>
            i + 1 === player ? token : SIMULTANEOUS_ELIM_TOKEN,
        ).join(",");
        g.move(wire);
        const placePlies = g.getPlies().filter(p => p.stackIndex === 2);
        expect(placePlies).to.have.length(1);
        expect(placePlies[0]!.actor).to.equal(player);
        expect(placePlies[0]!.move).to.equal(token);
        expect(slotMove(g.getRounds()[1]![placePlies[0]!.actor - 1])).to.equal(token);
    });

    it("isEliminated when select phase and hand is empty", () => {
        const g = new ThricewiseGame(2);
        expect(g.isEliminated(1)).to.equal(false);
        g.hands[0] = [];
        expect(g.isEliminated(1)).to.equal(true);
        expect(g.isEliminated(2)).to.equal(false);
    });

    it("isEliminated in place phase except currplayer", () => {
        const g = new ThricewiseGame(3);
        const twos = cardsOfRank(2);
        const aces = cardsOfRank(1);
        const fours = cardsOfRank(4);
        const fives = cardsOfRank(5);
        g.hands = [[fives[0], twos[0]], [aces[0], twos[1]], [fours[0], fives[1]]];
        g.move(`${fives[0]},${aces[0]},${fours[0]}`);
        expect(g.phase).to.equal("place");
        expect(g.playQueue).to.deep.equal([2, 3, 1]);
        expect(g.currplayer).to.equal(2);
        expect(g.isEliminated(1)).to.equal(true);
        expect(g.isEliminated(2)).to.equal(false);
        expect(g.isEliminated(3)).to.equal(true);
    });

    it("handleClick selects a card from the correct hand", () => {
        const g = new ThricewiseGame(2);
        const uid = g.hands[1][0]!;
        const result = g.handleClick("", -1, -1, `c${uid}`);
        expect(result.valid).to.equal(true);
        expect(result.move).to.equal(uid);
        expect(result.complete).to.equal(1);
    });

    it("partial select keeps phase and full hand for render", () => {
        const g = new ThricewiseGame(5);
        const uid = g.hands[0][0]!;
        const handBefore = [...g.hands[0]];
        const pad = new Array(g.numplayers - 1).fill("").join(",");
        g.move(`${uid},${pad}`, { partial: true });
        expect(g.phase).to.equal("select");
        expect(g.hands[0]).to.deep.equal(handBefore);
        const rep = g.render({ perspective: 1 });
        const handArea = rep.areas?.find(
            a =>
                typeof a.label === "object" &&
                a.label.textKey === "apgames:validation.thricewise.LABEL_HAND" &&
                a.label.actor?.kind === "seat" &&
                a.label.actor.seat === 1,
        );
        expect(handArea?.pieces?.every(p => p !== "cUNKNOWN")).to.equal(true);
    });

    it("dims deferred and selected cards during select, not unpicked hand cards", () => {
        const g = new ThricewiseGame(2);
        const twos = cardsOfRank(2);
        const threes = cardsOfRank(3);
        g.phase = "select";
        g.deferred[0] = [twos[0]!];
        g.hands[0] = [threes[0]!, threes[1]!];
        g.pendingSelect[0] = threes[1]!;
        const rep = g.render({ perspective: 1 });
        const dimmed = (key: string) => {
            const entry = rep.legend?.[key];
            const layers = Array.isArray(entry) ? entry : entry !== undefined ? [entry] : [];
            return layers.some(
                (layer: { name?: string; opacity?: number }) =>
                    layer.name === "cross-diag" && layer.opacity === 0.5,
            );
        };
        expect(dimmed(`c${twos[0]}`)).to.equal(true);
        expect(dimmed(`c${threes[1]}`)).to.equal(true);
        expect(dimmed(`c${threes[0]}`)).to.equal(false);
    });

    it("renders after a JSON state round-trip (trickCard undefined → null)", () => {
        const g = new ThricewiseGame(2);
        const g2 = new ThricewiseGame(JSON.stringify(g.state()));
        const rep = g2.render();
        const legendKeys = new Set(Object.keys(rep.legend));
        for (const area of rep.areas ?? []) {
            for (const piece of area.pieces ?? []) {
                const key = typeof piece === "string" ? piece : piece.piece;
                expect(legendKeys.has(key), key).to.equal(true);
            }
        }
    });

    it("labels deferred and selected trick cards in the hand area", () => {
        const g = new ThricewiseGame(2);
        const twos = cardsOfRank(2);
        const threes = cardsOfRank(3);
        g.phase = "place";
        g.currplayer = 1;
        g.deferred[0] = [twos[0]!];
        g.trickCard[0] = threes[0]!;
        g.hands[0] = [];
        const rep = g.render({ perspective: 1 });
        const handArea = rep.areas?.find(
            a =>
                typeof a.label === "object" &&
                a.label.textKey === "apgames:validation.thricewise.LABEL_HAND" &&
                a.label.actor?.kind === "seat" &&
                a.label.actor.seat === 1,
        );
        const captions = (handArea?.pieces ?? []).map(p =>
            typeof p === "string" ? undefined : p.text,
        );
        expect(captions).to.deep.equal(["Def", "Sel"]);
    });

    it("labels an uncommitted partial select as Sel", () => {
        const g = new ThricewiseGame(2);
        const uid = g.hands[0][0]!;
        g.move(`${uid},`, { partial: true });
        const rep = g.render({ perspective: 1 });
        const handArea = rep.areas?.find(
            a =>
                typeof a.label === "object" &&
                a.label.textKey === "apgames:validation.thricewise.LABEL_HAND" &&
                a.label.actor?.kind === "seat" &&
                a.label.actor.seat === 1,
        );
        const selEntry = (handArea?.pieces ?? []).find(
            p => typeof p !== "string" && p.text === "Sel",
        );
        expect(selEntry).to.not.equal(undefined);
        expect(typeof selEntry === "object" && selEntry.piece).to.equal(`c${uid}`);
    });

    it("render ignores invalid perspective 0 (front used me+1 when me === -1)", () => {
        const g = new ThricewiseGame(2);
        expect(() => g.render({ perspective: 0 })).to.not.throw();
        const rep = g.render({ perspective: 0 });
        expect(rep.board).to.not.equal(undefined);
    });

    it("omniscient shows all hand cards even when perspective is set", () => {
        const g = new ThricewiseGame(3);
        const twos = cardsOfRank(2);
        const aces = cardsOfRank(1);
        const fours = cardsOfRank(4);
        g.hands = [
            [twos[0]!, twos[1]!],
            [aces[0]!, aces[1]!],
            [fours[0]!, fours[1]!],
        ];
        const unknownCount = (rep: { areas?: { pieces?: string[] }[] }) =>
            (rep.areas ?? [])
                .flatMap(a => a.pieces ?? [])
                .filter(p => p === "cUNKNOWN").length;
        const dimmed = (rep: ReturnType<ThricewiseGame["render"]>, uid: string) => {
            const entry = rep.legend?.[`c${uid}`];
            const layers = Array.isArray(entry) ? entry : entry !== undefined ? [entry] : [];
            return layers.some(
                (layer: { name?: string; opacity?: number }) =>
                    layer.name === "cross-diag" && layer.opacity === 0.5,
            );
        };
        const withPerspective = g.render({ perspective: 1 });
        expect(unknownCount(withPerspective)).to.equal(0);
        expect(dimmed(withPerspective, aces[0]!)).to.equal(true);
        expect(unknownCount(g.render({ perspective: 1, omniscient: true }))).to.equal(0);
    });

    it("dims hidden opponent hand during place with cross-diag, not cUNKNOWN", () => {
        const g = new ThricewiseGame(3);
        const aces = cardsOfRank(1);
        g.phase = "place";
        g.currplayer = 1;
        g.hands[1] = [aces[0]!, aces[1]!];
        const rep = g.render({ perspective: 1 });
        const dimmed = (uid: string) => {
            const entry = rep.legend?.[`c${uid}`];
            const layers = Array.isArray(entry) ? entry : entry !== undefined ? [entry] : [];
            return layers.some(
                (layer: { name?: string; opacity?: number }) =>
                    layer.name === "cross-diag" && layer.opacity === 0.5,
            );
        };
        const oppHand = rep.areas?.find(
            a =>
                typeof a.label === "object" &&
                a.label.textKey === "apgames:validation.thricewise.LABEL_HAND" &&
                a.label.actor?.kind === "seat" &&
                a.label.actor.seat === 2,
        );
        expect(oppHand?.pieces?.every(p => p !== "cUNKNOWN")).to.equal(true);
        expect(oppHand?.pieces).to.deep.equal([`c${aces[0]}`, `c${aces[1]}`]);
        expect(dimmed(aces[0]!)).to.equal(true);
        expect(dimmed(aces[1]!)).to.equal(true);
    });

    it("dims non-obligation hand cards in place even when omniscient", () => {
        const g = new ThricewiseGame(2);
        const twos = cardsOfRank(2);
        const threes = cardsOfRank(3);
        const fours = cardsOfRank(4);
        const fives = cardsOfRank(5);
        g.phase = "place";
        g.currplayer = 1;
        g.deferred = [[twos[0]!], []];
        g.trickCard = [threes[0]!, undefined];
        // Full hands fixture: legend dimming is per uid across all seats in place phase.
        g.hands = [[fours[0]!], [fives[0]!]];
        const rep = g.render({ perspective: 1, omniscient: true });
        const dimmed = (uid: string) => {
            const entry = rep.legend?.[`c${uid}`];
            const layers = Array.isArray(entry) ? entry : entry !== undefined ? [entry] : [];
            return layers.some(
                (layer: { name?: string; opacity?: number }) =>
                    layer.name === "cross-diag" && layer.opacity === 0.5,
            );
        };
        expect(dimmed(twos[0]!)).to.equal(false);
        expect(dimmed(threes[0]!)).to.equal(false);
        expect(dimmed(fours[0]!)).to.equal(true);
    });

    it("opens 2x2 for two players and 2x3 for three", () => {
        const g2 = new ThricewiseGame(2);
        expect(g2.board.cards.length).to.equal(4);
        const g3 = new ThricewiseGame(3);
        expect(g3.board.cards.length).to.equal(6);
    });

    it("defers duplicate ranks and orders distinct ranks", () => {
        const g = new ThricewiseGame(3);
        const twos = cardsOfRank(2);
        const fives = cardsOfRank(5);
        g.hands = [[twos[0], fives[0]], [twos[1], fives[1]], [fives[2], fives[3]]];
        g.move(`${twos[0]},${twos[1]},${fives[2]}`);
        expect(g.phase).to.equal("place");
        expect(g.deferred[0][0]).to.equal(twos[0]);
        expect(g.deferred[1][0]).to.equal(twos[1]);
        expect(g.playQueue).to.deep.equal([3]);
        expect(g.currplayer).to.equal(3);
    });

    it("records select results and chat log lines", () => {
        addResource("en");
        const g = new ThricewiseGame(2);
        const fives = cardsOfRank(5);
        const threes = cardsOfRank(3);
        g.hands = [[fives[0]!, threes[0]!], [fives[1]!, threes[1]!]];
        g.move(`${fives[0]},${threes[1]}`);
        const ply = g.stack[g.stack.length - 1]!;
        const selects = ply._results?.filter(r => r.type === "select") ?? [];
        expect(selects.length).to.equal(2);
        expect(selects.map(s => s.what)).to.deep.equal([fives[0], threes[1]]);
        const lines = g.chatLogEntries(["Alice", "Bob"]).flatMap(e => e.lines);
        const selectLines = lines.filter(l => l.textKey === "apresults:SELECT.thricewise");
        expect(selectLines.length).to.equal(2);
    });

    it("places the only remaining card when clicking an empty cell in place phase", () => {
        const g = new ThricewiseGame(2);
        const threes = cardsOfRank(3);
        const fives = cardsOfRank(5);
        g.hands = [[threes[0], threes[1]], [fives[0], fives[1]]];
        g.move(`${threes[0]},${fives[0]}`);
        const empty = g.legalEmpties()[0]!;
        const rel = g.board.abs2rel(empty[0], empty[1])!;
        const click = g.handleClick("", rel[1], rel[0]);
        expect(click.valid).to.equal(true);
        expect(click.move).to.equal(`${threes[0]}@${empty[0]}.${empty[1]}`);
    });

    it("advances play queue once per compound placement ply", () => {
        const g = new ThricewiseGame(2);
        const threes = cardsOfRank(3);
        const fives = cardsOfRank(5);
        g.hands = [[threes[0], threes[1]], [fives[0], fives[1]]];
        g.move(`${threes[0]},${fives[0]}`);
        expect(g.playQueue).to.deep.equal([1, 2]);
        const empty = g.legalEmpties()[0]!;
        g.move(`${threes[0]}@${empty[0]}.${empty[1]},${SIMULTANEOUS_ELIM_TOKEN}`);
        expect(g.board.cards.some(c => c.card.uid === threes[0])).to.equal(true);
        expect(g.playQueue).to.deep.equal([2]);
        expect(g.currplayer).to.equal(2);
    });

    it("completes second card of a compound placement at typed coordinates after partial", () => {
        const g = new ThricewiseGame(2);
        const fourVL = cardsBasic.find(c => c.uid === "4VL")!;
        const twoVL = cardsBasic.find(c => c.uid === "2VL")!;
        const board = new QuincunxBoard(6);
        for (const [x, y, uid] of [
            [0, 0, "NV"],
            [1, 0, "1Y"],
            [0, -1, "1S"],
            [1, -1, "8MS"],
            [2, -1, "7ML"],
            [-1, 0, "NL"],
            [1, -2, "8VL"],
            [-2, 0, "NY"],
            [1, 1, "1V"],
            [3, -1, "6LK"],
        ] as [number, number, string][]) {
            const card = cardsBasic.find(c => c.uid === uid)!;
            board.add(new QuincunxCard({ x, y, card }));
        }
        g.board = board;
        g.phase = "place";
        g.currplayer = 2;
        g.playQueue = [2, 1];
        g.deferred[1] = [fourVL.uid];
        g.trickCard[1] = twoVL.uid;
        g.hands[1] = [];
        expect(g.validateMove("4VL@2.2;2VL@3.3", 2).complete).to.equal(1);
        const click = g.handleClickSimultaneous("4VL@2.2;2VL", 0, 5, 2);
        expect(click.valid).to.equal(true);
        expect(click.move).to.equal("4VL@2.2;2VL@3.3");
        g.move(`${SIMULTANEOUS_ELIM_TOKEN},${click.move}`);
        const placed = g.board.cards.find(c => c.card.uid === "2VL");
        expect(placed?.x).to.equal(3);
        expect(placed?.y).to.equal(3);
    });

    it("allows placement preview moves when hands are empty but the trick is still placing", () => {
        const g = new ThricewiseGame(2);
        g.phase = "place";
        g.currplayer = 1;
        g.playQueue = [1, 2];
        g.trickCard = ["1K", "NK"];
        g.hands = [[], []];
        g.deferred = [[], []];
        const before = g.board.cards.length;
        g.move("1K@-1.1,", { partial: true });
        expect(g.gameover).to.equal(false);
        expect(g.board.cards.length).to.equal(before + 1);
        expect(g.board.cards.some(c => c.card.uid === "1K" && c.x === -1 && c.y === 1)).to.equal(
            true,
        );
    });

    it("applies partial compound placement on the board", () => {
        const g = new ThricewiseGame(2);
        const twos = cardsOfRank(2);
        const threes = cardsOfRank(3);
        g.phase = "place";
        g.currplayer = 1;
        g.playQueue = [1];
        g.deferred[0] = [twos[0]];
        g.trickCard[0] = threes[0];
        g.hands[0] = [];
        const e1 = g.legalEmpties()[0]!;
        const token = `${twos[0]}@${e1[0]}.${e1[1]}`;
        const before = g.board.cards.length;
        g.move(`${token},${SIMULTANEOUS_ELIM_TOKEN}`, { partial: true });
        expect(g.board.cards.length).to.equal(before + 1);
    });

    it("allows diagonal placement next to an existing card", () => {
        const g = new ThricewiseGame(2);
        const board = new QuincunxBoard(6);
        board.add(
            new QuincunxCard({
                x: 2,
                y: 1,
                card: cardsBasic.find(c => c.uid === "4VL")!,
            }),
        );
        g.board = board;
        g.phase = "place";
        g.currplayer = 1;
        g.playQueue = [1];
        g.trickCard[0] = "1K";
        g.deferred[0] = [];
        g.hands[0] = [];
        const x = 3;
        const y = 2;
        expect(g.board.getCardAt(x, y)).to.equal(undefined);
        const v = g.validateMove(`1K@${x}.${y}`, 1);
        expect(v.valid).to.equal(true);
        expect(g.legalEmpties().some(([ex, ey]) => ex === x && ey === y)).to.equal(true);
    });

    it("legal empties respect the 6x6 cap", () => {
        const g = new ThricewiseGame(2);
        for (const [x, y] of g.legalEmpties()) {
            const w = Math.max(g.board.maxX, x) - Math.min(g.board.minX, x) + 1;
            const h = Math.max(g.board.maxY, y) - Math.min(g.board.minY, y) + 1;
            expect(w).to.be.at.most(6);
            expect(h).to.be.at.most(6);
        }
    });

    it("randomMove always submits a complete placement ply", () => {
        const g = new ThricewiseGame(3);
        const fours = cardsOfRank(4);
        const fives = cardsOfRank(5);
        const nines = cardsOfRank(9);
        g.hands = [
            [fives[0], fours[0], nines[0]],
            [fours[1], fives[1], nines[1]],
            [nines[2], fives[2], fours[2]],
        ];
        g.move(`${fives[0]},${fours[1]},${nines[2]}`);
        expect(g.phase).to.equal("place");
        let guard = 0;
        while (g.phase === "place" && guard++ < 20) {
            const active = g.currplayer;
            const m = g.randomMove();
            const part = m.split(",")[active - 1]!;
            const v = g.validateMove(part, active as 1 | 2 | 3);
            expect(v.valid, part).to.equal(true);
            expect(v.complete, part).to.equal(1);
            g.move(m);
        }
    });

    it("rejects a compound placement that would exceed a 6×6 bounding box", () => {
        const g = new ThricewiseGame(2);
        const twos = cardsOfRank(2);
        const threes = cardsOfRank(3);
        g.phase = "place";
        g.currplayer = 1;
        g.playQueue = [1];
        g.deferred[0] = [twos[0], threes[0]];
        g.hands[0] = [];
        let i = 0;
        while (g.board.cards.length < 30) {
            const empty = g.legalEmpties()[0];
            if (empty === undefined) {
                break;
            }
            g.board.add(new QuincunxCard({ x: empty[0], y: empty[1], card: cardsBasic[i++]! }));
        }
        const top = g.board.maxY + 1;
        const token = `${twos[0].toUpperCase()}@${g.board.minX}.${top};${threes[0].toUpperCase()}@${g.board.minX}.${top + 1}`;
        const v = g.validateMove(token, 1);
        expect(v.valid).to.equal(false);
    });

    it("deck area excludes every card accounted for in state", () => {
        const g = new ThricewiseGame(2);
        const deckPieceCount = (rep: ReturnType<ThricewiseGame["render"]>) =>
            rep.areas?.find(
                a =>
                    typeof a.label === "object" &&
                    a.label.textKey === "apgames:validation.thricewise.LABEL_DECK",
            )?.pieces?.length ?? 0;
        const accountedCount = (game: ThricewiseGame) => {
            const onboard = game.board.cards.length;
            const inHands = game.hands.flat().filter(uid => uid !== "").length;
            const deferred = game.deferred.flat().filter(uid => uid != null && uid !== "").length;
            const tricks = game.trickCard.filter(uid => uid != null && uid !== "").length;
            return onboard + inHands + deferred + tricks;
        };
        expect(deckPieceCount(g.render({ perspective: 1 }))).to.equal(36 - accountedCount(g));
        expect(deckPieceCount(g.render({ perspective: 1, omniscient: true }))).to.equal(
            36 - accountedCount(g),
        );
        g.phase = "place";
        g.currplayer = 1;
        expect(deckPieceCount(g.render({ perspective: 1, omniscient: true }))).to.equal(
            36 - accountedCount(g),
        );
        const stripped = new ThricewiseGame(2);
        const hiddenCount = stripped.hands[1].filter(uid => uid !== "").length;
        stripped.hands[1] = stripped.hands[1].map(() => "");
        const fullStateDeck = deckPieceCount(new ThricewiseGame(2).render({ perspective: 1 }));
        expect(deckPieceCount(stripped.render({ perspective: 1 }))).to.equal(
            fullStateDeck + hiddenCount,
        );
    });

    it("deck area pieces are never shown with cross-diag overlay", () => {
        const g = new ThricewiseGame(3);
        const aces = cardsOfRank(1);
        g.phase = "place";
        g.currplayer = 1;
        g.hands[1] = [aces[0]!, aces[1]!];
        const rep = g.render({ perspective: 1 });
        const deckArea = rep.areas?.find(
            a =>
                typeof a.label === "object" &&
                a.label.textKey === "apgames:validation.thricewise.LABEL_DECK",
        );
        const dimmed = (uid: string) => {
            const entry = rep.legend?.[`c${uid}`];
            const layers = Array.isArray(entry) ? entry : entry !== undefined ? [entry] : [];
            return layers.some(
                (layer: { name?: string; opacity?: number }) =>
                    layer.name === "cross-diag" && layer.opacity === 0.5,
            );
        };
        for (const piece of deckArea?.pieces ?? []) {
            const key = typeof piece === "string" ? piece : piece.piece;
            expect(key.startsWith("c")).to.equal(true);
            expect(dimmed(key.slice(1))).to.equal(false);
        }
    });

    it("viewport 6 allows neighbors outside a solid 5×5 block (Jacynth stays at 5)", () => {
        expect(new ThricewiseGame(2).board.viewportSize).to.equal(6);
        const jacynth = new QuincunxBoard();
        const thricewise = new QuincunxBoard(6);
        let i = 0;
        for (let y = 0; y < 5; y++) {
            for (let x = 0; x < 5; x++) {
                const card = cardsBasic[i++]!;
                jacynth.add(new QuincunxCard({ x, y, card }));
                thricewise.add(new QuincunxCard({ x, y, card }));
            }
        }
        expect(jacynth.empties.length).to.equal(0);
        expect(thricewise.empties.length).to.be.greaterThan(0);
    });
});

describe("Thricewise scoring", () => {
    it("values a straight by the lowest number rank", () => {
        const eights = cardsOfRank(8);
        const nines = cardsOfRank(9);
        const crowns = cardsOfRank(10);
        expect(threesomeValue([eights[0], nines[0], crowns[0]])).to.equal(8);
    });

    it("scores a placed line of three", () => {
        const eights = cardsOfRank(8);
        const nines = cardsOfRank(9);
        const crowns = cardsOfRank(10);
        const board = new QuincunxBoard();
        board.add(new QuincunxCard({ x: 0, y: 0, card: cardsBasic.find(c => c.uid === eights[0])! }));
        board.add(new QuincunxCard({ x: 1, y: 0, card: cardsBasic.find(c => c.uid === nines[0])! }));
        const placed = new QuincunxCard({
            x: 2,
            y: 0,
            card: cardsBasic.find(c => c.uid === crowns[0])!,
        });
        board.add(placed);
        expect(scorePlacement(board, placed)).to.be.greaterThan(0);
    });
});
