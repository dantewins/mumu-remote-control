# Roblox Farm Manager Discord Bot

This repository contains a Discord bot designed to manage and monitor Roblox farming sessions on Android emulators (e.g., MuMu Player) via ADB (Android Debug Bridge). The bot automates tasks like launching Roblox, joining specific games (e.g., Bee Swarm Simulator), entering authentication keys, and monitoring user presence in the game. It can send alerts via Discord webhooks if a user disconnects or stops farming and optionally auto-restart the session.

The bot is built with Node.js and uses the Discord.js library for bot interactions. It supports slash commands for easy control and configuration.

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running the Bot](#running-the-bot)
- [Registering Slash Commands](#registering-slash-commands)
- [Usage](#usage)
  - [Commands Overview](#commands-overview)
  - [Farm Monitoring](#farm-monitoring)
  - [Auto-Restart](#auto-restart)
- [How It Works](#how-it-works)
- [Troubleshooting](#troubleshooting)
- [Security Considerations](#security-considerations)
- [Contributing](#contributing)
- [License](#license)

## Features

- **Roblox Control**: Open/close Roblox on emulators, join specific places (e.g., Bee Swarm Simulator).
- **Authentication Automation**: Tap "Receive Key" and enter keys for Roblox authentication flows.
- **Device Management**: List ADB-connected devices, customize tap coordinates for different emulators.
- **Window Management**: Minimize emulator windows (Windows-only).
- **Farm Monitoring**: Poll Roblox user presence via API to check if users are actively in the target game. Send alerts to a Discord webhook on disconnects.
- **Auto-Restart**: Optionally restart Roblox and rejoin the game if not farming is detected (requires device mapping).
- **Configuration Persistence**: All settings (e.g., coordinates, watch list, API cookie) saved in `config.json`.
- **Security**: Restrict bot usage to allowed Discord user IDs; supports Roblox API authentication via `.ROBLOSECURITY` cookie.
- **Extensible**: Easy to add more commands or features via Discord.js.

## Prerequisites

- **Node.js**: Version 18+ (LTS recommended). Install from [nodejs.org](https://nodejs.org).
- **ADB (Android Debug Bridge)**: Part of Android SDK Platform-Tools. Download from [developer.android.com](https://developer.android.com/tools/releases/platform-tools). Ensure `adb` is in your PATH.
- **Android Emulator**: Tested with MuMu Player (supports ADB). Ensure emulators are connected via ADB (e.g., `adb devices` lists them).
- **Discord Bot**: Create a bot on the [Discord Developer Portal](https://discord.com/developers/applications). Note the Token, Client ID, and Guild ID.
- **Roblox API Access** (Optional but recommended): A valid `.ROBLOSECURITY` cookie from a Roblox account friended with monitored users (for presence API).
- **Discord Webhook** (For alerts): Create a webhook in your Discord server for notifications.
- **Windows** (For minimize feature): The minimize command uses PowerShell; other OSes may need adaptation.

## Installation

1. Clone the repository:
   ```
   git clone https://github.com/yourusername/roblox-farm-manager.git
   cd roblox-farm-manager
   ```

2. Install dependencies:
   ```
   npm install
   ```
   Required packages: `discord.js`, `dotenv`, `node:child_process`, `node:fs/promises`, `node:path`.

3. Create a `.env` file in the root directory with the following content (replace placeholders):
   ```
   DISCORD_TOKEN=your_discord_bot_token
   CLIENT_ID=your_discord_client_id
   GUILD_ID=your_discord_guild_id

   ROBLOX_PKG=com.roblox.client

   ALLOWED_USERS=your_discord_user_id1,your_discord_user_id2

   # Optional: Override defaults
   BEE_SWARM_PLACE_ID=1537690962
   MINIMIZE_PROCESS_NAMES=MuMuNxDevice,MuMuVMMHeadless
   ```
   - `DISCORD_TOKEN`: From Discord Developer Portal.
   - `CLIENT_ID`: Bot's Application ID.
   - `GUILD_ID`: Server ID where the bot will operate.
   - `ROBLOX_PKG`: Android package name for Roblox (default: `com.roblox.client`).
   - `ALLOWED_USERS`: Comma-separated Discord user IDs allowed to use the bot.
   - `BEE_SWARM_PLACE_ID`: Roblox place ID for Bee Swarm Simulator (default provided).
   - `MINIMIZE_PROCESS_NAMES`: Comma-separated process names for emulator windows to minimize.

## Configuration

The bot uses `config.json` for runtime settings (auto-generated on first run). Key sections:

- **devices**:
  - `defaultCoords`: Default tap coordinates for authentication (e.g., Receive Key button).
  - `coordsBySerial`: Per-device overrides (key: ADB serial, value: coord object).
  - `minimizeProcessNames`: Array of process names to minimize (e.g., `["MuMuNxDevice"]`).

- **farm**:
  - `enabled`: Boolean to toggle monitoring.
  - `placeId`: Target Roblox place ID.
  - `pollSeconds`: Interval for presence checks (default: 30).
  - `consecutiveFails`: Fails before alerting (default: 2).
  - `cooldownSeconds`: Min seconds between alerts (default: 600).
  - `webhookUrl`: Discord webhook for alerts.
  - `strictPlaceMatch`: Boolean for strict place ID matching.
  - `watch`: Array of monitored users (e.g., `{ usernameLower: "user", userId: 123, targetSerial: "emulator-5554" }`).
  - `robloxCookie`: `.ROBLOSECURITY` for API auth.
  - `autoRestart`: Boolean to enable auto-restart on fail.

Edit `config.json` manually if needed, but prefer using bot commands.

## Running the Bot

1. Start the bot:
   ```
   node index.js  # Assuming the main file is index.js
   ```
   The bot will log in and start the monitoring loop if enabled.

2. Invite the bot to your Discord server using the OAuth2 URL from the Developer Portal (scopes: `bot`, permissions: `Send Messages`, `Use Slash Commands`).

## Registering Slash Commands

Run the registration script to set up slash commands in your guild:
```
node register-commands.js  # Assuming the file is register-commands.js
```
This deploys commands like `/farm`, `/device`, etc. Run it whenever commands change.

## Usage

### Commands Overview

All commands are slash commands (`/` prefix). Only allowed users can use them.

- **/roblox-open [target]**: Launch Roblox and join Bee Swarm on the specified ADB device.
- **/roblox-close [target]**: Force-close Roblox on the device.
- **/receive-key [target]**: Tap "Receive Key" button and return to Roblox (for auth).
- **/enter-key [target] [key]**: Enter the provided key and tap Continue.
- **/minimize-instances**: Minimize configured emulator windows (Windows-only).

- **/device**:
  - `list`: List connected ADB devices.
  - `coords-show [target]`: Show tap coordinates for a device.
  - `coords-clear [target]`: Clear custom coords for a device.
  - `coords-default [receive_x] [receive_y] [key_x] [key_y] [cont_x] [cont_y]`: Set default coords.
  - `coords-set [target] [receive_x] ...`: Set per-device coords.
  - `minimize-set [names]`: Set process names to minimize (comma-separated).
  - `minimize-show`: Show current minimize processes.

- **/farm**:
  - `add [username] [target?]`: Add a Roblox user to monitor (optional device mapping for auto-restart).
  - `remove [username]`: Remove a user.
  - `list`: List monitored users.
  - `set-place [place_id]`: Set target place ID.
  - `set-webhook [url]`: Set alert webhook.
  - `clear-webhook`: Clear webhook.
  - `test-webhook`: Send test message.
  - `set-poll [seconds]`: Set poll interval.
  - `set-fails [count]`: Set consecutive fails threshold.
  - `set-cooldown [seconds]`: Set alert cooldown.
  - `set-strict [enabled]`: Toggle strict matching.
  - `set-cookie [cookie]`: Set Roblox auth cookie.
  - `clear-cookie`: Clear cookie.
  - `set-autorestart [enabled]`: Toggle auto-restart.
  - `start`: Start monitoring.
  - `stop`: Stop monitoring.
  - `status`: Show config and status.

### Farm Monitoring

1. Add users with `/farm add [username]` (resolve to Roblox ID automatically).
2. Set webhook and cookie if needed.
3. Enable with `/farm start`.
4. The bot polls presence every `pollSeconds`. If not in-game for `consecutiveFails` polls, it alerts (and restarts if enabled and device mapped).

### Auto-Restart

- Requires `autoRestart: true` (`/farm set-autorestart true`).
- Map devices when adding users (`/farm add [username] [target]`).
- On alert, closes Roblox, relaunches, and rejoins the place.

## How It Works

- **ADB Integration**: Uses `child_process` to run ADB commands for device control.
- **Roblox API**: Fetches user presence with optional auth cookie. Falls back to legacy API if needed.
- **Discord Integration**: Handles slash commands, autocomplete for devices, and webhooks for alerts.
- **Persistence**: Loads/saves config from `config.json`.
- **Monitoring Loop**: Async loop polls presence, checks conditions, and acts accordingly.

## Troubleshooting

- **ADB Not Found**: Ensure `adb` is in PATH. Test with `adb devices`.
- **Device Not Listed**: Check emulator ADB settings (e.g., MuMu: enable ADB in settings).
- **API Errors**: If presence fails, set a valid cookie (`/farm set-cookie`). Ensure the account is friended with users.
- **Rate Limits**: Roblox API may limit unauth calls; use cookie. Poll interval too low may cause issues.
- **Windows Minimize Fails**: Verify process names match Task Manager.
- **Bot Not Responding**: Check console logs, ensure token/guild IDs correct, bot online.
- **Legacy API Deprecated**: As of 2025, legacy endpoint may be gone; rely on auth cookie.

## Security Considerations

- **.env File**: Never commit to Git; contains sensitive tokens.
- **Roblox Cookie**: Treat as a password; exposes account access. Store only if necessary.
- **Allowed Users**: Restrict to trusted IDs to prevent abuse.
- **ADB**: Runs system commands; ensure secure environment.
- **Webhooks**: Use server-specific webhooks to avoid spam.

## Contributing

Pull requests welcome! For major changes, open an issue first. Follow code style (ESLint recommended).

## License

MIT License. See [LICENSE](LICENSE) for details.