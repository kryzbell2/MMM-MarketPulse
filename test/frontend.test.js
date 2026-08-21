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
