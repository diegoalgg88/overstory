#!/usr/bin/env bun

/**
 * Postinstall script: Automatically copy Pi extension if Pi is detected.
 *
 * This script runs after `bun install` and:
 * 1. Checks if Pi agent directory exists (~/.pi/agent)
 * 2. Checks if source extension exists (pi-extension/overstory-integration.ts)
 * 3. If both exist, copies Overstory extension for Pi
 *
 * NOTE: This script ONLY copies the extension file. It does NOT modify
 * ~/.pi/agent/settings.json. Users must manually register the extension
 * in their settings.json if they want it to load automatically.
 *
 * Safe to run multiple times - overwrites existing extension file.
 */

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const HOME = homedir();
const PI_DIR = join(HOME, ".pi", "agent");
const PI_EXTENSIONS_DIR = join(PI_DIR, "extensions");
const SOURCE_EXTENSION = join(projectRoot, "pi-extension", "overstory-integration.ts");
const DEST_EXTENSION = join(PI_EXTENSIONS_DIR, "overstory-integration.ts");

async function main(): Promise<void> {
	console.log("[overstory] Postinstall: Checking Pi integration...");

	// Check if Pi is installed
	if (!existsSync(PI_DIR)) {
		console.log(
			"[overstory] Postinstall: Pi not detected (~/.pi/agent not found). Skipping extension installation.",
		);
		console.log(
			"[overstory] Postinstall: Extension file would be copied to: ~/.pi/agent/extensions/ (manual registration required)",
		);
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
		console.log("");
		console.log("[overstory] Postinstall: ✅ Overstory Pi Extension copied successfully!");
		console.log("");
		console.log("📝 NOTE: Extension file copied but NOT automatically registered.");
		console.log("💡 To enable the extension, add this to ~/.pi/agent/settings.json:");
		console.log('   { "extensions": ["~/.pi/agent/extensions/overstory-integration.ts"] }');
	} catch (error) {
		console.error(`[overstory] Postinstall: Failed to copy extension: ${error}`);
	}
}

main().catch((err: unknown) => {
	console.error("[overstory] Postinstall error:", err instanceof Error ? err.message : String(err));
	// Don't fail the install - this is optional
	process.exit(0);
});
