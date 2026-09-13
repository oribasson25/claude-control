import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { CONFIG_DIR, LOG_PATH } from "./config.js";

/**
 * Registering the relay to run in the background.
 *
 * The write path only works while the relay is running, so on a laptop it needs
 * to survive a reboot without anyone remembering to start it. macOS gets a
 * LaunchAgent, Linux a systemd user unit; anything else is told to run it itself.
 */

const LABEL = "com.claude-control.agent";

function entrypoint() {
  // The installed CLI's own path, so the service runs this exact version.
  return path.resolve(new URL("../bin/claude-control-agent.js", import.meta.url).pathname);
}

function plistPath() {
  return path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
}

function systemdPath() {
  return path.join(os.homedir(), ".config", "systemd", "user", "claude-control-agent.service");
}

function installLaunchAgent() {
  const target = plistPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${entrypoint()}</string>
    <string>start</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${LOG_PATH}</string>
  <key>StandardErrorPath</key><string>${LOG_PATH}</string>
</dict>
</plist>
`;

  fs.writeFileSync(target, plist, "utf8");
  // `bootout` first so re-running install picks up a changed plist.
  try {
    execFileSync("launchctl", ["bootout", `gui/${process.getuid()}/${LABEL}`], {
      stdio: "ignore",
    });
  } catch {
    // Not loaded yet — nothing to unload.
  }
  execFileSync("launchctl", ["bootstrap", `gui/${process.getuid()}`, target], {
    stdio: "ignore",
  });

  return target;
}

function installSystemdUnit() {
  const target = systemdPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });

  const unit = `[Unit]
Description=Claude Control relay agent

[Service]
ExecStart=${process.execPath} ${entrypoint()} start
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`;

  fs.writeFileSync(target, unit, "utf8");
  execFileSync("systemctl", ["--user", "daemon-reload"], { stdio: "ignore" });
  execFileSync("systemctl", ["--user", "enable", "--now", "claude-control-agent"], {
    stdio: "ignore",
  });

  return target;
}

/** Installs and starts the background service. Returns null on unsupported OSes. */
export function installService() {
  if (process.platform === "darwin") return installLaunchAgent();
  if (process.platform === "linux") return installSystemdUnit();
  return null;
}

export function removeService() {
  try {
    if (process.platform === "darwin") {
      execFileSync("launchctl", ["bootout", `gui/${process.getuid()}/${LABEL}`], {
        stdio: "ignore",
      });
      fs.rmSync(plistPath(), { force: true });
      return plistPath();
    }
    if (process.platform === "linux") {
      execFileSync("systemctl", ["--user", "disable", "--now", "claude-control-agent"], {
        stdio: "ignore",
      });
      fs.rmSync(systemdPath(), { force: true });
      return systemdPath();
    }
  } catch {
    // Already gone, or never installed.
  }
  return null;
}
