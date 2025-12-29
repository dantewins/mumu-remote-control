import "dotenv/config";
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import {
  Client,
  GatewayIntentBits,
  WebhookClient,
  SlashCommandBuilder,
  REST,
  Routes,
} from "discord.js";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import clipboard from "clipboardy";

const ROBLOX_PKG = process.env.ROBLOX_PKG || "com.roblox.client";
const allowedUsers = new Set(
  (process.env.ALLOWED_USERS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || stdout || err.message).trim()));
      resolve((stdout || stderr || "").trim());
    });
  });
}

function runLong(cmd, args) {
  return new Promise((resolve, reject) => {
    const isWin = process.platform === "win32";
    const p = isWin
      ? spawn("cmd.exe", ["/d", "/s", "/c", cmd, ...args], {
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        })
      : spawn(cmd, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });

    let tail = "";
    const onData = (d) => {
      const s = d.toString();
      tail = (tail + s).slice(-16000);
      process.stdout.write(s);
    };

    p.stdout.on("data", onData);
    p.stderr.on("data", onData);

    p.on("error", (e) => reject(new Error(`${cmd} spawn failed: ${e.message}`)));
    p.on("close", (code) => {
      if (code === 0) resolve(tail.trim());
      else reject(new Error(`${cmd} exited with code ${code}\n${tail.trim().slice(-2000)}`));
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isTcpSerial(serial) {
  return /^[\d.]+:\d+$/.test(serial);
}

async function ensureAdbTcpConnected(serial) {
  if (isTcpSerial(serial)) await run("adb", ["connect", serial]);
}

function sanitizeForAdbText(s) {
  return s.replace(/ /g, "%s").replace(/[\r\n"'`]/g, "");
}

async function getAdbTargets() {
  let out = "";
  try {
    out = await run("adb", ["devices"]);
  } catch {
    return [];
  }
  const lines = out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const deviceLines = lines.slice(1);
  const targets = [];
  for (const line of deviceLines) {
    const parts = line.split(/\s+/);
    const serial = parts[0];
    const state = parts[1] || "unknown";
    if (serial) targets.push({ serial, state });
  }
  return targets;
}

const CONFIG_PATH = path.resolve("./config.json");

const DEFAULT_CONFIG = {
  devices: {
    defaultCoords: { receiveX: 1072, receiveY: 463, keyX: 1068, keyY: 296, contX: 1065, contY: 382 },
    coordsBySerial: {},
    minimizeProcessNames: ["MuMuNxDevice", "MuMuVMMHeadless"],
  },
  farm: {
    enabled: false,
    placeId: 1537690962,
    pollSeconds: 30,
    consecutiveFails: 2,
    cooldownSeconds: 600,
    webhookUrl: "",
    strictPlaceMatch: false,
    autoRejoin: {
      enabled: false,
      retries: 2,
      delayMs: 2500,
      closeFirst: true,
      useVip: false,
    },
    vipLink: "",
    watch: [],
  },
};

async function loadConfig() {
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw);

    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      devices: {
        ...DEFAULT_CONFIG.devices,
        ...(parsed.devices || {}),
        coordsBySerial: parsed.devices?.coordsBySerial || {},
        minimizeProcessNames: Array.isArray(parsed.devices?.minimizeProcessNames)
          ? parsed.devices.minimizeProcessNames
          : DEFAULT_CONFIG.devices.minimizeProcessNames,
      },
      farm: {
        ...DEFAULT_CONFIG.farm,
        ...(parsed.farm || {}),
        autoRejoin: {
          ...DEFAULT_CONFIG.farm.autoRejoin,
          ...(parsed.farm?.autoRejoin || {}),
        },
        watch: Array.isArray(parsed.farm?.watch) ? parsed.farm.watch : [],
      },
    };
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

async function saveConfig(cfg) {
  const tmp = CONFIG_PATH + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(cfg, null, 2), "utf8");
  await fs.rename(tmp, CONFIG_PATH);
}

let config = await loadConfig();

function coordsFor(serial) {
  return config.devices.coordsBySerial?.[serial] || config.devices.defaultCoords;
}

async function tap(serial, x, y) {
  await ensureAdbTcpConnected(serial);
  await run("adb", ["-s", serial, "shell", "input", "tap", String(x), String(y)]);
}

async function keyevent(serial, code) {
  await ensureAdbTcpConnected(serial);
  await run("adb", ["-s", serial, "shell", "input", "keyevent", String(code)]);
}

async function typeText(serial, text) {
  await ensureAdbTcpConnected(serial);
  await run("adb", ["-s", serial, "shell", "input", "text", sanitizeForAdbText(text)]);
}

const publicDeepLink = (placeId) => `roblox://experiences/start?placeId=${placeId}`;

async function launchRoblox(serial) {
  await ensureAdbTcpConnected(serial);
  await run("adb", ["-s", serial, "shell", "monkey", "-p", ROBLOX_PKG, "-c", "android.intent.category.LAUNCHER", "1"]);
}

async function closeRoblox(serial) {
  await ensureAdbTcpConnected(serial);
  await run("adb", ["-s", serial, "shell", "am", "force-stop", ROBLOX_PKG]);
}

async function joinBeeSwarm(serial, useVip = false) {
  await ensureAdbTcpConnected(serial);

  if (useVip) {
    if (!config.farm.vipLink) throw new Error("No VIP link set. Use /farm set-vip-link first.");

    await run("adb", ["-s", serial, "shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", config.farm.vipLink.trim()]);
    await sleep(7000);

    await run("adb", ["-s", serial, "shell", "am", "force-stop", "com.android.chrome"]).catch(() => {});
    await run("adb", ["-s", serial, "shell", "am", "force-stop", "com.android.browser"]).catch(() => {});
    await run("adb", ["-s", serial, "shell", "am", "force-stop", "org.chromium.webview_shell"]).catch(() => {});
  } else {
    const dl = publicDeepLink(config.farm.placeId);
    await run("adb", ["-s", serial, "shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", dl]);
  }
}

async function openAndJoinBeeSwarm(serial, useVip = false) {
  await launchRoblox(serial);
  await sleep(2000);
  await joinBeeSwarm(serial, useVip);
}

async function restartRoblox(serial, useVip = false) {
  await closeRoblox(serial).catch(() => {});
  await sleep(1000);
  await openAndJoinBeeSwarm(serial, useVip);
}

async function receiveKeyThenBackAndReadClipboard(serial) {
  const c = coordsFor(serial);

  await tap(serial, c.receiveX, c.receiveY);
  await sleep(1200);

  let clip = "";
  try {
    clip = (await clipboard.read()) || "";
  } catch {
    clip = "";
  }

  await keyevent(serial, 4).catch(() => {});
  await sleep(250);
  await keyevent(serial, 4).catch(() => {});

  await run("adb", ["-s", serial, "shell", "am", "force-stop", "com.android.chrome"]).catch(() => {});
  await run("adb", ["-s", serial, "shell", "am", "force-stop", "com.android.browser"]).catch(() => {});
  await run("adb", ["-s", serial, "shell", "am", "force-stop", "org.chromium.webview_shell"]).catch(() => {});

  return clip.trim();
}

async function enterKeyAndContinue(serial, key) {
  const c = coordsFor(serial);

  await tap(serial, c.keyX, c.keyY);
  await sleep(150);
  await typeText(serial, key);
  await sleep(150);
  await tap(serial, c.contX, c.contY);
}

function normalizeProcName(name) {
  let s = String(name || "").trim();
  while (/\.exe$/i.test(s)) s = s.slice(0, -4);
  return s;
}

async function minimizeInstancesWindows() {
  if (process.platform !== "win32") throw new Error("minimize-instances is implemented for Windows only.");

  const names = (config.devices.minimizeProcessNames || []).map(normalizeProcName).filter(Boolean);
  if (names.length === 0) throw new Error("No minimize process names set. Use config.json devices.minimizeProcessNames");

  const namesArray = names.map((n) => `"${n}"`).join(",");

  const ps = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
}
"@;

$names = @(${namesArray});

Get-Process | Where-Object { $names -contains $_.Name } | ForEach-Object {
  if ($_.MainWindowHandle -ne 0) {
    [Win32]::ShowWindowAsync($_.MainWindowHandle, 6) | Out-Null
  }
}
`.trim();

  await run("powershell", ["-NoProfile", "-Command", ps]);
}

function makeWebhookClient(url) {
  return url ? new WebhookClient({ url }) : null;
}

async function postJson(url, body, timeoutMs = 12000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text().catch(() => "");
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} :: ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  } finally {
    clearTimeout(t);
  }
}

async function robloxUsernamesToIds(usernames) {
  const json = await postJson("https://users.roblox.com/v1/usernames/users", { usernames, excludeBannedUsers: false });
  const map = new Map();
  for (const item of json?.data || []) {
    if (item?.name && typeof item?.id === "number") map.set(String(item.name).toLowerCase(), item.id);
  }
  return map;
}

async function robloxGetPresences(userIds) {
  const json = await postJson("https://presence.roblox.com/v1/presence/users", { userIds });
  return json?.userPresences || [];
}

function presenceType(p) {
  return p?.userPresenceType ?? p?.PresenceType ?? -1;
}
function getPlaceId(p) {
  return p?.placeId ?? p?.PlaceId ?? null;
}
function getRootPlaceId(p) {
  return p?.rootPlaceId ?? p?.RootPlaceId ?? null;
}
function getLastLocation(p) {
  return String(p?.lastLocation ?? p?.LastLocation ?? "");
}

function isFarmingPresence(p, cfg) {
  const inGame = presenceType(p) === 2;
  if (!inGame) return false;

  const placeId = getPlaceId(p);
  const rootPlaceId = getRootPlaceId(p);
  const lastLoc = getLastLocation(p).toLowerCase();

  if (cfg.strictPlaceMatch) {
    if (placeId == cfg.placeId || rootPlaceId == cfg.placeId) return true;
    if (lastLoc.includes("bee swarm")) return true;
    return false;
  }

  if (placeId || rootPlaceId) return placeId == cfg.placeId || rootPlaceId == cfg.placeId;
  if (lastLoc) return lastLoc.includes("bee swarm");
  return true;
}

function prettyPresence(p) {
  const t = presenceType(p);
  const typeStr = t === 0 ? "Offline" : t === 1 ? "Online" : t === 2 ? "In Game" : t === 3 ? "In Studio" : `Unknown(${t})`;
  const placeId = getPlaceId(p);
  const rootPlaceId = getRootPlaceId(p);
  const lastLoc = getLastLocation(p);
  return `${typeStr}` + (placeId ? ` | placeId=${placeId}` : "") + (rootPlaceId ? ` | rootPlaceId=${rootPlaceId}` : "") + (lastLoc ? ` | ${lastLoc}` : "");
}

async function farmSend(msg) {
  const hook = makeWebhookClient(config.farm.webhookUrl);
  if (!hook) return;
  try {
    await hook.send({ content: msg });
  } catch {}
}

const farmState = new Map();

async function tryAutoRejoinPublic(w, p, useVip = false) {
  const ar = config.farm.autoRejoin || {};
  if (!ar.enabled) return "autoRejoin disabled";
  if (!w.targetSerial) return "no device mapped";
  if (presenceType(p) === 2) return "skipped (Roblox still in-game per presence)";

  const retries = Math.max(0, Number(ar.retries ?? 2));
  const delayMs = Math.max(500, Number(ar.delayMs ?? 2500));
  const closeFirst = ar.closeFirst !== false;
  useVip = useVip || ar.useVip;

  let lastErr = null;
  for (let i = 0; i <= retries; i++) {
    try {
      if (closeFirst) {
        await closeRoblox(w.targetSerial).catch(() => {});
        await sleep(800);
      }
      await openAndJoinBeeSwarm(w.targetSerial, useVip);
      return `rejoin attempted (try ${i + 1}/${retries + 1})`;
    } catch (e) {
      lastErr = e;
      await sleep(delayMs);
    }
  }
  return `rejoin failed: ${lastErr?.message || "unknown error"}`;
}

async function farmPollOnce() {
  if (!config.farm.enabled) return;
  if (!Array.isArray(config.farm.watch) || config.farm.watch.length === 0) return;

  const watched = config.farm.watch.filter((w) => typeof w.userId === "number");
  if (watched.length === 0) return;

  const ids = watched.map((w) => w.userId);

  const presences = [];
  for (let i = 0; i < ids.length; i += 50) presences.push(...(await robloxGetPresences(ids.slice(i, i + 50))));

  const byId = new Map();
  for (const p of presences) if (typeof p?.userId === "number") byId.set(p.userId, p);

  const nowMs = Date.now();
  const cooldownMs = Math.max(30, Number(config.farm.cooldownSeconds || 600)) * 1000;
  const failN = Math.max(1, Number(config.farm.consecutiveFails || 2));

  for (const w of watched) {
    let p = byId.get(w.userId);
    if (!p) p = { userId: w.userId, userPresenceType: 0, lastLocation: "" };

    const farmingNow = isFarmingPresence(p, config.farm);

    const prev = farmState.get(w.userId) || {
      lastWasFarming: false,
      everFarming: false,
      badCount: 0,
      lastAlertAtMs: 0,
      lastPresenceText: "",
    };

    const everFarming = prev.everFarming || farmingNow;
    const badCount = farmingNow ? 0 : prev.badCount + 1;

    const shouldAlert = farmingNow === false && badCount >= failN && nowMs - prev.lastAlertAtMs >= cooldownMs;

    if (shouldAlert) {
      const rejoinNote = await tryAutoRejoinPublic(w, p);
      const device = w.targetSerial ? ` (device: **${w.targetSerial}**)` : "";
      const note = everFarming ? "" : "\nNOTE: monitor has not seen this account farming since start.";

      await farmSend(
        `**Not farming / disconnected**\n` +
          `User: **${w.usernameLower}**${device}\n` +
          `Now: ${prettyPresence(p)}\n` +
          `Expected placeId: ${config.farm.placeId}\n` +
          `bad=${badCount} (threshold=${failN})\n` +
          `${rejoinNote}` +
          `${note}\n` +
          `Time: <t:${Math.floor(nowMs / 1000)}:F>`
      );

      prev.lastAlertAtMs = nowMs;
    }

    farmState.set(w.userId, {
      lastWasFarming: farmingNow,
      everFarming,
      badCount,
      lastAlertAtMs: prev.lastAlertAtMs,
      lastPresenceText: prettyPresence(p),
    });
  }
}

let monitorLoopRunning = false;
async function startMonitorLoop() {
  if (monitorLoopRunning) return;
  monitorLoopRunning = true;

  while (monitorLoopRunning) {
    try {
      await farmPollOnce();
    } catch (e) {
      console.log("Farm monitor error:", e?.message || e);
      if (e?.stack) console.log(e.stack);
    }
    await sleep(Math.max(10, Number(config.farm.pollSeconds || 30)) * 1000);
  }
}

async function gitBehindCount() {
  try {
    const out = await run("git", ["rev-list", "--count", "HEAD..@{u}"]);
    const n = Number.parseInt(out, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const targetRequired = (o) =>
  o.setName("target").setDescription("ADB device serial (type to autocomplete)").setRequired(true).setAutocomplete(true);

const commands = [
  new SlashCommandBuilder()
    .setName("roblox-open")
    .setDescription("Open Roblox and join Bee Swarm")
    .addStringOption(targetRequired)
    .addBooleanOption((o) => o.setName("vip").setDescription("Join VIP server if set (default: public)").setRequired(false)),

  new SlashCommandBuilder().setName("roblox-close").setDescription("Close Roblox on the selected emulator").addStringOption(targetRequired),

  new SlashCommandBuilder()
    .setName("receive-key")
    .setDescription("Tap Receive Key, return to Roblox, and show the copied link")
    .addStringOption(targetRequired),

  new SlashCommandBuilder()
    .setName("enter-key")
    .setDescription("Enter the key in the box and press Continue")
    .addStringOption(targetRequired)
    .addStringOption((o) => o.setName("key").setDescription("Paste the key you received").setRequired(true)),

  new SlashCommandBuilder().setName("minimize-instances").setDescription("Minimize emulator instances (Windows)"),

  new SlashCommandBuilder().setName("update-bot").setDescription("Update bot from GitHub if new commits available"),

  new SlashCommandBuilder()
    .setName("farm")
    .setDescription("Configure and monitor Roblox farming")
    .addSubcommand((sc) =>
      sc
        .setName("add")
        .setDescription("Add a Roblox username to monitor")
        .addStringOption((o) => o.setName("username").setDescription("Roblox username").setRequired(true))
        .addStringOption((o) =>
          o.setName("target").setDescription("ADB device serial to map this account to (autocomplete)").setRequired(false).setAutocomplete(true)
        )
    )
    .addSubcommand((sc) =>
      sc.setName("remove").setDescription("Remove a monitored username").addStringOption((o) => o.setName("username").setDescription("Roblox username").setRequired(true))
    )
    .addSubcommand((sc) => sc.setName("list").setDescription("List monitored usernames"))
    .addSubcommand((sc) =>
      sc.setName("set-place").setDescription("Set Bee Swarm placeId considered 'farming'").addIntegerOption((o) => o.setName("place_id").setDescription("Roblox placeId").setRequired(true))
    )
    .addSubcommand((sc) =>
      sc.setName("set-webhook").setDescription("Set Discord webhook URL for alerts").addStringOption((o) => o.setName("url").setDescription("Discord webhook URL").setRequired(true))
    )
    .addSubcommand((sc) => sc.setName("clear-webhook").setDescription("Clear webhook URL"))
    .addSubcommand((sc) =>
      sc.setName("set-poll").setDescription("Set poll interval (seconds)").addIntegerOption((o) => o.setName("seconds").setDescription("Seconds").setRequired(true))
    )
    .addSubcommand((sc) =>
      sc.setName("set-fails").setDescription("Consecutive non-farming polls before alerting").addIntegerOption((o) => o.setName("count").setDescription("Count").setRequired(true))
    )
    .addSubcommand((sc) =>
      sc.setName("set-cooldown").setDescription("Minimum seconds between alerts per user").addIntegerOption((o) => o.setName("seconds").setDescription("Seconds").setRequired(true))
    )
    .addSubcommand((sc) =>
      sc
        .setName("set-rejoin")
        .setDescription("Auto rejoin Bee Swarm when disconnected")
        .addBooleanOption((o) => o.setName("enabled").setDescription("Enable auto rejoin").setRequired(true))
        .addIntegerOption((o) => o.setName("retries").setDescription("How many retries (optional)").setRequired(false))
        .addIntegerOption((o) => o.setName("delay_ms").setDescription("Delay between retries (ms, optional)").setRequired(false))
        .addBooleanOption((o) => o.setName("close_first").setDescription("Force close Roblox before rejoin (optional)").setRequired(false))
        .addBooleanOption((o) => o.setName("use_vip").setDescription("Use VIP server for auto-rejoin if set (optional)").setRequired(false))
    )
    .addSubcommand((sc) =>
      sc.setName("set-vip-link").setDescription("Set VIP server link for private joins").addStringOption((o) => o.setName("link").setDescription("Full VIP server link").setRequired(true))
    )
    .addSubcommand((sc) =>
      sc
        .setName("restart")
        .setDescription("Force restart/rejoin on device")
        .addStringOption(targetRequired)
        .addBooleanOption((o) => o.setName("vip").setDescription("Join VIP server if set (default: public)").setRequired(false))
    )
    .addSubcommand((sc) => sc.setName("start").setDescription("Start monitoring"))
    .addSubcommand((sc) => sc.setName("stop").setDescription("Stop monitoring"))
    .addSubcommand((sc) => sc.setName("status").setDescription("Show current monitor status")),
].map((c) => c.toJSON());

client.once("ready", async () => {
  console.log(`Logged in as ${client.user?.tag || "(unknown user)"}`);

  try {
    const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body: commands });
  } catch (error) {
    console.error("Failed to register slash commands:", error);
  }

  startMonitorLoop().catch((e) => console.error("Monitor loop failed:", e));
});

client.on("interactionCreate", async (interaction) => {
  if (interaction.isAutocomplete()) {
    if (allowedUsers.size > 0 && !allowedUsers.has(interaction.user.id)) {
      await interaction.respond([]).catch(() => {});
      return;
    }

    let focused = null;
    try {
      focused = interaction.options.getFocused(true);
    } catch {
      focused = null;
    }

    if (!focused || focused.name !== "target") {
      await interaction.respond([]).catch(() => {});
      return;
    }

    const typed = String(focused.value || "").toLowerCase();
    const targets = await getAdbTargets();
    const choices = targets
      .filter((t) => t.serial.toLowerCase().includes(typed))
      .slice(0, 25)
      .map((t) => ({ name: `${t.serial} (${t.state})`, value: t.serial }));

    await interaction.respond(choices).catch(() => {});
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  if (allowedUsers.size > 0 && !allowedUsers.has(interaction.user.id)) {
    await interaction.reply({ content: "Not authorized.", ephemeral: true }).catch(() => {});
    return;
  }

  await interaction.deferReply({ ephemeral: true }).catch(() => {});
  const commandName = interaction.commandName;

  try {
    if (commandName === "update-bot") {
      await interaction.editReply("Checking for updates...");

      await runLong("git", ["fetch", "origin"]).catch((e) => {
        throw new Error(`git fetch failed: ${e.message}`);
      });

      const behind = await gitBehindCount();
      if (behind !== null && behind <= 0) {
        await interaction.editReply("Bot is already up to date.");
        return;
      }

      if (behind === null) {
        const status = await run("git", ["status", "-uno"]).catch(() => "");
        const looksUpToDate =
          status.includes("up to date") || status.includes("up-to-date") || status.includes("Your branch is up to date");
        if (looksUpToDate) {
          await interaction.editReply("Bot is already up to date.");
          return;
        }
      }

      await interaction.editReply("New commits found. Pulling changes...");
      await runLong("git", ["pull"]).catch((e) => {
        throw new Error(`git pull failed: ${e.message}`);
      });

      await interaction.editReply("Installing dependencies...");
      await runLong("npm", ["install"]).catch((e) => {
        throw new Error(`npm install failed: ${e.message}`);
      });

      await interaction.editReply("Update complete. Restarting bot...");
      process.exit(0);
    }

    if (commandName === "minimize-instances") {
      await minimizeInstancesWindows();
      await interaction.editReply("Minimized emulator instances");
      return;
    }

    if (commandName === "roblox-open") {
      const target = interaction.options.getString("target", true);
      const useVip = interaction.options.getBoolean("vip", false) ?? false;
      await openAndJoinBeeSwarm(target, useVip);
      await interaction.editReply(`Opened Roblox + joined Bee Swarm on **${target}** (VIP: ${useVip})`);
      return;
    }

    if (commandName === "roblox-close") {
      const target = interaction.options.getString("target", true);
      await closeRoblox(target);
      await interaction.editReply(`Closed Roblox on **${target}**`);
      return;
    }

    if (commandName === "receive-key") {
      const target = interaction.options.getString("target", true);
      await interaction.editReply("Tapping Receive Key...");
      const clip = await receiveKeyThenBackAndReadClipboard(target);
      if (!clip) {
        await interaction.editReply("Clipboard is empty.");
        return;
      }
      await interaction.editReply(`Key link copied:\n\`\`\`\n${clip}\n\`\`\``);
      return;
    }

    if (commandName === "enter-key") {
      const target = interaction.options.getString("target", true);
      const key = interaction.options.getString("key", true);
      await enterKeyAndContinue(target, key);
      await interaction.editReply(`Entered key + pressed Continue on **${target}**`);
      return;
    }

    if (commandName === "farm") {
      const sub = interaction.options.getSubcommand();

      if (sub === "set-vip-link") {
        const link = interaction.options.getString("link", true).trim();
        config.farm.vipLink = link;
        await saveConfig(config);
        await interaction.editReply(`VIP link set to ${link}`);
        return;
      }

      if (sub === "set-place") {
        config.farm.placeId = interaction.options.getInteger("place_id", true);
        await saveConfig(config);
        await interaction.editReply(`placeId set to **${config.farm.placeId}**`);
        return;
      }

      if (sub === "set-webhook") {
        config.farm.webhookUrl = interaction.options.getString("url", true).trim();
        await saveConfig(config);
        await interaction.editReply("Webhook URL saved");
        return;
      }

      if (sub === "clear-webhook") {
        config.farm.webhookUrl = "";
        await saveConfig(config);
        await interaction.editReply("Webhook cleared");
        return;
      }

      if (sub === "set-poll") {
        config.farm.pollSeconds = Math.max(10, interaction.options.getInteger("seconds", true));
        await saveConfig(config);
        await interaction.editReply(`Poll interval set to **${config.farm.pollSeconds}s**`);
        return;
      }

      if (sub === "set-fails") {
        config.farm.consecutiveFails = Math.max(1, interaction.options.getInteger("count", true));
        await saveConfig(config);
        await interaction.editReply(`Fails threshold set to **${config.farm.consecutiveFails}**`);
        return;
      }

      if (sub === "set-cooldown") {
        config.farm.cooldownSeconds = Math.max(30, interaction.options.getInteger("seconds", true));
        await saveConfig(config);
        await interaction.editReply(`Cooldown set to **${config.farm.cooldownSeconds}s**`);
        return;
      }

      if (sub === "set-rejoin") {
        const enabled = interaction.options.getBoolean("enabled", true);
        const retries = interaction.options.getInteger("retries", false);
        const delayMs = interaction.options.getInteger("delay_ms", false);
        const closeFirst = interaction.options.getBoolean("close_first", false);
        const useVip = interaction.options.getBoolean("use_vip", false);

        config.farm.autoRejoin = config.farm.autoRejoin || structuredClone(DEFAULT_CONFIG.farm.autoRejoin);
        config.farm.autoRejoin.enabled = enabled;
        if (retries !== null && retries !== undefined) config.farm.autoRejoin.retries = Math.max(0, retries);
        if (delayMs !== null && delayMs !== undefined) config.farm.autoRejoin.delayMs = Math.max(500, delayMs);
        if (closeFirst !== null && closeFirst !== undefined) config.farm.autoRejoin.closeFirst = !!closeFirst;
        if (useVip !== null && useVip !== undefined) config.farm.autoRejoin.useVip = !!useVip;

        await saveConfig(config);

        await interaction.editReply(
          `Auto rejoin updated\nenabled=${config.farm.autoRejoin.enabled} retries=${config.farm.autoRejoin.retries} delayMs=${config.farm.autoRejoin.delayMs} closeFirst=${config.farm.autoRejoin.closeFirst} useVip=${config.farm.autoRejoin.useVip}`
        );
        return;
      }

      if (sub === "restart") {
        const target = interaction.options.getString("target", true);
        const useVip = interaction.options.getBoolean("vip", false) ?? false;
        await restartRoblox(target, useVip);
        await interaction.editReply(`Restarted Roblox on **${target}** (VIP: ${useVip})`);
        return;
      }

      if (sub === "add") {
        const username = interaction.options.getString("username", true).trim();
        const usernameLower = username.toLowerCase();
        const targetSerial = interaction.options.getString("target", false) || null;

        const map = await robloxUsernamesToIds([username]);
        const userId = map.get(usernameLower);
        if (!userId) throw new Error(`Could not resolve Roblox username: ${username}`);

        const existing = config.farm.watch.find((w) => w.userId === userId || w.usernameLower === usernameLower);
        if (existing) {
          existing.usernameLower = usernameLower;
          existing.userId = userId;
          existing.targetSerial = targetSerial ?? existing.targetSerial ?? null;
        } else {
          config.farm.watch.push({ usernameLower, userId, targetSerial });
        }

        await saveConfig(config);
        await interaction.editReply(`Added **${usernameLower}** (id: ${userId})${targetSerial ? ` mapped to **${targetSerial}**` : ""}`);
        return;
      }

      if (sub === "remove") {
        const usernameLower = interaction.options.getString("username", true).trim().toLowerCase();
        const before = config.farm.watch.length;
        config.farm.watch = config.farm.watch.filter((w) => w.usernameLower !== usernameLower);
        await saveConfig(config);
        await interaction.editReply(before === config.farm.watch.length ? `Not found: **${usernameLower}**` : `Removed **${usernameLower}**`);
        return;
      }

      if (sub === "list") {
        if (!config.farm.watch.length) {
          await interaction.editReply("Watch list is empty.");
          return;
        }
        const lines = config.farm.watch.map((w) => `• ${w.usernameLower}${w.targetSerial ? ` [${w.targetSerial}]` : ""} (id: ${w.userId})`);
        await interaction.editReply(lines.join("\n").slice(0, 1900));
        return;
      }

      if (sub === "start") {
        config.farm.enabled = true;
        await saveConfig(config);
        startMonitorLoop().catch(() => {});
        await interaction.editReply("Farm monitor started");
        return;
      }

      if (sub === "stop") {
        config.farm.enabled = false;
        await saveConfig(config);
        await interaction.editReply("Farm monitor stopped");
        return;
      }

      if (sub === "status") {
        const enabled = config.farm.enabled ? "enabled" : "disabled";
        const lines = [
          `Monitor: ${enabled}`,
          `placeId: ${config.farm.placeId}`,
          `poll: ${config.farm.pollSeconds}s | fails: ${config.farm.consecutiveFails} | cooldown: ${config.farm.cooldownSeconds}s`,
          `autoRejoin: ${config.farm.autoRejoin?.enabled ? `on (retries=${config.farm.autoRejoin.retries}, delayMs=${config.farm.autoRejoin.delayMs})` : "off"}`,
          `webhook: ${config.farm.webhookUrl ? "set" : "not set"}`,
          `vipLink: ${config.farm.vipLink ? "set" : "not set"}`,
          `watching: ${config.farm.watch.length}`,
          "",
        ];

        for (const w of config.farm.watch.slice(0, 15)) {
          const st = farmState.get(w.userId);
          const status = st ? (st.lastWasFarming ? "farming" : `not farming (bad=${st.badCount})`) : "(no data yet)";
          lines.push(`• ${w.usernameLower}${w.targetSerial ? ` [${w.targetSerial}]` : ""} — ${status}`);
        }

        await interaction.editReply(lines.join("\n").slice(0, 1900));
        return;
      }

      await interaction.editReply("Unknown /farm subcommand.");
      return;
    }

    await interaction.editReply("Unknown command.");
  } catch (e) {
    await interaction.editReply(`Error: ${e?.message || String(e)}`);
  }
});

client.login(process.env.DISCORD_TOKEN);
