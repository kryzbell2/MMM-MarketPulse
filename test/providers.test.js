"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { parseAaaDiesel, parseYahooChart } = require("../lib/providers");

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

test("AAA extracts national and state diesel, not headline gasoline", () => {
    assert.deepEqual(parseAaaDiesel(fixture("aaa-us.html")), { price: 6.1602, date: "2026-09-12", region: "US", source: "AAA" });
    assert.equal(parseAaaDiesel(fixture("aaa-nc.html"), "nc").price, 5.9819);
});

test("AAA rejects missing, wrong-region and malformed data", () => {
    const html = fixture("aaa-us.html");
    for (const value of ["N/A", "$0", "$21", "$6.16bad"]) {
        assert.throws(() => parseAaaDiesel(html.replace("$6.1602", value)), /missing or implausible/);
    }
    assert.throws(() => parseAaaDiesel(html, "NC"), /heading/);
    assert.throws(() => parseAaaDiesel(html, "XX"), /Unsupported/);
    assert.throws(() => parseAaaDiesel(""), /empty/);
    assert.throws(() => parseAaaDiesel(html.replace("Diesel</th>", "Other</th>")), /missing or implausible/);
    assert.throws(() => parseAaaDiesel(html.replace("9/12/26", "2/30/26")), /date/);
});
