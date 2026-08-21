"use strict";

const https = require("node:https");
const { percentChange, isFiniteNumber } = require("./market_utils");

const DEFAULT_USER_AGENT = "MMM-MarketPulse/1.0 (+https://github.com/kryzbell2/MMM-MarketPulse)";
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

function fetchText(url, options = {}, redirectsRemaining = 3) {
    const timeout = isFiniteNumber(options.timeout) ? options.timeout : 12000;
    const userAgent = options.userAgent || DEFAULT_USER_AGENT;

    return new Promise((resolve, reject) => {
        const request = https.get(url, {
            headers: {
                Accept: "application/json,text/html;q=0.9,*/*;q=0.8",
                "User-Agent": userAgent
            },
            timeout
        }, (response) => {
            const status = response.statusCode || 0;

            if (status >= 300 && status < 400 && response.headers.location && redirectsRemaining > 0) {
                response.resume();
                const redirectUrl = new URL(response.headers.location, url).toString();
                resolve(fetchText(redirectUrl, options, redirectsRemaining - 1));
                return;
            }

            if (status < 200 || status >= 300) {
                response.resume();
                reject(new Error(`HTTP ${status} from ${new URL(url).hostname}`));
                return;
            }

            const chunks = [];
            let totalBytes = 0;

            response.on("data", (chunk) => {
                totalBytes += chunk.length;
                if (totalBytes > MAX_RESPONSE_BYTES) {
                    request.destroy(new Error("Response exceeded 2 MiB safety limit"));
                    return;
                }
                chunks.push(chunk);
            });
            response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        });

        request.on("timeout", () => request.destroy(new Error(`Request timed out after ${timeout} ms`)));
        request.on("error", reject);
    });
}

function lastFinite(values) {
    if (!Array.isArray(values)) {
        return null;
    }

    for (let index = values.length - 1; index >= 0; index -= 1) {
        if (isFiniteNumber(values[index])) {
            return values[index];
        }
    }
    return null;
}

function finiteValues(values) {
    return Array.isArray(values) ? values.filter(isFiniteNumber) : [];
}

function parseYahooChart(input, expectedSymbol) {
    let payload;
    try {
        payload = typeof input === "string" ? JSON.parse(input) : input;
    } catch (error) {
        throw new Error(`Yahoo returned invalid JSON: ${error.message}`);
    }

    if (payload?.chart?.error) {
        const yahooError = payload.chart.error;
        throw new Error(`Yahoo error: ${yahooError.description || yahooError.code || "unknown error"}`);
    }

    const result = payload?.chart?.result?.[0];
    if (!result || !result.meta) {
        throw new Error("Yahoo response did not contain a chart result");
    }

    if (expectedSymbol && result.meta.symbol && result.meta.symbol !== expectedSymbol) {
        throw new Error(`Yahoo returned ${result.meta.symbol} while ${expectedSymbol} was requested`);
    }

    const closes = finiteValues(result.indicators?.quote?.[0]?.close);
    const price = isFiniteNumber(result.meta.regularMarketPrice)
        ? result.meta.regularMarketPrice
        : lastFinite(closes);

    if (!isFiniteNumber(price)) {
        throw new Error("Yahoo response did not contain a valid market price");
    }

    let previousClose = isFiniteNumber(result.meta.chartPreviousClose)
        ? result.meta.chartPreviousClose
        : result.meta.previousClose;

    if (!isFiniteNumber(previousClose) && closes.length >= 2) {
        const lastClose = closes[closes.length - 1];
        previousClose = Math.abs(lastClose - price) < 1e-9
            ? closes[closes.length - 2]
            : lastClose;
    }

    const timestamps = finiteValues(result.timestamp);
    const marketEpoch = isFiniteNumber(result.meta.regularMarketTime)
        ? result.meta.regularMarketTime
        : lastFinite(timestamps);

    return {
        symbol: result.meta.symbol || expectedSymbol || null,
        price,
        previousClose: isFiniteNumber(previousClose) ? previousClose : null,
        changePercent: percentChange(price, previousClose),
        marketTime: isFiniteNumber(marketEpoch) ? new Date(marketEpoch * 1000).toISOString() : null,
        currency: result.meta.currency || null
    };
}

function decodeHtml(text) {
    return text
        .replace(/&nbsp;|&#160;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, "\"")
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&ndash;|&#8211;/gi, "-")
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)));
}

function textContent(html) {
    return decodeHtml(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " "))
        .replace(/\s+/g, " ")
        .trim();
}

function parseUsDate(value) {
    const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
    if (!match) {
        return null;
    }

    const yearNumber = Number.parseInt(match[3], 10);
    const year = yearNumber < 100 ? 2000 + yearNumber : yearNumber;
    const month = Number.parseInt(match[1], 10);
    const day = Number.parseInt(match[2], 10);
    const date = new Date(Date.UTC(year, month - 1, day));

    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function parseLongDate(value) {
    const date = new Date(`${value} 00:00:00 UTC`);
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function parseEiaDiesel(html) {
    if (typeof html !== "string" || html.trim() === "") {
        throw new Error("EIA response was empty");
    }

    const pageText = textContent(html);
    const releaseMatch = pageText.match(/Diesel Fuel Release Date:\s*([A-Za-z]+\s+\d{1,2},\s+\d{4})/i);
    const releaseDate = releaseMatch ? parseLongDate(releaseMatch[1]) : null;
    if (!/U\.S\.\s*On-Highway Diesel Fuel Prices/i.test(pageText)) {
        throw new Error("Could not find the EIA on-highway diesel section");
    }

    const tables = html.match(/<table\b[^>]*>[\s\S]*?<\/table>/gi) || [];
    const tableHtml = tables.find((table) => /U\.S\.\s*On-Highway Diesel Fuel Prices/i.test(textContent(table)));
    if (!tableHtml) {
        throw new Error("Could not find the EIA diesel price table");
    }

    const dateMatches = [...textContent(tableHtml).matchAll(/\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/g)]
        .map((match) => match[1]);
    const dates = [...new Set(dateMatches)].slice(0, 3);
    const rows = tableHtml.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || [];
    const usRow = rows.find((row) => {
        const cells = [...row.matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)]
            .map((match) => textContent(match[1]));
        return cells.length > 1 && /^U\.S\.?$/i.test(cells[0]);
    });

    if (!usRow) {
        throw new Error("Could not find the U.S. row in the EIA diesel table");
    }

    const cells = [...usRow.matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)]
        .map((match) => textContent(match[1]));
    const values = cells.slice(1)
        .map((cell) => Number.parseFloat(cell.replace(/,/g, "")));
    const observationCount = dates.length || Math.min(values.length, 3);
    const latestIndex = observationCount - 1;
    const price = values[latestIndex];

    if (!isFiniteNumber(price) || price <= 0 || price > 20) {
        throw new Error("The latest EIA U.S. diesel value was missing or implausible");
    }

    return {
        price,
        date: dates[latestIndex] ? parseUsDate(dates[latestIndex]) : null,
        releaseDate
    };
}

async function fetchYahooQuote(symbol, options = {}) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
    const body = await fetchText(url, options);
    return parseYahooChart(body, symbol);
}

async function fetchEiaDiesel(options = {}) {
    const body = await fetchText("https://www.eia.gov/petroleum/gasdiesel/", options);
    return parseEiaDiesel(body);
}

module.exports = {
    DEFAULT_USER_AGENT,
    fetchEiaDiesel,
    fetchText,
    fetchYahooQuote,
    parseEiaDiesel,
    parseYahooChart
};
