// Runs on GitHub Actions on a schedule. Reads subscription.json + cities.json
// from the repo root, checks each city's weather/air-quality via Open-Meteo,
// and sends a real Web Push notification (delivered even if the site/app is closed)
// when there's a meaningful risk (rain, bad air quality, or high ragweed pollen).
// Notifications are deduped per city per day using scripts/state.json.

const webpush = require("web-push");
const fs = require("fs");
const path = require("path");

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

if (!PUBLIC_KEY || !PRIVATE_KEY) {
  console.error("Missing VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY secrets. Add them in Settings → Secrets and variables → Actions.");
  process.exit(1);
}
webpush.setVapidDetails("mailto:example@example.com", PUBLIC_KEY, PRIVATE_KEY);

const root = path.join(__dirname, "..");
const subscriptionPath = path.join(root, "subscription.json");
const citiesPath = path.join(root, "cities.json");
const statePath = path.join(__dirname, "state.json");

if (!fs.existsSync(subscriptionPath)) {
  console.log("No subscription.json in repo root yet — nothing to send. Subscribe from the site first.");
  process.exit(0);
}
if (!fs.existsSync(citiesPath)) {
  console.log("No cities.json in repo root yet — nothing to check.");
  process.exit(0);
}

const subscription = JSON.parse(fs.readFileSync(subscriptionPath, "utf8"));
const cities = JSON.parse(fs.readFileSync(citiesPath, "utf8"));
let state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, "utf8")) : {};

const todayStr = new Date().toISOString().slice(0, 10);

// Same thresholds as the website (grains/m3 for pollen, µg/m3 for pollutants)
const POLLEN = [
  { key: "ragweed_pollen", label: "амброзії", thresholds: [1, 10, 50] },
];
const POLLUTANTS = [
  { key: "pm2_5", thresholds: [10, 25, 50] },
  { key: "pm10", thresholds: [20, 50, 100] },
  { key: "ozone", thresholds: [60, 100, 140] },
  { key: "nitrogen_dioxide", thresholds: [40, 100, 200] },
];
const RAIN_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]);

function levelFor(v, t) {
  if (v === null || v === undefined || Number.isNaN(v)) return null;
  if (v <= 0) return 0;
  if (v < t[0]) return 1;
  if (v < t[1]) return 2;
  if (v < t[2]) return 3;
  return 4;
}
function eaqiLevel(v) {
  if (v === null || v === undefined) return null;
  if (v <= 20) return 0;
  if (v <= 40) return 1;
  if (v <= 60) return 2;
  if (v <= 80) return 3;
  return 4;
}

async function checkCity(city) {
  const key = `${city.name}|${city.admin || ""}`;
  state[key] = state[key] || {};
  const alreadyToday = (tag) => state[key][tag] === todayStr;

  const [wRes, aRes] = await Promise.all([
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}&current=weather_code&daily=precipitation_probability_max&timezone=auto`),
    fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${city.lat}&longitude=${city.lon}&current=european_aqi,pm10,pm2_5,ozone,nitrogen_dioxide,ragweed_pollen&timezone=auto`),
  ]);
  const w = await wRes.json();
  const a = await aRes.json();
  const cur = w.current || {};
  const daily = w.daily || {};
  const air = a.current || {};

  const messages = [];

  const rainNow = RAIN_CODES.has(cur.weather_code);
  const rainSoon = daily.precipitation_probability_max && daily.precipitation_probability_max[0] >= 70;
  if ((rainNow || rainSoon) && !alreadyToday("rain")) {
    messages.push({
      tag: "rain",
      title: `Дощ у ${city.name}`,
      body: rainNow ? "Зараз іде дощ — візьми парасольку." : "Сьогодні висока ймовірність дощу.",
    });
  }

  const eLvl = eaqiLevel(air.european_aqi);
  const worstPollutant = Math.max(0, ...POLLUTANTS.map((p) => levelFor(air[p.key], p.thresholds) ?? 0));
  if (((eLvl !== null && eLvl >= 3) || worstPollutant >= 3) && !alreadyToday("air")) {
    messages.push({
      tag: "air",
      title: `Забруднене повітря в ${city.name}`,
      body: "Якість повітря погана — обмеж перебування на вулиці.",
    });
  }

  const ragweedLvl = levelFor(air.ragweed_pollen, POLLEN[0].thresholds);
  if (ragweedLvl !== null && ragweedLvl >= 3 && !alreadyToday("ragweed")) {
    messages.push({
      tag: "ragweed",
      title: `Високий рівень амброзії в ${city.name}`,
      body: "Концентрація пилку амброзії висока — врахуй, якщо є алергія.",
    });
  }

  for (const m of messages) {
    try {
      await webpush.sendNotification(subscription, JSON.stringify({ title: m.title, body: m.body, tag: m.tag }));
      state[key][m.tag] = todayStr;
      console.log("sent:", m.title);
    } catch (err) {
      console.error("push failed:", err.statusCode, err.body || err.message);
      if (err.statusCode === 404 || err.statusCode === 410) {
        console.log("Subscription looks expired/invalid — re-subscribe from the site and replace subscription.json.");
      }
    }
  }
}

(async () => {
  for (const city of cities) {
    try {
      await checkCity(city);
    } catch (err) {
      console.error(`Failed to check ${city.name}:`, err.message);
    }
  }
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  console.log("Done.");
})();
