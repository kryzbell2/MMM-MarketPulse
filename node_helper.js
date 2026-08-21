"use strict";

const NodeHelper = require("node_helper");
const { fetchEiaDiesel, fetchYahooQuote } = require("./lib/providers");
const {
    calculate321Crack,
    calculateDieselCrack,
    isFiniteNumber
} = require("./lib/market_utils");

const DEFAULT_MARKET_INTERVAL = 300000;
const DEFAULT_EIA_INTERVAL = 21600000;
const MIN_MARKET_INTERVAL = 60000;
const MIN_EIA_INTERVAL = 3600000;
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
        this.eiaCache = null;
        this.marketTimer = null;
        this.eiaTimer = null;
        this.marketRequest = null;
        this.eiaRequest = null;
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
            eiaUpdateInterval: safeInterval(payload?.eiaUpdateInterval, DEFAULT_EIA_INTERVAL, MIN_EIA_INTERVAL)
        };

        this.clearTimers();
        this.refreshMarket();
        if (this.config.showDieselAverage) {
            this.refreshEia();
        }

        this.marketTimer = setInterval(() => this.refreshMarket(), this.config.updateInterval);
        if (this.config.showDieselAverage) {
            this.eiaTimer = setInterval(() => this.refreshEia(), this.config.eiaUpdateInterval);
        }
    },

    clearTimers() {
        if (this.marketTimer) {
            clearInterval(this.marketTimer);
            this.marketTimer = null;
        }
        if (this.eiaTimer) {
            clearInterval(this.eiaTimer);
            this.eiaTimer = null;
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

    async refreshEia() {
        if (!this.config || this.eiaRequest) {
            return this.eiaRequest;
        }

        this.eiaRequest = (async () => {
            try {
                const diesel = await fetchEiaDiesel({ timeout: REQUEST_TIMEOUT });
                this.eiaCache = {
                    ...diesel,
                    fetchedAt: new Date().toISOString()
                };
            } catch (error) {
                console.error(`[MMM-MarketPulse] EIA diesel fetch/parser failed: ${error.message}`);
            }
            this.sendCurrentData();
        })();

        try {
            await this.eiaRequest;
        } finally {
            this.eiaRequest = null;
        }

        return null;
    },

    sendCurrentData() {
        const now = Date.now();
        const marketStaleAfter = Math.max(this.config.updateInterval * 3, 900000);
        const eiaStaleAfter = Math.max(this.config.eiaUpdateInterval * 2, 43200000);
        const market = Object.fromEntries(Object.entries(this.marketCache).map(([key, quote]) => [key, {
            ...quote,
            stale: !Date.parse(quote.fetchedAt) || now - Date.parse(quote.fetchedAt) > marketStaleAfter
        }]));
        const retailDiesel = this.eiaCache ? {
            ...this.eiaCache,
            stale: !Date.parse(this.eiaCache.fetchedAt) || now - Date.parse(this.eiaCache.fetchedAt) > eiaStaleAfter
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
