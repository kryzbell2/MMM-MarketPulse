"use strict";

const { fetchEiaDiesel, fetchYahooQuote } = require("../lib/providers");

const symbols = ["CL=F", "BZ=F", "HO=F", "RB=F", "^TNX"];

async function main() {
    let failed = false;
    const results = await Promise.allSettled(symbols.map((symbol) => fetchYahooQuote(symbol)));

    results.forEach((result, index) => {
        if (result.status === "fulfilled") {
            console.log(`${symbols[index]}: ${result.value.price}`);
        } else {
            failed = true;
            console.error(`${symbols[index]}: ${result.reason.message}`);
        }
    });

    try {
        const diesel = await fetchEiaDiesel();
        console.log(`EIA diesel (${diesel.date || diesel.releaseDate || "date unavailable"}): ${diesel.price}`);
    } catch (error) {
        failed = true;
        console.error(`EIA diesel: ${error.message}`);
    }

    if (failed) {
        process.exitCode = 1;
    }
}

main();
