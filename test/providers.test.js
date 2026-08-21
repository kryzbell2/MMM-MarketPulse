"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { parseEiaDiesel, parseYahooChart } = require("../lib/providers");

const fixture = (name) => fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");

test("extracts price, previous close, change, and timestamp from Yahoo chart data", () => {
    const quote = parseYahooChart(fixture("yahoo-chart.json"), "CL=F");

    assert.equal(quote.symbol, "CL=F");
    assert.equal(quote.price, 86.21);
    assert.equal(quote.previousClose, 87.25);
    assert.ok(Math.abs(quote.changePercent - (-1.1919770773638978)) < 1e-12);
    assert.match(quote.marketTime, /^2026-/);
});

test("Yahoo parser falls back to the last two finite closes", () => {
    const payload = JSON.parse(fixture("yahoo-chart.json"));
    delete payload.chart.result[0].meta.regularMarketPrice;
    delete payload.chart.result[0].meta.chartPreviousClose;
    payload.chart.result[0].indicators.quote[0].close.push(null);

    const quote = parseYahooChart(payload, "CL=F");
    assert.equal(quote.price, 86.21);
    assert.equal(quote.previousClose, 87.25);
});

test("Yahoo parser reports malformed and missing values", () => {
    assert.throws(() => parseYahooChart("not json", "CL=F"), /invalid JSON/);
    assert.throws(() => parseYahooChart({ chart: { result: null, error: null } }, "CL=F"), /chart result/);

    const payload = JSON.parse(fixture("yahoo-chart.json"));
    payload.chart.result[0].meta.regularMarketPrice = null;
    payload.chart.result[0].indicators.quote[0].close = [null, "bad"];
    assert.throws(() => parseYahooChart(payload, "CL=F"), /valid market price/);
});

test("extracts the latest U.S. diesel observation and release date from EIA HTML", () => {
    const diesel = parseEiaDiesel(fixture("eia-diesel.html"));

    assert.deepEqual(diesel, {
        price: 5.454,
        date: "2026-08-17",
        releaseDate: "2026-08-18"
    });
});

test("EIA parser fails clearly without silently inventing a diesel value", () => {
    assert.throws(() => parseEiaDiesel("<html><body>temporarily unavailable</body></html>"), /diesel section/);

    const malformed = fixture("eia-diesel.html").replace("5.454", "not available");
    assert.throws(() => parseEiaDiesel(malformed), /missing or implausible/);
});
