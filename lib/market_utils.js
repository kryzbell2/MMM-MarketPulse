(function marketPulseUtilsModule(root, factory) {
    const utils = factory();

    if (typeof module === "object" && module.exports) {
        module.exports = utils;
    } else {
        root.MarketPulseUtils = utils;
    }
}(typeof globalThis !== "undefined" ? globalThis : this, function createMarketPulseUtils() {
    "use strict";

    function isFiniteNumber(value) {
        return typeof value === "number" && Number.isFinite(value);
    }

    function calculateDieselCrack(ulsdPerGallon, wtiPerBarrel) {
        if (!isFiniteNumber(ulsdPerGallon) || !isFiniteNumber(wtiPerBarrel)) {
            return null;
        }

        return (ulsdPerGallon * 42) - wtiPerBarrel;
    }

    function calculate321Crack(rbobPerGallon, ulsdPerGallon, wtiPerBarrel) {
        if (!isFiniteNumber(rbobPerGallon) ||
            !isFiniteNumber(ulsdPerGallon) ||
            !isFiniteNumber(wtiPerBarrel)) {
            return null;
        }

        return (((2 * rbobPerGallon * 42) + (ulsdPerGallon * 42)) - (3 * wtiPerBarrel)) / 3;
    }

    function percentChange(current, previous) {
        if (!isFiniteNumber(current) || !isFiniteNumber(previous) || previous === 0) {
            return null;
        }

        return ((current - previous) / previous) * 100;
    }

    function isWeekend(date) {
        if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
            return false;
        }

        const day = date.getDay();
        return day === 0 || day === 6;
    }

    return {
        calculate321Crack,
        calculateDieselCrack,
        isFiniteNumber,
        isWeekend,
        percentChange
    };
}));
