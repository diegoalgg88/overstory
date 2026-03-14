#!/usr/bin/env bun

/**
 * Postinstall script: Automatically install Pi hooks if Pi is detected.
 *
 * This script runs after `bun install` and:
 * 1. Checks if Pi agent directory exists (~/.pi/agent)
 * 2. Checks if .overstory/hooks.json exists (hooks source)
 * 3. If both exist, installs Overstory extension for Pi
 *
 * Safe to run multiple times - skips if already installed.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const HOME = homedir();
const PI_DIR = join(HOME, ".pi", "agent");
const PI_SETTINGS_PATH = join(PI_DIR, "settings.json");
const PI_EXTENSIONS_DIR = join(PI_DIR, "extensions");
const SOURCE_EXTENSION = join(projectRoot, "pi-extension", "overstory-integration.ts");
const DEST_EXTENSION = join(PI_EXTENSIONS_DIR, "overstory-integration.ts");

async function main(): Promise<void> {
	console.log("[overstory] Postinstall: Checking Pi integration...");

	// Check if Pi is installed
	if (!existsSync(PI_DIR)) {
		console.log("[overstory] Postinstall: Pi not detected (~/.pi/agent not found). Skipping hooks installation.");
		return;
	}

	// Check if source extension exists
	if (!existsSync(SOURCE_EXTENSION)) {
		console.log("[overstory] Postinstall: Source extension not found. Skipping.");
		return;
	}

	// Ensure extensions directory exists
	if (!existsSync(PI_EXTENSIONS_DIR)) {
		try {
			mkdirSync(PI_EXTENSIONS_DIR, { recursive: true });
			console.log(`[overstory] Postinstall: Created extensions directory: ${PI_EXTENSIONS_DIR}`);
		} catch (error) {
			console.error(`[overstory] Postinstall: Failed to create extensions directory: ${error}`);
			return;
		}
	}

	// Copy extension file
	try {
		copyFileSync(SOURCE_EXTENSION, DEST_EXTENSION);
		console.log(`[overstory] Postinstall: Extension copied to ${DEST_EXTENSION}`);
	} catch (error) {
		console.error(`[overstory] Postinstall: Failed to copy extension: ${error}`);
		return;
	}

	// Update settings.json
	if (!existsSync(PI_SETTINGS_PATH)) {
		console.log("[overstory] Postinstall: settings.json not found. Creating a new one.");
		writeFileSync(PI_SETTINGS_PATH, JSON.stringify({ extensions: [] }, null, 2) + "\n");
	}

	try {
		const settingsContent = readFileSync(PI_SETTINGS_PATH, "utf-8");
		const settings = JSON.parse(settingsContent);

		if (!settings.extensions) {
			settings.extensions = [];
		}

		// Use tilde path for registration
		const tildePath = "~/.pi/agent/extensions/overstory-integration.ts";
		
		const alreadyRegistered = settings.extensions.some((ext: string) =>
			ext === tildePath || ext.includes("overstory-integration.ts")
		);

		if (!alreadyRegistered) {
			settings.extensions.push(tildePath);
			writeFileSync(PI_SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
			console.log(`[overstory] Postinstall: Extension registered in settings.json as ${tildePath}`);
		} else if (settings.extensions.some((ext: string) => ext.includes("overstory-integration.ts") && ext !== tildePath)) {
			// Update existing registration to use tilde path
			settings.extensions = settings.extensions.map((ext: string) => 
				ext.includes("overstory-integration.ts") ? tildePath : ext
			);
			writeFileSync(PI_SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
			console.log(`[overstory] Postinstall: Updated extension registration to use tilde path: ${tildePath}`);
		}
		
		console.log("[overstory] Postinstall: Overstory Pi Extension installed successfully!");
	} catch (error) {
		console.error(`[overstory] Postinstall: Failed to update settings.json: ${error}`);
	}
}

main().catch((err: unknown) => {
	console.error("[overstory] Postinstall error:", err instanceof Error ? err.message : String(err));
	// Don't fail the install - this is optional
	process.exit(0);
});
