"use strict";

const NodeHelper = require("node_helper");
const { fetchAaaDiesel, fetchYahooQuote } = require("./lib/providers");
const {
    calculate321Crack,
    calculateDieselCrack,
    isFiniteNumber
} = require("./lib/market_utils");

const DEFAULT_MARKET_INTERVAL = 300000;
const DEFAULT_AAA_INTERVAL = 14400000;
const MIN_MARKET_INTERVAL = 60000;
const MIN_AAA_INTERVAL = 10800000;
const REQUEST_TIMEOUT = 12000;

const MARKET_DEFINITIONS = {
    wti: { symbol: "CL=F", enabled: (config) => config.showWTI || config.showDieselCrack || config.show321Crack },
    brent: { symbol: "BZ=F", enabled: (config) => config.showBrent },
    ulsd: { symbol: "HO=F", enabled: (config) => config.showULSD || config.showDieselCrack || config.show321Crack },
    rbob: { symbol: "RB=F", enabled: (config) => config.show321Crack },
    tenYear: { symbol: "^TNX", enabled: (config) => config.showTenYearYield }
};

function safeInterval(value, fallback, minimum) {
    return isFiniteNumber(value) ? Math.max(value, minimum) : fallback;
}

module.exports = NodeHelper.create({
    start() {
        this.config = null;
        this.marketCache = {};
        this.aaaCache = null;
        this.marketTimer = null;
        this.aaaTimer = null;
        this.marketRequest = null;
        this.aaaRequest = null;
    },

    stop() {
        this.clearTimers();
    },

    socketNotificationReceived(notification, payload) {
        if (notification !== "MARKETPULSE_INIT") {
            return;
        }

        this.config = {
            showWTI: payload?.showWTI !== false,
            showBrent: payload?.showBrent !== false,
            showULSD: payload?.showULSD !== false,
            showDieselAverage: payload?.showDieselAverage !== false,
            showDieselCrack: payload?.showDieselCrack !== false,
            show321Crack: payload?.show321Crack === true,
            showTenYearYield: payload?.showTenYearYield !== false,
            updateInterval: safeInterval(payload?.updateInterval, DEFAULT_MARKET_INTERVAL, MIN_MARKET_INTERVAL),
            dieselRegion: payload?.dieselRegion || "US",
            aaaUpdateInterval: safeInterval(payload?.aaaUpdateInterval, DEFAULT_AAA_INTERVAL, MIN_AAA_INTERVAL)
        };

        if (this.aaaCache?.region !== String(this.config.dieselRegion).trim().toUpperCase()) this.aaaCache = null;
        this.clearTimers();
        this.refreshMarket();
        if (this.config.showDieselAverage) {
            this.refreshAaa();
        }

        this.marketTimer = setInterval(() => this.refreshMarket(), this.config.updateInterval);
        if (this.config.showDieselAverage) {
            this.aaaTimer = setInterval(() => this.refreshAaa(), this.config.aaaUpdateInterval);
        }
    },

    clearTimers() {
        if (this.marketTimer) {
            clearInterval(this.marketTimer);
            this.marketTimer = null;
        }
        if (this.aaaTimer) {
            clearInterval(this.aaaTimer);
            this.aaaTimer = null;
        }
    },

    async refreshMarket() {
        if (!this.config || this.marketRequest) {
            return this.marketRequest;
        }

        const entries = Object.entries(MARKET_DEFINITIONS)
            .filter(([, definition]) => definition.enabled(this.config));

        this.marketRequest = Promise.allSettled(entries.map(async ([key, definition]) => {
            try {
                const quote = await fetchYahooQuote(definition.symbol, { timeout: REQUEST_TIMEOUT });
                this.marketCache[key] = {
                    ...quote,
                    fetchedAt: new Date().toISOString()
                };
            } catch (error) {
                console.error(`[MMM-MarketPulse] Yahoo ${definition.symbol} failed: ${error.message}`);
            }
        }));

        try {
            await this.marketRequest;
            this.sendCurrentData();
        } finally {
            this.marketRequest = null;
        }

        return null;
    },

    async refreshAaa() {
        if (!this.config || this.aaaRequest) {
            return this.aaaRequest;
        }

        this.aaaRequest = (async () => {
            try {
                const region = this.config.dieselRegion;
                const diesel = await fetchAaaDiesel({ timeout: REQUEST_TIMEOUT, region });
                if (region !== this.config.dieselRegion) return;
                this.aaaCache = {
                    ...diesel,
                    fetchedAt: new Date().toISOString()
                };
            } catch (error) {
                console.error(`[MMM-MarketPulse] AAA diesel fetch/parser failed: ${error.message}`);
            }
            this.sendCurrentData();
        })();

        try {
            await this.aaaRequest;
        } finally {
            this.aaaRequest = null;
        }

        return null;
    },

    sendCurrentData() {
        const now = Date.now();
        const marketStaleAfter = Math.max(this.config.updateInterval * 3, 900000);
        const aaaStaleAfter = Math.max(this.config.aaaUpdateInterval * 2, 43200000);
        const market = Object.fromEntries(Object.entries(this.marketCache).map(([key, quote]) => [key, {
            ...quote,
            stale: !Date.parse(quote.fetchedAt) || now - Date.parse(quote.fetchedAt) > marketStaleAfter
        }]));
        const retailDiesel = this.aaaCache ? {
            ...this.aaaCache,
            stale: !Date.parse(this.aaaCache.fetchedAt) || now - Date.parse(this.aaaCache.fetchedAt) > aaaStaleAfter
        } : null;
        const wti = market.wti?.price;
        const ulsd = market.ulsd?.price;
        const rbob = market.rbob?.price;

        this.sendSocketNotification("MARKETPULSE_DATA", {
            receivedAt: new Date().toISOString(),
            market,
            retailDiesel,
            calculated: {
                dieselCrack: calculateDieselCrack(ulsd, wti),
                crack321: calculate321Crack(rbob, ulsd, wti)
            }
        });
    }
});
