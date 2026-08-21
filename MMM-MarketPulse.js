/* global Module, MarketPulseUtils */

Module.register("MMM-MarketPulse", {
    requiresVersion: "2.36.0",

    defaults: {
        showWTI: true,
        showBrent: true,
        showULSD: true,
        showDieselAverage: true,
        showDieselCrack: true,
        show321Crack: false,
        showTenYearYield: true,
        updateInterval: 300000,
        eiaUpdateInterval: 21600000,
        hideOnWeekends: true,
        showChange: true,
        showLastUpdate: false,
        decimals: 2,
        compact: true
    },

    getScripts() {
        return ["lib/market_utils.js"];
    },

    getStyles() {
        return ["MMM-MarketPulse.css"];
    },

    start() {
        this.marketData = null;
        this.weekendTimer = null;
        this.weekendHidden = false;
        this.sendSocketNotification("MARKETPULSE_INIT", this.config);
        this.startWeekendTimer();
    },

    suspend() {
        if (!this.weekendHidden) {
            this.stopWeekendTimer();
        }
    },

    resume() {
        this.startWeekendTimer();
        this.applyWeekendVisibility();
    },

    notificationReceived(notification) {
        if (notification === "DOM_OBJECTS_CREATED") {
            this.applyWeekendVisibility();
        }
    },

    socketNotificationReceived(notification, payload) {
        if (notification !== "MARKETPULSE_DATA") {
            return;
        }

        this.marketData = payload;
        this.updateDom(300);
    },

    startWeekendTimer() {
        this.stopWeekendTimer();
        this.applyWeekendVisibility();
        this.weekendTimer = setInterval(() => this.applyWeekendVisibility(), 60000);
    },

    stopWeekendTimer() {
        if (this.weekendTimer) {
            clearInterval(this.weekendTimer);
            this.weekendTimer = null;
        }
    },

    applyWeekendVisibility() {
        const weekend = typeof MarketPulseUtils !== "undefined"
            ? MarketPulseUtils.isWeekend(new Date())
            : [0, 6].includes(new Date().getDay());

        if (this.config.hideOnWeekends && weekend && !this.weekendHidden) {
            this.weekendHidden = true;
            this.hide(0, null, { lockString: "MMM-MarketPulse-weekend" });
        } else if ((!this.config.hideOnWeekends || !weekend) && this.weekendHidden) {
            this.weekendHidden = false;
            this.show(0, null, { lockString: "MMM-MarketPulse-weekend" });
        }
    },

    getDom() {
        const wrapper = document.createElement("div");
        wrapper.className = `marketpulse ${this.config.compact ? "marketpulse--compact" : "marketpulse--list"}`;

        if (!this.marketData) {
            wrapper.classList.add("small", "dimmed");
            wrapper.textContent = "Loading market data…";
            return wrapper;
        }

        const metrics = this.buildMetrics();
        if (this.config.compact) {
            const grid = document.createElement("div");
            grid.className = "marketpulse-grid small";
            metrics.forEach((metric) => grid.appendChild(this.buildCompactMetric(metric)));
            wrapper.appendChild(grid);
        } else {
            wrapper.appendChild(this.buildList(metrics));
        }

        if (this.config.showLastUpdate && this.marketData.receivedAt) {
            const update = document.createElement("div");
            update.className = "marketpulse-update xsmall dimmed";
            const date = new Date(this.marketData.receivedAt);
            update.textContent = Number.isNaN(date.getTime())
                ? ""
                : `Updated ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
            wrapper.appendChild(update);
        }

        return wrapper;
    },

    buildMetrics() {
        const market = this.marketData.market || {};
        const calculated = this.marketData.calculated || {};
        const metrics = [];

        if (this.config.showWTI) {
            metrics.push(this.quoteMetric("WTI", market.wti, "currency"));
        }
        if (this.config.showBrent) {
            metrics.push(this.quoteMetric("Brent", market.brent, "currency"));
        }
        if (this.config.showULSD) {
            metrics.push(this.quoteMetric("ULSD", market.ulsd, "currency"));
        }
        if (this.config.showDieselAverage) {
            metrics.push({
                label: "Diesel",
                value: this.formatValue(this.marketData.retailDiesel?.price, "currency"),
                change: null,
                stale: this.marketData.retailDiesel?.stale === true,
                title: this.dieselTitle()
            });
        }
        if (this.config.showDieselCrack) {
            metrics.push({
                label: "Crack",
                value: this.formatValue(calculated.dieselCrack, "currency"),
                change: null,
                stale: market.wti?.stale === true || market.ulsd?.stale === true,
                title: "Approximate ULSD-WTI crack ($/bbl)"
            });
        }
        if (this.config.show321Crack) {
            metrics.push({
                label: "3-2-1",
                value: this.formatValue(calculated.crack321, "currency"),
                change: null,
                stale: market.wti?.stale === true || market.ulsd?.stale === true || market.rbob?.stale === true,
                title: "Indicative front-month 3-2-1 crack ($/bbl)"
            });
        }
        if (this.config.showTenYearYield) {
            metrics.push(this.quoteMetric("10Y", market.tenYear, "percent"));
        }

        return metrics;
    },

    quoteMetric(label, quote, type) {
        return {
            label,
            value: this.formatValue(quote?.price, type),
            change: this.config.showChange ? this.formatChange(quote?.changePercent) : null,
            changeValue: quote?.changePercent,
            stale: quote?.stale === true,
            title: quote?.marketTime ? `Market timestamp: ${new Date(quote.marketTime).toLocaleString()}` : ""
        };
    },

    dieselTitle() {
        const diesel = this.marketData.retailDiesel;
        if (!diesel) {
            return "EIA U.S. on-highway diesel unavailable";
        }

        const date = diesel.date || diesel.releaseDate;
        return date ? `EIA U.S. average, week of ${date}` : "EIA U.S. on-highway diesel average";
    },

    normalizedDecimals() {
        const decimals = Number.parseInt(this.config.decimals, 10);
        return Number.isInteger(decimals) ? Math.min(Math.max(decimals, 0), 4) : 2;
    },

    formatValue(value, type) {
        if (typeof value !== "number" || !Number.isFinite(value)) {
            return "—";
        }

        const formatted = value.toFixed(this.normalizedDecimals());
        return type === "percent" ? `${formatted}%` : `$${formatted}`;
    },

    formatChange(value) {
        if (typeof value !== "number" || !Number.isFinite(value)) {
            return null;
        }
        const prefix = value > 0 ? "+" : "";
        return `${prefix}${value.toFixed(1)}%`;
    },

    buildCompactMetric(metric) {
        const item = document.createElement("div");
        item.className = `marketpulse-item ${metric.stale ? "marketpulse-item--stale" : ""}`;
        item.title = metric.title || "";

        const label = document.createElement("span");
        label.className = "marketpulse-label dimmed";
        label.textContent = metric.label;

        const value = document.createElement("span");
        value.className = `marketpulse-value ${metric.value === "—" ? "dimmed" : "bright"}`;
        value.textContent = metric.value;

        item.appendChild(label);
        item.appendChild(value);
        if (metric.change) {
            item.appendChild(this.buildChange(metric));
        }
        return item;
    },

    buildChange(metric) {
        const change = document.createElement("span");
        const direction = metric.changeValue > 0
            ? "marketpulse-change--positive"
            : metric.changeValue < 0
                ? "marketpulse-change--negative"
                : "";
        change.className = `marketpulse-change dimmed ${direction}`;
        change.textContent = metric.change;
        return change;
    },

    buildList(metrics) {
        const table = document.createElement("table");
        table.className = "small";
        const body = document.createElement("tbody");

        metrics.forEach((metric) => {
            const row = document.createElement("tr");
            if (metric.stale) {
                row.classList.add("marketpulse-item--stale");
            }
            row.title = metric.title || "";

            const label = document.createElement("td");
            label.className = "marketpulse-list-label dimmed";
            label.textContent = metric.label;
            const value = document.createElement("td");
            value.className = `marketpulse-list-value ${metric.value === "—" ? "dimmed" : "bright"}`;
            value.textContent = metric.value;
            const change = document.createElement("td");
            change.className = "marketpulse-list-change";
            if (metric.change) {
                change.appendChild(this.buildChange(metric));
            }

            row.appendChild(label);
            row.appendChild(value);
            row.appendChild(change);
            body.appendChild(row);
        });

        table.appendChild(body);
        return table;
    }
});
