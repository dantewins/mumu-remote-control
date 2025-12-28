import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import { execFile } from "node:child_process";

const ROBLOX_PKG = process.env.ROBLOX_PKG || "com.roblox.client";
const BEE_SWARM_PLACE_ID = process.env.BEE_SWARM_PLACE_ID || "1537690962";
const BEE_SWARM_DEEPLINK = `roblox://experiences/start?placeId=${BEE_SWARM_PLACE_ID}`;

// Who can control the bot
const allowedUsers = new Set(
    (process.env.ALLOWED_USERS || "")
        .split(",")
        .map(s => s.trim())
        .filter(Boolean)
);

// Substrings for minimizing (more robust than exact process names)
const minimizeMatchSubstrings = (process.env.MINIMIZE_MATCH_SUBSTRINGS || "mumu,emulator")
    .split(",")
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

function run(cmd, args) {
    return new Promise((resolve, reject) => {
        execFile(cmd, args, { windowsHide: true }, (err, stdout, stderr) => {
            if (err) return reject(new Error((stderr || stdout || err.message).trim()));
            resolve((stdout || stderr || "").trim());
        });
    });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function isTcpSerial(serial) {
    // e.g. 127.0.0.1:7555
    return /^[\d.]+:\d+$/.test(serial);
}

async function ensureAdbTcpConnected(serial) {
    // Needed only for MuMu TCP-type devices. Android Studio emulators don’t need this.
    if (isTcpSerial(serial)) {
        await run("adb", ["connect", serial]);
    }
}

function sanitizeForAdbText(s) {
    // adb input text quirks: spaces must be %s; strip quotes/newlines
    return s.replace(/ /g, "%s").replace(/[\r\n"'`]/g, "");
}

/**
 * Your coordinates (used for all targets unless you later want per-target values)
 * input box: 1068,296
 * receive key: 1072,463
 * continue: 1065,382
 */
const COORDS = {
    "emulator-5556": { receiveX: 1072, receiveY: 463, keyX: 1068, keyY: 296, contX: 1065, contY: 382 },
    "emulator-5560": { receiveX: 1072, receiveY: 463, keyX: 1068, keyY: 296, contX: 1065, contY: 382 },
};

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

async function launchRoblox(serial) {
    await ensureAdbTcpConnected(serial);
    await run("adb", [
        "-s", serial,
        "shell", "monkey",
        "-p", ROBLOX_PKG,
        "-c", "android.intent.category.LAUNCHER",
        "1"
    ]);
}

async function joinBeeSwarm(serial) {
    await ensureAdbTcpConnected(serial);
    await run("adb", [
        "-s", serial,
        "shell", "am", "start",
        "-a", "android.intent.action.VIEW",
        "-d", BEE_SWARM_DEEPLINK
    ]);
}

async function closeRoblox(serial) {
    await ensureAdbTcpConnected(serial);
    await run("adb", ["-s", serial, "shell", "am", "force-stop", ROBLOX_PKG]);
}

async function pressReceiveKeyThenBack(serial) {
    const c = COORDS[serial];
    if (!c) throw new Error(`No coords configured for ${serial}`);

    // Tap Receive Key
    await tap(serial, c.receiveX, c.receiveY);

    // Give it a moment to copy/open whatever it does
    await sleep(700);

    // Go back to Roblox (often needs 1–2 backs)
    await keyevent(serial, 4); // KEYCODE_BACK
    await sleep(250);
    await keyevent(serial, 4); // KEYCODE_BACK again

    await run("adb", ["-s", serial, "shell", "am", "force-stop", "com.android.browser"]);
}

async function enterKeyAndContinue(serial, key) {
    const c = COORDS[serial];
    if (!c) throw new Error(`No coords configured for ${serial}`);

    await tap(serial, c.keyX, c.keyY);
    await sleep(150);
    await typeText(serial, key);
    await sleep(150);
    await tap(serial, c.contX, c.contY);
}

// ✅ Minimize emulator windows (Windows) using substring matching on process names
// Minimize ONLY specific process windows (Windows)
async function minimizeInstancesWindows() {
    if (process.platform !== "win32") {
        throw new Error("minimize-instances is implemented for Windows only.");
    }

    const names = (process.env.MINIMIZE_PROCESS_NAMES || "")
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);

    if (names.length === 0) {
        throw new Error("Set MINIMIZE_PROCESS_NAMES in .env (example: MuMuNxDevice).");
    }

    const namesArray = names.map(n => `"${n}"`).join(",");

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
    [Win32]::ShowWindowAsync($_.MainWindowHandle, 6) | Out-Null  # 6 = SW_MINIMIZE
  }
}
`;

    await run("powershell", ["-NoProfile", "-Command", ps]);
}


const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.on("interactionCreate", async (interaction) => {
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

        const target = interaction.options.getString("target", true);

        if (interaction.commandName === "roblox-open") {
            await launchRoblox(target);
            await sleep(2000);
            await joinBeeSwarm(target);
            await interaction.editReply(`Opened Roblox + joined Bee Swarm on **${target}** ✅`);
            return;
        }

        if (interaction.commandName === "roblox-close") {
            await closeRoblox(target);
            await interaction.editReply(`Closed Roblox on **${target}** ✅`);
            return;
        }

        if (interaction.commandName === "receive-key") {
            await pressReceiveKeyThenBack(target);
            await interaction.editReply(`Tapped **Receive Key** and returned to Roblox on **${target}** ✅\nNow open the copied link on your PC, get the key, then run /enter-key.`);
            return;
        }

        if (interaction.commandName === "enter-key") {
            const key = interaction.options.getString("key", true);
            await enterKeyAndContinue(target, key);
            await interaction.editReply(`Entered key + pressed Continue on **${target}** ✅`);
            return;
        }

        await interaction.editReply("Unknown command.");
    } catch (e) {
        await interaction.editReply(`Error: ${e.message}`);
    }
});

client.once("ready", () => console.log(`✅ Logged in as ${client.user.tag}`));
client.login(process.env.DISCORD_TOKEN);
