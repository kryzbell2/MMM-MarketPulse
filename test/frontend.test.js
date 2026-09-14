"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadDefinition() {
    let definition;
    const source = fs.readFileSync(path.join(__dirname, "..", "MMM-MarketPulse.js"), "utf8");
    vm.runInNewContext(source, {
        Module: {
            register(name, registeredDefinition) {
                assert.equal(name, "MMM-MarketPulse");
                definition = registeredDefinition;
            }
        }
    });
    return definition;
}

test("preserves MagicMirror's module placement metadata", () => {
    const definition = loadDefinition();
    const placementData = { position: "top_right", classes: "MMM-MarketPulse" };
    const instance = Object.create(definition);
    instance.data = placementData;
    instance.config = {};
    instance.sendSocketNotification = () => {};
    instance.startWeekendTimer = () => {};
    instance.updateDom = () => {};

    definition.start.call(instance);
    assert.equal(instance.data, placementData);
    assert.equal(instance.marketData, null);

    const payload = { market: { wti: { price: 75 } } };
    definition.socketNotificationReceived.call(instance, "MARKETPULSE_DATA", payload);
    assert.equal(instance.data, placementData);
    assert.equal(instance.marketData, payload);
});

test("uses national gas and regional diesel labels with dated AAA tooltip", () => {
    const instance = Object.create(loadDefinition());
    instance.config = { ...instance.defaults, dieselRegion: "NC" };
    instance.marketData = { market: { ulsd: { price: 3 } }, retailGas: { price: 4.31, date: "2026-09-14", stale: true }, retailDiesel: { region: "NC", price: 4, date: "2026-09-12" } };
    const metrics = instance.buildMetrics();
    const gas = metrics.find((metric) => metric.label === "US Gas");
    assert.equal(gas.value, "$4.31");
    assert.equal(gas.stale, true);
    assert.equal(gas.change, null);
    assert.match(gas.title, /regular gasoline.*2026-09-14/);
    assert.ok(!metrics.some((metric) => metric.label === "Diesel Fut."));
    assert.match(metrics.find((metric) => metric.label === "NC Diesel").title, /AAA NC.*2026-09-12/);
});
