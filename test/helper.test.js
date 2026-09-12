"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
function helper(fetchAaaDiesel) {
    const timers = [];
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../node_helper.js"), "utf8"), {
        module, require(name) {
            if (name === "node_helper") return { create: (value) => value };
            if (name === "./lib/providers") return { fetchAaaDiesel, fetchYahooQuote: async () => ({ price: 80 }) };
            return require(path.join(__dirname, "..", name));
        }, console: { error() {} }, Date, setInterval(fn, ms) { timers.push(ms); return timers.length; }, clearInterval() {}
    });
    const instance = module.exports;
    instance.start();
    instance.sendSocketNotification = (_, data) => { instance.sent = data; };
    instance.config = { updateInterval: 300000, aaaUpdateInterval: 14400000, dieselRegion: "US" };
    return { instance, timers };
}
test("AAA failure retains last valid value and timestamp; market calculations survive", async () => {
    let fail = false;
    const { instance } = helper(async () => { if (fail) throw new Error("offline"); return { price: 5, date: "2026-09-12", region: "US" }; });
    instance.marketCache = { wti: { price: 80 }, ulsd: { price: 3 }, rbob: { price: 2 } };
    await instance.refreshAaa();
    const cached = instance.aaaCache;
    cached.fetchedAt = new Date(Date.now() - 13 * 3600000).toISOString();
    fail = true;
    await instance.refreshAaa();
    assert.equal(instance.aaaCache, cached);
    assert.equal(instance.sent.retailDiesel.price, 5);
    assert.equal(instance.sent.retailDiesel.stale, true);
    assert.equal(instance.sent.calculated.dieselCrack, 46);
    assert.equal(instance.sent.calculated.crack321, 18);
    assert.equal(instance.aaaRequest, null);
});
test("first AAA failure sends unavailable retail without rejecting", async () => {
    const { instance } = helper(async () => { throw new Error("bad HTML"); });
    await instance.refreshAaa();
    assert.equal(instance.sent.retailDiesel, null);
});
test("AAA cadence defaults to four hours and clamps to three hours", () => {
    const { instance, timers } = helper(async () => ({}));
    instance.refreshMarket = () => {};
    instance.refreshAaa = () => {};
    instance.socketNotificationReceived("MARKETPULSE_INIT", {});
    assert.equal(timers.at(-1), 14400000);
    instance.socketNotificationReceived("MARKETPULSE_INIT", { aaaUpdateInterval: 1, dieselRegion: "NC" });
    assert.equal(timers.at(-1), 10800000);
    assert.equal(instance.config.dieselRegion, "NC");
});
