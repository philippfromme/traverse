import "dotenv/config";

import fs from "fs";
import path from "path";
import readline from "readline";

import { chromium } from "playwright";

const GARMIN_SSO_URL =
  "https://sso.garmin.com/portal/sso/en-US/sign-in?clientId=GarminConnect&service=https://connect.garmin.com/app/activities";
const GARMIN_CONNECT_BASE = "https://connect.garmin.com";
const ACTIVITIES_API =
  "/gc-api/activitylist-service/activities/search/activities";
const GPX_DOWNLOAD_API = "/gc-api/download-service/export/gpx/activity";
const TCX_DOWNLOAD_API = "/gc-api/download-service/export/tcx/activity";
const PAGE_SIZE = 20;
const DOWNLOAD_DELAY_MS = 1500;
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 5000;
const GPX_DIR = path.resolve("gpx");
const TCX_DIR = path.resolve("tcx");
const ACTIVITY_DATA_FILE = path.resolve("activity-data.json");

async function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function getCredentials() {
  let email = process.env.GARMIN_EMAIL;
  let password = process.env.GARMIN_PASSWORD;

  if (!email) {
    email = await prompt("Garmin email: ");
  }

  if (!password) {
    password = await prompt("Garmin password: ");
  }

  if (!email || !password) {
    throw new Error("Email and password are required.");
  }

  return { email, password };
}

async function login(page, email, password) {
  console.log("Navigating to Garmin SSO...");
  await page.goto(GARMIN_SSO_URL, { waitUntil: "domcontentloaded" });

  if (email && password) {
    console.log("Filling in credentials (auto-login)...");
    await page.waitForSelector('input[name="email"]', { timeout: 10000 });
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', password);
    await page.click('button[type="submit"]');
  } else {
    console.log("Please log in manually in the browser...");
  }

  console.log("Waiting for login redirect...");

  try {
    await page.waitForURL("**/connect.garmin.com/app/**", { timeout: 120000 });
  } catch {
    throw new Error(
      "Login failed — timed out waiting for redirect. Check your credentials.",
    );
  }

  // wait for the SPA to fully load and set up auth tokens
  await sleep(3000);

  console.log("Logged in successfully.");
}

async function captureApiHeaders(page) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () =>
        reject(
          new Error(
            "Timed out waiting for Garmin API request. Try reloading the page.",
          ),
        ),
      60000,
    );

    const handler = (request) => {
      if (request.url().includes("/gc-api/")) {
        page.off("request", handler);
        clearTimeout(timeout);
        resolve(request.headers());
      }
    };

    page.on("request", handler);
  });
}

async function fetchActivities(page, apiHeaders) {
  console.log("Fetching activities...");

  const activities = [];
  let start = 0;

  while (true) {
    const url = `${GARMIN_CONNECT_BASE}${ACTIVITIES_API}?start=${start}&limit=${PAGE_SIZE}`;

    const result = await page.evaluate(
      async ({ fetchUrl, headers }) => {
        const response = await fetch(fetchUrl, { headers });

        if (!response.ok) {
          return {
            error: true,
            status: response.status,
            body: await response.text(),
          };
        }

        return { error: false, data: await response.json() };
      },
      { fetchUrl: url, headers: apiHeaders },
    );

    if (result.error) {
      throw new Error(
        `Failed to fetch activities (status ${result.status}): ${result.body}`,
      );
    }

    const batch = result.data;

    if (!Array.isArray(batch) || batch.length === 0) {
      break;
    }

    activities.push(...batch);
    console.log(`  Fetched ${activities.length} activities so far...`);
    start += PAGE_SIZE;
  }

  console.log(`Found ${activities.length} total activities.`);

  return activities;
}

async function refreshApiHeaders(page) {
  console.log("  Token expired, refreshing session...");
  const headersPromise = captureApiHeaders(page);
  await page.goto(`${GARMIN_CONNECT_BASE}/app/activities`, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await sleep(3000);
  const newHeaders = await headersPromise;
  console.log("  Session refreshed.");
  return newHeaders;
}

async function downloadGpx(page, session, activityId, index, total, attempt = 0) {
  const filePath = path.join(GPX_DIR, `${activityId}.gpx`);

  if (fs.existsSync(filePath)) {
    console.log(
      `  [${index + 1}/${total}] Skipping ${activityId} (already downloaded)`,
    );
    return false;
  }

  const url = `${GARMIN_CONNECT_BASE}${GPX_DOWNLOAD_API}/${activityId}`;

  const result = await page.evaluate(
    async ({ fetchUrl, headers }) => {
      const response = await fetch(fetchUrl, { headers });

      if (!response.ok) {
        return { error: true, status: response.status };
      }

      const text = await response.text();

      return { error: false, data: text };
    },
    { fetchUrl: url, headers: session.headers },
  );

  if (result.error) {
    // some activities may not have GPS data
    if (result.status === 404) {
      console.log(
        `  [${index + 1}/${total}] Skipping ${activityId} (no GPX data available)`,
      );
      return false;
    }

    if (result.status === 401 && attempt < MAX_RETRIES) {
      session.headers = await refreshApiHeaders(page);
      return downloadGpx(page, session, activityId, index, total, attempt + 1);
    }

    if (result.status >= 500 && attempt < MAX_RETRIES) {
      const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
      console.log(
        `  [${index + 1}/${total}] Got ${result.status} for ${activityId}, retrying in ${delay / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES})...`,
      );
      await sleep(delay);
      return downloadGpx(page, session, activityId, index, total, attempt + 1);
    }

    throw new Error(
      `Failed to download GPX for ${activityId} (status ${result.status})`,
    );
  }

  fs.writeFileSync(filePath, result.data, "utf-8");
  console.log(`  [${index + 1}/${total}] Downloaded ${activityId}`);
  return true;
}

async function downloadTcx(page, session, activityId, index, total, attempt = 0) {
  const filePath = path.join(TCX_DIR, `${activityId}.tcx`);

  if (fs.existsSync(filePath)) {
    console.log(
      `  [${index + 1}/${total}] Skipping ${activityId} (already downloaded)`,
    );
    return false;
  }

  const url = `${GARMIN_CONNECT_BASE}${TCX_DOWNLOAD_API}/${activityId}`;

  const result = await page.evaluate(
    async ({ fetchUrl, headers }) => {
      const response = await fetch(fetchUrl, { headers });

      if (!response.ok) {
        return { error: true, status: response.status };
      }

      const text = await response.text();

      return { error: false, data: text };
    },
    { fetchUrl: url, headers: session.headers },
  );

  if (result.error) {
    if (result.status === 404) {
      console.log(
        `  [${index + 1}/${total}] Skipping ${activityId} (no TCX data available)`,
      );
      return false;
    }

    if (result.status === 401 && attempt < MAX_RETRIES) {
      session.headers = await refreshApiHeaders(page);
      return downloadTcx(page, session, activityId, index, total, attempt + 1);
    }

    if (result.status >= 500 && attempt < MAX_RETRIES) {
      const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
      console.log(
        `  [${index + 1}/${total}] Got ${result.status} for ${activityId}, retrying in ${delay / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES})...`,
      );
      await sleep(delay);
      return downloadTcx(page, session, activityId, index, total, attempt + 1);
    }

    throw new Error(
      `Failed to download TCX for ${activityId} (status ${result.status})`,
    );
  }

  fs.writeFileSync(filePath, result.data, "utf-8");
  console.log(`  [${index + 1}/${total}] Downloaded ${activityId}`);
  return true;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const BROWSER_DATA_DIR = path.resolve(".browser-data");

async function main() {
  const headed = process.argv.includes("--headed");

  let email = process.env.GARMIN_EMAIL;
  let password = process.env.GARMIN_PASSWORD;

  // use a persistent browser context to:
  // 1. bypass bot detection (looks like a real browser)
  // 2. preserve cookies between runs (no re-login needed)
  const context = await chromium.launchPersistentContext(BROWSER_DATA_DIR, {
    headless: !headed,
    channel: "chrome",
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const page = context.pages()[0] || (await context.newPage());

  let failed = false;

  try {
    // set up header capture BEFORE navigation so we catch the first API call
    const headersPromise = captureApiHeaders(page);

    // check if already logged in by navigating to activities page directly
    await page.goto(`${GARMIN_CONNECT_BASE}/app/activities`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    // give the SPA time to initialize and settle
    await sleep(3000);

    const currentUrl = page.url();

    if (
      currentUrl.includes("sso.garmin.com") ||
      !currentUrl.includes("connect.garmin.com/app")
    ) {
      console.log("Not logged in.");
      await login(page, email, password);

      // after login, navigate to activities and re-capture headers
      const headersPromise2 = captureApiHeaders(page);
      await page.goto(`${GARMIN_CONNECT_BASE}/app/activities`, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await sleep(3000);
      var apiHeaders = await headersPromise2;
    } else {
      console.log("Already logged in (using saved session).");
      var apiHeaders = await headersPromise;
    }

    console.log("Captured API auth headers.");

    const activities = await fetchActivities(page, apiHeaders);

    if (activities.length === 0) {
      console.log("No activities found.");
      return;
    }

    fs.mkdirSync(GPX_DIR, { recursive: true });
    fs.mkdirSync(TCX_DIR, { recursive: true });

    // save activity metadata from the list API (includes HR, duration, calories, etc.)
    const activityData = {};
    for (const a of activities) {
      activityData[a.activityId] = {
        duration: a.duration ?? null,
        movingDuration: a.movingDuration ?? null,
        averageHR: a.averageHR ?? null,
        maxHR: a.maxHR ?? null,
        calories: a.calories ?? null,
        elevationGain: a.elevationGain ?? null,
        averageSpeed: a.averageSpeed ?? null,
        maxSpeed: a.maxSpeed ?? null,
      };
    }

    // merge with existing data to preserve previously fetched activities
    let existingData = {};
    if (fs.existsSync(ACTIVITY_DATA_FILE)) {
      try {
        existingData = JSON.parse(fs.readFileSync(ACTIVITY_DATA_FILE, "utf-8"));
      } catch {
        // ignore corrupt file
      }
    }

    const mergedData = { ...existingData, ...activityData };
    fs.writeFileSync(ACTIVITY_DATA_FILE, JSON.stringify(mergedData, null, 2));
    console.log(
      `Saved activity metadata for ${Object.keys(mergedData).length} activities.`,
    );

    const activityIds = activities.map((a) => a.activityId);
    const session = { headers: apiHeaders };

    console.log(`\nDownloading GPX files to ${GPX_DIR}...\n`);

    for (let i = 0; i < activityIds.length; i++) {
      const downloaded = await downloadGpx(
        page,
        session,
        activityIds[i],
        i,
        activityIds.length,
      );

      // delay between downloads to avoid rate limiting
      if (downloaded && i < activityIds.length - 1) {
        await sleep(DOWNLOAD_DELAY_MS);
      }
    }

    console.log(`\nDownloading TCX files to ${TCX_DIR}...\n`);

    for (let i = 0; i < activityIds.length; i++) {
      const downloaded = await downloadTcx(
        page,
        session,
        activityIds[i],
        i,
        activityIds.length,
      );

      // delay between downloads to avoid rate limiting
      if (downloaded && i < activityIds.length - 1) {
        await sleep(DOWNLOAD_DELAY_MS);
      }
    }

    console.log("\nDone!");
  } catch (err) {
    failed = true;

    console.error("Error:", err.message);

    if (headed) {
      console.log("\nBrowser left open for inspection. Press Ctrl+C to exit.");
      await new Promise(() => {}); // hang forever until user kills process
    }
  } finally {
    await context.close();

    if (failed) {
      process.exit(1);
    }
  }
}

main();
