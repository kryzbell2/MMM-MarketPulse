# MMM-MarketPulse

MMM-MarketPulse is a compact [MagicMirror²](https://magicmirror.builders/) module for related market, refinery-margin, energy, and interest-rate indicators. It is designed to replace several separate modules in a narrow portrait layout while allowing every data source to fail independently.

This release targets MagicMirror² 2.36.x and follows its CommonJS module and Node-helper conventions.

```text
WTI       $86.21  -1.2%    Brent     $93.15  +0.4%
US Gas     $4.31           US Diesel  $5.45
Crack     $97.33           10Y         4.47% -0.3%
```

The compact layout uses two columns when space permits and automatically collapses to one column in regions narrower than 420 px. Set `compact: false` for a conventional vertical table.

## Data shown

| Metric | Source / calculation | Unit |
| --- | --- | --- |
| WTI crude | Yahoo Finance-compatible chart data, `CL=F` | $/bbl |
| Brent crude | Yahoo Finance-compatible chart data, `BZ=F` | $/bbl |
| U.S. regular gasoline | AAA national Current Avg., Regular column | $/gal |
| U.S. or state retail diesel | AAA Fuel Prices daily average | $/gal |
| Diesel crack | `(ULSD × 42) - WTI` | $/bbl |
| Optional 3-2-1 crack | `((2 × RBOB × 42) + (ULSD × 42) - (3 × WTI)) / 3` | $/bbl |
| U.S. 10-year Treasury yield | Yahoo Finance-compatible chart data, `^TNX` | % |

RBOB (`RB=F`) is fetched only when `show321Crack` is enabled. The Yahoo-derived crack calculations use front-month instruments that may have different expiration months. They are indicative snapshots, **not** formally contract-matched refinery hedges.

AAA regular gasoline and retail diesel averages are updated daily. Gasoline always uses the U.S. national Regular column, even when `dieselRegion` is `"NC"`. Both metrics use the same refresh cadence and independent in-memory caches; failures preserve each metric’s last valid value and original fetch time.

The AAA retail diesel value is updated daily. MMM-MarketPulse reads the Diesel column of the Current Avg. row on [AAA Fuel Prices](https://gasprices.aaa.com/) or the selected [state page](https://gasprices.aaa.com/?state=NC), including its publication date. It requires no API key and refreshes every four hours by default. The public HTML structure was inspected live on September 14, 2026; page changes can require parser updates.

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
        showGasAverage: true,
        showDieselAverage: true,
        showDieselCrack: true,
        show321Crack: false,
        showTenYearYield: true,

        updateInterval: 300000,
        aaaUpdateInterval: 14400000,
        dieselRegion: "US", // use "NC" for North Carolina

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
| `showGasAverage` | `true` | Show AAA U.S. regular gasoline average (always national). |
| `showDieselAverage` | `true` | Show the AAA daily retail diesel average. |
| `showDieselCrack` | `true` | Show the approximate ULSD-WTI crack. |
| `show321Crack` | `false` | Fetch RBOB and show the indicative front-month 3-2-1 crack. |
| `showTenYearYield` | `true` | Show the U.S. 10-year Treasury yield (`^TNX`). |
| `updateInterval` | `300000` | Yahoo refresh interval in milliseconds; values below 60 seconds are clamped. |
| `aaaUpdateInterval` | `14400000` | AAA gasoline and diesel refresh interval in milliseconds; values below three hours are clamped. |
| `dieselRegion` | `"US"` | National average, or a two-letter state abbreviation (including DC), e.g. `"NC"`. Metro/custom regions are not supported. |
| `hideOnWeekends` | `true` | Hide the complete module on Saturday and Sunday in the mirror host's local timezone. |
| `showChange` | `true` | Show Yahoo price/yield percentage change from the previous close when available. |
| `showLastUpdate` | `false` | Show the latest module data-receipt time. |
| `decimals` | `2` | Display precision from 0 through 4 decimal places. |
| `compact` | `true` | Use the low-height responsive grid; `false` uses a vertical list. |

The first market refresh runs immediately. Yahoo data then refreshes about every five minutes, and AAA diesel refreshes independently. Network work runs only in `node_helper.js`; rendering never makes HTTP calls.

## Weekend behavior

With `hideOnWeekends: true`, the browser-side module checks the MagicMirror host's local day and hides itself throughout Saturday and Sunday. It returns automatically on Monday. Set the option to `false` to leave the most recently cached observations visible. This first release intentionally does not model exchange holidays or market hours.

## Resilience and troubleshooting

Each Yahoo symbol is requested independently. A failed Brent request cannot remove WTI, and a failed RBOB request produces an unavailable 3-2-1 value instead of `NaN`. The latest valid in-memory observation is preserved through temporary request failures. The retail cache is in memory and resets when MagicMirror restarts. Failed requests retain the original fetch time; retained values are dimmed after at least 12 hours without a successful refresh. The tooltip shows AAA’s publication date. Before the first successful fetch, retail diesel displays an em dash. AAA parser or network failures never replace diesel with another source and do not affect Yahoo-derived metrics.

Check the MagicMirror server log for messages beginning with `[MMM-MarketPulse]`. Typical diagnostics identify the affected Yahoo symbol or an AAA parser/network error.

If the module remains on “Loading market data…”:

1. Confirm that the Raspberry Pi can reach `query1.finance.yahoo.com` and `gasprices.aaa.com` over HTTPS.
2. Check that the system date, timezone, and CA certificates are correct.
3. Run `npm test` in the module directory to verify the offline parsers and calculations.
4. Run `npm run smoke` to make a one-time live check of all five Yahoo symbols and AAA diesel plus U.S. regular gasoline.

No API key is used or stored.

## Updating

```bash
cd ~/MagicMirror/modules/MMM-MarketPulse
git pull --ff-only
npm install --omit=dev
npm run check
npm test
```

Restart MagicMirror using its existing process manager. For a PM2 installation whose process is named `mm`, run `pm2 restart mm`. Run the update on each mirror.

Existing configurations automatically use AAA; remove the obsolete `eiaUpdateInterval` option. The former `showULSD` option is obsolete; replace it with `showGasAverage` (default `true`). “US Gas” replaces “Diesel Fut.” automatically. `HO=F` is still fetched when needed for either crack calculation.

## Development

```bash
npm run check
npm test
npm run smoke  # optional; accesses live endpoints
```

Offline tests use small saved fixtures and do not require internet access.

## License

[MIT](LICENSE)
