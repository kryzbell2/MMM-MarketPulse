"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
    calculate321Crack,
    calculateDieselCrack,
    isWeekend,
    percentChange
} = require("../lib/market_utils");

test("calculates the simple ULSD-WTI crack in dollars per barrel", () => {
    assert.equal(calculateDieselCrack(4.37, 86.21), 97.33);
});

test("calculates the indicative 3-2-1 crack", () => {
    const expected = (((2 * 2.8 * 42) + (4.37 * 42)) - (3 * 86.21)) / 3;
    assert.equal(calculate321Crack(2.8, 4.37, 86.21), expected);
});

test("calculations reject missing, non-numeric, and infinite inputs", () => {
    assert.equal(calculateDieselCrack(null, 86.21), null);
    assert.equal(calculateDieselCrack(Number.NaN, 86.21), null);
    assert.equal(calculate321Crack(2.8, undefined, 86.21), null);
    assert.equal(calculate321Crack(2.8, 4.37, Number.POSITIVE_INFINITY), null);
    assert.equal(percentChange(10, 0), null);
});

test("calculates percentage change from previous close", () => {
    assert.equal(percentChange(90, 100), -10);
});

test("weekend visibility uses the host-local day", () => {
    assert.equal(isWeekend(new Date(2026, 7, 22, 12)), true, "Saturday should be hidden");
    assert.equal(isWeekend(new Date(2026, 7, 23, 12)), true, "Sunday should be hidden");
    assert.equal(isWeekend(new Date(2026, 7, 24, 12)), false, "Monday should be visible");
    assert.equal(isWeekend(new Date("not-a-date")), false);
});
