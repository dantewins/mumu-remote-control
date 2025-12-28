import "dotenv/config";
import { Client, GatewayIntentBits, WebhookClient } from "discord.js";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

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
    const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
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
        watch: [],
        robloxCookie: "",
        autoRestart: false,
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

const deepLink = (placeId) => `roblox://experiences/start?placeId=${placeId}`;

async function launchRoblox(serial) {
    await ensureAdbTcpConnected(serial);
    await run("adb", [
        "-s", serial,
        "shell", "monkey",
        "-p", ROBLOX_PKG,
        "-c", "android.intent.category.LAUNCHER",
        "1",
    ]);
}

async function joinBeeSwarm(serial) {
    await ensureAdbTcpConnected(serial);
    await run("adb", [
        "-s", serial,
        "shell", "am", "start",
        "-a", "android.intent.action.VIEW",
        "-d", deepLink(config.farm.placeId),
    ]);
}

async function closeRoblox(serial) {
    await ensureAdbTcpConnected(serial);
    await run("adb", ["-s", serial, "shell", "am", "force-stop", ROBLOX_PKG]);
}

async function pressReceiveKeyThenBack(serial) {
    const c = coordsFor(serial);

    await tap(serial, c.receiveX, c.receiveY);
    await sleep(700);

    await keyevent(serial, 4);
    await sleep(250);
    await keyevent(serial, 4);

    await run("adb", ["-s", serial, "shell", "am", "force-stop", "com.android.browser"]).catch(() => { });
}

async function enterKeyAndContinue(serial, key) {
    const c = coordsFor(serial);

    await tap(serial, c.keyX, c.keyY);
    await sleep(150);
    await typeText(serial, key);
    await sleep(150);
    await tap(serial, c.contX, c.contY);
}

async function minimizeInstancesWindows() {
    if (process.platform !== "win32") {
        throw new Error("minimize-instances is implemented for Windows only.");
    }

    const names = (config.devices.minimizeProcessNames || [])
        .map((s) => String(s).trim())
        .filter(Boolean);

    if (names.length === 0) {
        throw new Error("No minimize process names set. Use /device minimize-set");
    }

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

Get-Process | Where-Object { $names -contains $_.Name.ToLower() } | ForEach-Object {
  if ($_.MainWindowHandle -ne 0) {
    [Win32]::ShowWindowAsync($_.MainWindowHandle, 6) | Out-Null
  }
}
`;

    await run("powershell", ["-NoProfile", "-Command", ps]);
}

function makeWebhookClient(url) {
    return url ? new WebhookClient({ url }) : null;
}

function getRobloxHeaders() {
    const headers = { "content-type": "application/json", "accept": "application/json" };
    if (config.farm.robloxCookie) {
        headers["Cookie"] = `.ROBLOSECURITY=${config.farm.robloxCookie}`;
    }
    return headers;
}

async function postJson(url, body) {
    const res = await fetch(url, {
        method: "POST",
        headers: getRobloxHeaders(),
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status} ${text.slice(0, 200)}`);
    }
    return res.json();
}

async function robloxUsernamesToIds(usernames) {
    const json = await postJson("https://users.roblox.com/v1/usernames/users", {
        usernames,
        excludeBannedUsers: false,
    });
    const map = new Map();
    for (const item of (json?.data || [])) {
        if (item?.name && typeof item?.id === "number") {
            map.set(String(item.name).toLowerCase(), item.id);
        }
    }
    return map;
}

async function robloxGetPresences(userIds) {
    const json = await postJson("https://presence.roblox.com/v1/presence/users", { userIds });
    return json?.userPresences || [];
}

async function robloxLegacyOnlineStatus(userId) {
    const res = await fetch(`https://api.roblox.com/users/${userId}/onlinestatus`, {
        headers: { ...getRobloxHeaders(), "accept": "application/json" },
    });
    if (!res.ok) return null;
    return res.json().catch(() => null);
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
    const hasAnyDetails = !!(placeId || rootPlaceId || lastLoc);

    if (cfg.strictPlaceMatch) {
        if (placeId == cfg.placeId || rootPlaceId == cfg.placeId) return true;
        if (lastLoc.includes("bee swarm")) return true;
        return false;
    }

    if (placeId || rootPlaceId) {
        if (placeId == cfg.placeId || rootPlaceId == cfg.placeId) return true;
        return false;
    }
    if (lastLoc) {
        if (lastLoc.includes("bee swarm")) return true;
        return false;
    }

    if (inGame && !hasAnyDetails) return true;

    return false;
}

function prettyPresence(p) {
    const t = presenceType(p);
    const typeStr =
        t === 0 ? "Offline" :
            t === 1 ? "Online" :
                t === 2 ? "In Game" :
                    t === 3 ? "In Studio" :
                        `Unknown(${t})`;

    const placeId = getPlaceId(p);
    const rootPlaceId = getRootPlaceId(p);
    const lastLoc = getLastLocation(p);

    return `${typeStr}` +
        (placeId ? ` | placeId=${placeId}` : "") +
        (rootPlaceId ? ` | rootPlaceId=${rootPlaceId}` : "") +
        (lastLoc ? ` | ${lastLoc}` : "");
}

const farmState = new Map();

async function farmSend(msg) {
    const hook = makeWebhookClient(config.farm.webhookUrl);
    if (!hook) return;
    await hook.send({ content: msg });
}

async function farmPollOnce() {
    if (!config.farm.enabled) return;
    if (!config.farm.webhookUrl) return;
    if (!Array.isArray(config.farm.watch) || config.farm.watch.length === 0) return;

    const watched = config.farm.watch.filter(w => typeof w.userId === "number");
    if (watched.length === 0) return;

    const ids = watched.map(w => w.userId);

    const chunks = [];
    for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));

    const presences = [];
    for (const c of chunks) {
        const p = await robloxGetPresences(c);
        presences.push(...p);
    }

    const byId = new Map();
    for (const p of presences) {
        if (typeof p?.userId === "number") byId.set(p.userId, p);
    }

    const nowMs = Date.now();
    const cooldownMs = Math.max(30, Number(config.farm.cooldownSeconds || 600)) * 1000;
    const failN = Math.max(1, Number(config.farm.consecutiveFails || 2));

    for (const w of watched) {
        let p = byId.get(w.userId);

        if (p && presenceType(p) === 2) {
            const placeId = getPlaceId(p);
            const rootPlaceId = getRootPlaceId(p);
            const lastLoc = getLastLocation(p);
            const missing = !placeId && !rootPlaceId && !lastLoc;
            if (missing) {
                const legacy = await robloxLegacyOnlineStatus(w.userId);
                if (legacy && typeof legacy === "object") {
                    p = { ...p, ...legacy };
                }
            }
        }

        if (!p) p = { userId: w.userId, userPresenceType: 0, lastLocation: "" };

        const farmingNow = isFarmingPresence(p, config.farm);

        const prev = farmState.get(w.userId) || {
            lastWasFarming: false,
            badCount: 0,
            lastAlertAtMs: 0,
            lastPresenceText: "",
        };

        const badCount = farmingNow ? 0 : (prev.badCount + 1);

        const shouldAlert =
            prev.lastWasFarming === true &&
            farmingNow === false &&
            badCount >= failN &&
            (nowMs - prev.lastAlertAtMs) >= cooldownMs;

        if (shouldAlert) {
            const device = w.targetSerial ? ` (device: **${w.targetSerial}**)` : "";
            await farmSend(
                `🚨 **Farming stopped / disconnected**\n` +
                `User: **${w.usernameLower}**${device}\n` +
                `Now: ${prettyPresence(p)}\n` +
                `Expected placeId: ${config.farm.placeId}\n` +
                `Time: <t:${Math.floor(nowMs / 1000)}:F>`
            );
            prev.lastAlertAtMs = nowMs;

            if (config.farm.autoRestart && w.targetSerial) {
                try {
                    await closeRoblox(w.targetSerial);
                    await sleep(1000);
                    await launchRoblox(w.targetSerial);
                    await sleep(2000);
                    await joinBeeSwarm(w.targetSerial);
                    await farmSend(`✅ Attempted auto-restart on **${w.targetSerial}** for **${w.usernameLower}**`);
                } catch (e) {
                    await farmSend(`❌ Auto-restart failed on **${w.targetSerial}** for **${w.usernameLower}**: ${e.message}`);
                }
            }
        }

        farmState.set(w.userId, {
            lastWasFarming: farmingNow,
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
        }

        const ms = Math.max(10, Number(config.farm.pollSeconds || 30)) * 1000;
        await sleep(ms);
    }
}
function stopMonitorLoop() {
    monitorLoopRunning = false;
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.on("interactionCreate", async (interaction) => {
    if (interaction.isAutocomplete()) {
        if (allowedUsers.size > 0 && !allowedUsers.has(interaction.user.id)) {
            await interaction.respond([]);
            return;
        }

        const focused = interaction.options.getFocused(true);
        if (focused.name !== "target") {
            await interaction.respond([]);
            return;
        }

        const typed = String(focused.value || "").toLowerCase();
        const targets = await getAdbTargets();
        const choices = targets
            .filter((t) => t.serial.toLowerCase().includes(typed))
            .slice(0, 25)
            .map((t) => ({ name: `${t.serial} (${t.state})`, value: t.serial }));

        await interaction.respond(choices);
        return;
    }

    if (!interaction.isChatInputCommand()) return;

    if (allowedUsers.size > 0 && !allowedUsers.has(interaction.user.id)) {
        await interaction.reply({ content: "Not authorized.", ephemeral: true });
        return;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
        if (interaction.commandName === "minimize-instances") {
            await minimizeInstancesWindows();
            await interaction.editReply("Minimized emulator instances ✅");
            return;
        }

        if (interaction.commandName === "roblox-open") {
            const target = interaction.options.getString("target", true);
            await launchRoblox(target);
            await sleep(2000);
            await joinBeeSwarm(target);
            await interaction.editReply(`Opened Roblox + joined Bee Swarm on **${target}** ✅`);
            return;
        }

        if (interaction.commandName === "roblox-close") {
            const target = interaction.options.getString("target", true);
            await closeRoblox(target);
            await interaction.editReply(`Closed Roblox on **${target}** ✅`);
            return;
        }

        if (interaction.commandName === "receive-key") {
            const target = interaction.options.getString("target", true);
            await pressReceiveKeyThenBack(target);
            await interaction.editReply(
                `Tapped **Receive Key** and returned to Roblox on **${target}** ✅\n` +
                `Now open the copied link on your PC, get the key, then run /enter-key.`
            );
            return;
        }

        if (interaction.commandName === "enter-key") {
            const target = interaction.options.getString("target", true);
            const key = interaction.options.getString("key", true);
            await enterKeyAndContinue(target, key);
            await interaction.editReply(`Entered key + pressed Continue on **${target}** ✅`);
            return;
        }

        if (interaction.commandName === "device") {
            const sub = interaction.options.getSubcommand();

            if (sub === "list") {
                const targets = await getAdbTargets();
                if (!targets.length) {
                    await interaction.editReply("No ADB devices found. Run `adb devices` and ensure MuMu ADB is connected.");
                    return;
                }
                const lines = targets.map(t => `• ${t.serial} (${t.state})`);
                await interaction.editReply(lines.join("\n").slice(0, 1900));
                return;
            }

            if (sub === "coords-show") {
                const target = interaction.options.getString("target", true);
                const c = coordsFor(target);
                const isOverride = !!config.devices.coordsBySerial?.[target];
                await interaction.editReply(
                    `Coords for **${target}**: ${isOverride ? "(override)" : "(default)"}\n` +
                    `receive: (${c.receiveX},${c.receiveY})\n` +
                    `key: (${c.keyX},${c.keyY})\n` +
                    `continue: (${c.contX},${c.contY})`
                );
                return;
            }

            if (sub === "coords-clear") {
                const target = interaction.options.getString("target", true);
                if (config.devices.coordsBySerial?.[target]) {
                    delete config.devices.coordsBySerial[target];
                    await saveConfig(config);
                    await interaction.editReply(`Cleared coords override for **${target}** ✅`);
                } else {
                    await interaction.editReply(`No override exists for **${target}** (already using default).`);
                }
                return;
            }

            if (sub === "coords-default") {
                config.devices.defaultCoords = {
                    receiveX: interaction.options.getInteger("receive_x", true),
                    receiveY: interaction.options.getInteger("receive_y", true),
                    keyX: interaction.options.getInteger("key_x", true),
                    keyY: interaction.options.getInteger("key_y", true),
                    contX: interaction.options.getInteger("cont_x", true),
                    contY: interaction.options.getInteger("cont_y", true),
                };
                await saveConfig(config);
                await interaction.editReply("Updated DEFAULT coords ✅");
                return;
            }

            if (sub === "coords-set") {
                const target = interaction.options.getString("target", true);
                config.devices.coordsBySerial[target] = {
                    receiveX: interaction.options.getInteger("receive_x", true),
                    receiveY: interaction.options.getInteger("receive_y", true),
                    keyX: interaction.options.getInteger("key_x", true),
                    keyY: interaction.options.getInteger("key_y", true),
                    contX: interaction.options.getInteger("cont_x", true),
                    contY: interaction.options.getInteger("cont_y", true),
                };
                await saveConfig(config);
                await interaction.editReply(`Updated coords override for **${target}** ✅`);
                return;
            }

            if (sub === "minimize-set") {
                const raw = interaction.options.getString("names", true);
                const names = raw.split(",").map(s => s.trim()).filter(Boolean);
                config.devices.minimizeProcessNames = names;
                await saveConfig(config);
                await interaction.editReply(`Minimize process list updated ✅\n${names.map(n => `• ${n}`).join("\n")}`.slice(0, 1900));
                return;
            }

            if (sub === "minimize-show") {
                const names = config.devices.minimizeProcessNames || [];
                await interaction.editReply(
                    names.length ? names.map(n => `• ${n}`).join("\n") : "No minimize process names set."
                );
                return;
            }

            await interaction.editReply("Unknown /device subcommand.");
            return;
        }

        if (interaction.commandName === "farm") {
            const sub = interaction.options.getSubcommand();

            if (sub === "set-place") {
                config.farm.placeId = interaction.options.getInteger("place_id", true);
                await saveConfig(config);
                await interaction.editReply(`placeId set to **${config.farm.placeId}** ✅`);
                return;
            }

            if (sub === "set-webhook") {
                config.farm.webhookUrl = interaction.options.getString("url", true).trim();
                await saveConfig(config);
                await interaction.editReply("Webhook URL saved ✅");
                return;
            }

            if (sub === "clear-webhook") {
                config.farm.webhookUrl = "";
                await saveConfig(config);
                await interaction.editReply("Webhook cleared ✅");
                return;
            }

            if (sub === "test-webhook") {
                if (!config.farm.webhookUrl) throw new Error("No webhook set. Use /farm set-webhook first.");
                await farmSend(`✅ Farm monitor test at <t:${Math.floor(Date.now() / 1000)}:F>`);
                await interaction.editReply("Sent test webhook ✅");
                return;
            }

            if (sub === "set-poll") {
                config.farm.pollSeconds = Math.max(10, interaction.options.getInteger("seconds", true));
                await saveConfig(config);
                await interaction.editReply(`Poll interval set to **${config.farm.pollSeconds}s** ✅`);
                return;
            }

            if (sub === "set-fails") {
                config.farm.consecutiveFails = Math.max(1, interaction.options.getInteger("count", true));
                await saveConfig(config);
                await interaction.editReply(`Fails threshold set to **${config.farm.consecutiveFails}** ✅`);
                return;
            }

            if (sub === "set-cooldown") {
                config.farm.cooldownSeconds = Math.max(30, interaction.options.getInteger("seconds", true));
                await saveConfig(config);
                await interaction.editReply(`Cooldown set to **${config.farm.cooldownSeconds}s** ✅`);
                return;
            }

            if (sub === "set-strict") {
                config.farm.strictPlaceMatch = interaction.options.getBoolean("enabled", true);
                await saveConfig(config);
                await interaction.editReply(`Strict place match set to **${config.farm.strictPlaceMatch}** ✅`);
                return;
            }

            if (sub === "set-cookie") {
                config.farm.robloxCookie = interaction.options.getString("cookie", true).trim();
                await saveConfig(config);
                await interaction.editReply("Roblox cookie saved ✅");
                return;
            }

            if (sub === "clear-cookie") {
                config.farm.robloxCookie = "";
                await saveConfig(config);
                await interaction.editReply("Roblox cookie cleared ✅");
                return;
            }

            if (sub === "set-autorestart") {
                config.farm.autoRestart = interaction.options.getBoolean("enabled", true);
                await saveConfig(config);
                await interaction.editReply(`Auto-restart set to **${config.farm.autoRestart}** ✅`);
                return;
            }

            if (sub === "add") {
                const username = interaction.options.getString("username", true).trim();
                const usernameLower = username.toLowerCase();
                const targetSerial = interaction.options.getString("target", false) || null;

                const map = await robloxUsernamesToIds([username]);
                const userId = map.get(usernameLower);
                if (!userId) throw new Error(`Could not resolve Roblox username: ${username}`);

                const existing = config.farm.watch.find(w => w.userId === userId || w.usernameLower === usernameLower);
                if (existing) {
                    existing.usernameLower = usernameLower;
                    existing.userId = userId;
                    existing.targetSerial = targetSerial ?? existing.targetSerial ?? null;
                } else {
                    config.farm.watch.push({ usernameLower, userId, targetSerial });
                }

                await saveConfig(config);
                await interaction.editReply(
                    `Added **${usernameLower}** (id: ${userId})${targetSerial ? ` mapped to **${targetSerial}**` : ""} ✅`
                );
                return;
            }

            if (sub === "remove") {
                const usernameLower = interaction.options.getString("username", true).trim().toLowerCase();
                const before = config.farm.watch.length;
                config.farm.watch = config.farm.watch.filter(w => w.usernameLower !== usernameLower);
                await saveConfig(config);
                await interaction.editReply(
                    before === config.farm.watch.length ? `Not found: **${usernameLower}**` : `Removed **${usernameLower}** ✅`
                );
                return;
            }

            if (sub === "list") {
                if (!config.farm.watch.length) {
                    await interaction.editReply("Watch list is empty.");
                    return;
                }
                const lines = config.farm.watch.map(w =>
                    `• ${w.usernameLower}${w.targetSerial ? ` [${w.targetSerial}]` : ""} (id: ${w.userId})`
                );
                await interaction.editReply(lines.join("\n").slice(0, 1900));
                return;
            }

            if (sub === "start") {
                config.farm.enabled = true;
                await saveConfig(config);
                await interaction.editReply("Farm monitor started ✅");
                return;
            }

            if (sub === "stop") {
                config.farm.enabled = false;
                await saveConfig(config);
                await interaction.editReply("Farm monitor stopped ⏸️");
                return;
            }

            if (sub === "status") {
                const enabled = config.farm.enabled ? "✅ enabled" : "⏸️ disabled";
                const lines = [
                    `Monitor: ${enabled}`,
                    `placeId: ${config.farm.placeId}`,
                    `poll: ${config.farm.pollSeconds}s | fails: ${config.farm.consecutiveFails} | cooldown: ${config.farm.cooldownSeconds}s`,
                    `strictPlaceMatch: ${config.farm.strictPlaceMatch}`,
                    `autoRestart: ${config.farm.autoRestart}`,
                    `webhook: ${config.farm.webhookUrl ? "set" : "not set"}`,
                    `cookie: ${config.farm.robloxCookie ? "set" : "not set"}`,
                    `watching: ${config.farm.watch.length}`,
                    "",
                ];

                for (const w of config.farm.watch.slice(0, 15)) {
                    const st = farmState.get(w.userId);
                    const status = st
                        ? (st.lastWasFarming ? `✅ farming` : `⚠️ not farming (bad=${st.badCount})`)
                        : "(no data yet)";
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
        await interaction.editReply(`Error: ${e.message}`);
    }
});

client.once("ready", async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    await startMonitorLoop();
});

client.login(process.env.DISCORD_TOKEN);