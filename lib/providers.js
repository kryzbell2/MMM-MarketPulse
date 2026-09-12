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

    return date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day
        ? null : date.toISOString().slice(0, 10);
}

const STATE_NAMES = Object.fromEntries("AL:Alabama|AK:Alaska|AZ:Arizona|AR:Arkansas|CA:California|CO:Colorado|CT:Connecticut|DE:Delaware|DC:District of Columbia|FL:Florida|GA:Georgia|HI:Hawaii|ID:Idaho|IL:Illinois|IN:Indiana|IA:Iowa|KS:Kansas|KY:Kentucky|LA:Louisiana|ME:Maine|MD:Maryland|MA:Massachusetts|MI:Michigan|MN:Minnesota|MS:Mississippi|MO:Missouri|MT:Montana|NE:Nebraska|NV:Nevada|NH:New Hampshire|NJ:New Jersey|NM:New Mexico|NY:New York|NC:North Carolina|ND:North Dakota|OH:Ohio|OK:Oklahoma|OR:Oregon|PA:Pennsylvania|RI:Rhode Island|SC:South Carolina|SD:South Dakota|TN:Tennessee|TX:Texas|UT:Utah|VT:Vermont|VA:Virginia|WA:Washington|WV:West Virginia|WI:Wisconsin|WY:Wyoming".split("|").map((entry) => entry.split(":")));

function normalizeDieselRegion(region = "US") {
    const code = String(region).trim().toUpperCase();
    if (code !== "US" && !Object.hasOwn(STATE_NAMES, code)) {
        throw new Error(`Unsupported AAA dieselRegion: ${code}; use US or a state abbreviation`);
    }
    return code;
}

function parseAaaDiesel(html, region = "US") {
    const code = normalizeDieselRegion(region);
    const location = code === "US" ? "National" : STATE_NAMES[code];
    if (typeof html !== "string" || !html.trim()) throw new Error("AAA response was empty");
    // Anchor to the requested aggregate heading, never the headline gasoline price or metro tables.
    const headings = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)];
    const heading = headings.find((match) => textContent(match[1]).toLowerCase() === `${location} average gas prices`.toLowerCase());
    if (!heading) throw new Error(`Could not find AAA ${location} average gas prices heading`);
    const table = html.slice(heading.index + heading[0].length).match(/<table\b[^>]*>[\s\S]*?<\/table>/i)?.[0];
    const rows = (table || "").match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || [];
    const cells = (row) => [...row.matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)].map((match) => textContent(match[1]));
    const headers = rows.length ? cells(rows[0]) : [];
    const dieselIndex = headers.findIndex((cell) => /^Diesel$/i.test(cell));
    const current = rows.map(cells).find((row) => /^Current Avg\.$/i.test(row[0]));
    const value = dieselIndex > 0 ? current?.[dieselIndex] : null;
    const price = /^\$\s*\d+(?:\.\d+)?$/.test(value || "") ? Number(value.replace(/[$\s]/g, "")) : NaN;
    if (!isFiniteNumber(price) || price <= 0 || price > 20) throw new Error("AAA current diesel value was missing or implausible");
    const dates = [...textContent(html.slice(0, heading.index)).matchAll(/Price as of\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\b/gi)];
    const date = dates.length ? parseUsDate(dates[dates.length - 1][1]) : null;
    if (!date) throw new Error("AAA publication date was missing or invalid");
    return { price, date, region: code, source: "AAA" };
}

async function fetchYahooQuote(symbol, options = {}) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
    const body = await fetchText(url, options);
    return parseYahooChart(body, symbol);
}

async function fetchAaaDiesel(options = {}) {
    const region = normalizeDieselRegion(options.region);
    const url = `https://gasprices.aaa.com/${region === "US" ? "" : `?state=${region}`}`;
    return parseAaaDiesel(await fetchText(url, options), region);
}

module.exports = { DEFAULT_USER_AGENT, fetchAaaDiesel, fetchText, fetchYahooQuote, normalizeDieselRegion, parseAaaDiesel, parseYahooChart };
