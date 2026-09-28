import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

const store = new Map();
globalThis.window = {
    localStorage: {
        getItem: (key) => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => {
            store.set(key, value);
        },
        removeItem: (key) => {
            store.delete(key);
        },
    },
};

const {
    engineSupportsPlayerStrip,
    liveStripPlayer,
    setViewMode,
    shouldStripForLiveView,
    STORAGE,
} = await import("../../playground/playgroundSimultaneous.mjs");

describe("playground view mode helpers", () => {
    beforeEach(() => {
        store.clear();
    });

    it("engineSupportsPlayerStrip is true when P1 and P2 stripped serializations differ", () => {
        const engine = {
            numplayers: 2,
            serialize(opts) {
                if (opts?.strip && opts.player === 1) {
                    return '{"v":1}';
                }
                if (opts?.strip && opts.player === 2) {
                    return '{"v":2}';
                }
                return '{"v":"full"}';
            },
        };
        assert.equal(engineSupportsPlayerStrip(engine), true);
    });

    it("engineSupportsPlayerStrip is false when strip does not change state", () => {
        const engine = {
            numplayers: 2,
            serialize() {
                return '{"same":true}';
            },
        };
        assert.equal(engineSupportsPlayerStrip(engine), false);
    });

    it("shouldStripForLiveView is false in God view", () => {
        setViewMode("god");
        const engine = {
            gameover: false,
            numplayers: 2,
            serialize(opts) {
                return opts?.strip ? `p${opts.player}` : "full";
            },
        };
        assert.equal(shouldStripForLiveView(engine), false);
    });

    it("shouldStripForLiveView is false when game is over", () => {
        store.set(STORAGE.viewMode, "live");
        const engine = {
            gameover: true,
            numplayers: 2,
            serialize(opts) {
                return opts?.strip ? `p${opts.player}` : "full";
            },
        };
        assert.equal(shouldStripForLiveView(engine), false);
    });

    it("shouldStripForLiveView is true in Live view for strippable engines", () => {
        store.set(STORAGE.viewMode, "live");
        const engine = {
            gameover: false,
            numplayers: 2,
            serialize(opts) {
                if (!opts?.strip) {
                    return "full";
                }
                return opts.player === 1 ? "one" : "two";
            },
        };
        assert.equal(shouldStripForLiveView(engine), true);
    });

    it("liveStripPlayer uses currplayer for turn-based games", () => {
        const engine = { currplayer: 2 };
        assert.equal(liveStripPlayer(engine, false, 1), 2);
    });

    it("liveStripPlayer uses active seat for simultaneous games", () => {
        const engine = { currplayer: 2 };
        assert.equal(liveStripPlayer(engine, true, 1), 1);
    });
});
