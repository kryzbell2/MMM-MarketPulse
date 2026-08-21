# MMM-MarketPulse

MMM-MarketPulse is a compact [MagicMirror²](https://magicmirror.builders/) module for related market, refinery-margin, energy, and interest-rate indicators. It is designed to replace several separate modules in a narrow portrait layout while allowing every data source to fail independently.

This release targets MagicMirror² 2.36.x and follows its CommonJS module and Node-helper conventions.

```text
WTI       $86.21  -1.2%    Brent     $93.15  +0.4%
ULSD       $4.37  +0.8%    Diesel     $5.45
Crack     $97.33           10Y         4.47% -0.3%
```

The compact layout uses two columns when space permits and automatically collapses to one column in regions narrower than 420 px. Set `compact: false` for a conventional vertical table.

## Data shown

| Metric | Source / calculation | Unit |
| --- | --- | --- |
| WTI crude | Yahoo Finance-compatible chart data, `CL=F` | $/bbl |
| Brent crude | Yahoo Finance-compatible chart data, `BZ=F` | $/bbl |
| ULSD / heating-oil futures | Yahoo Finance-compatible chart data, `HO=F` | $/gal |
| U.S. retail diesel | EIA U.S. On-Highway Diesel Fuel Price, including taxes | $/gal |
| Diesel crack | `(ULSD × 42) - WTI` | $/bbl |
| Optional 3-2-1 crack | `((2 × RBOB × 42) + (ULSD × 42) - (3 × WTI)) / 3` | $/bbl |
| U.S. 10-year Treasury yield | Yahoo Finance-compatible chart data, `^TNX` | % |

RBOB (`RB=F`) is fetched only when `show321Crack` is enabled. The Yahoo-derived crack calculations use front-month instruments that may have different expiration months. They are indicative snapshots, **not** formally contract-matched refinery hedges.

The EIA retail diesel value is weekly. MMM-MarketPulse reads the official public [Gasoline and Diesel Fuel Update](https://www.eia.gov/petroleum/gasdiesel/) and requires no API key. It caches the most recent valid observation and refreshes it every six hours by default.

## Installation

On the Raspberry Pi running MagicMirror:

```bash
cd ~/MagicMirror/modules
git clone https://github.com/kryzbell2/MMM-MarketPulse.git
cd MMM-MarketPulse
npm install
```

There are no production dependencies; `npm install` creates the lockfile and validates the local package metadata.

Add this block to the `modules` array in `~/MagicMirror/config/config.js`:

```js
{
    module: "MMM-MarketPulse",
    position: "top_right",
    config: {
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
    }
}
```

Restart MagicMirror after editing the configuration.

## Configuration

| Option | Default | Description |
| --- | ---: | --- |
| `showWTI` | `true` | Show WTI crude (`CL=F`). |
| `showBrent` | `true` | Show Brent crude (`BZ=F`). |
| `showULSD` | `true` | Show ULSD / heating-oil futures (`HO=F`). |
| `showDieselAverage` | `true` | Show the official weekly EIA U.S. retail diesel average. |
| `showDieselCrack` | `true` | Show the approximate ULSD-WTI crack. |
| `show321Crack` | `false` | Fetch RBOB and show the indicative front-month 3-2-1 crack. |
| `showTenYearYield` | `true` | Show the U.S. 10-year Treasury yield (`^TNX`). |
| `updateInterval` | `300000` | Yahoo refresh interval in milliseconds; values below 60 seconds are clamped. |
| `eiaUpdateInterval` | `21600000` | EIA refresh interval in milliseconds; values below one hour are clamped. |
| `hideOnWeekends` | `true` | Hide the complete module on Saturday and Sunday in the mirror host's local timezone. |
| `showChange` | `true` | Show Yahoo price/yield percentage change from the previous close when available. |
| `showLastUpdate` | `false` | Show the latest module data-receipt time. |
| `decimals` | `2` | Display precision from 0 through 4 decimal places. |
| `compact` | `true` | Use the low-height responsive grid; `false` uses a vertical list. |

The first market refresh runs immediately. Yahoo data then refreshes about every five minutes, and EIA diesel refreshes independently. Network work runs only in `node_helper.js`; rendering never makes HTTP calls.

## Weekend behavior

With `hideOnWeekends: true`, the browser-side module checks the MagicMirror host's local day and hides itself throughout Saturday and Sunday. It returns automatically on Monday. Set the option to `false` to leave the most recently cached observations visible. This first release intentionally does not model exchange holidays or market hours.

## Resilience and troubleshooting

Each Yahoo symbol is requested independently. A failed Brent request cannot remove WTI, and a failed RBOB request produces an unavailable 3-2-1 value instead of `NaN`. The latest valid in-memory observation is preserved through temporary request failures. EIA parser or network failures never replace diesel with another source and do not affect Yahoo-derived metrics.

Check the MagicMirror server log for messages beginning with `[MMM-MarketPulse]`. Typical diagnostics identify the affected Yahoo symbol or an EIA parser/network error.

If the module remains on “Loading market data…”:

1. Confirm that the Raspberry Pi can reach `query1.finance.yahoo.com` and `www.eia.gov` over HTTPS.
2. Check that the system date, timezone, and CA certificates are correct.
3. Run `npm test` in the module directory to verify the offline parsers and calculations.
4. Run `npm run smoke` to make a one-time live check of all five Yahoo symbols and EIA diesel.

No API key is used or stored.

## Updating

```bash
cd ~/MagicMirror/modules/MMM-MarketPulse
git pull
npm install
```

Restart MagicMirror after updating.

## Development

```bash
npm run check
npm test
npm run smoke  # optional; accesses live endpoints
```

Offline tests use small saved fixtures and do not require internet access.

## License

[MIT](LICENSE)
