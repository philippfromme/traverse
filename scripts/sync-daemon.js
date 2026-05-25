import { execFileSync } from "child_process";

const FETCH_INTERVAL = parseInt(process.env.FETCH_INTERVAL || "21600", 10) * 1000;

function log(msg) {
  console.log(`${new Date().toISOString()}: ${msg}`);
}

async function run() {
  while (true) {
    try {
      log("Fetching activities...");
      execFileSync("node", ["scripts/fetch-garmin.js"], { stdio: "inherit" });
      log("Building index...");
      execFileSync("node", ["scripts/build-index.js"], { stdio: "inherit" });
      log("Done.");
    } catch (err) {
      log(`Failed: ${err.message}. Will retry next interval.`);
    }

    log(`Sleeping ${FETCH_INTERVAL / 1000}s...`);
    await new Promise((resolve) => setTimeout(resolve, FETCH_INTERVAL));
  }
}

run();
