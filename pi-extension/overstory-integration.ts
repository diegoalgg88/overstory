/**
 * Overstory Integration Extension for Pi (Google ADK)
 *
 * This extension provides deep integration with the Overstory ecosystem,
 * including session management, metric tracking, and swarm orchestration.
 */

import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, parse } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

let piAPI: ExtensionAPI;

const logger = {
	log: (msg: string) => console.log("[Overstory]", msg),
	debug: (msg: string, ...args: unknown[]) => console.debug("[Overstory]", msg, ...args),
	warn: (msg: string) => console.warn("[Overstory]", msg),
	error: (msg: string, err?: unknown) => console.error("[Overstory]", msg, err),
};

/**
 * Get the full path to overstory CLI.
 */
function getOvPath(): string {
	const home = homedir();
	const binName = process.platform === "win32" ? "ov.exe" : "ov";
	const bunBinPath = join(home, ".bun", "bin", binName);

	if (existsSync(bunBinPath)) return bunBinPath;
	return "ov";
}

/**
 * Find the project root by searching upwards for a .git directory.
 * Falls back to process.cwd() if no .git is found.
 */
function findProjectRoot(startDir: string = process.cwd()): string {
	let currentDir = startDir;
	const root = parse(currentDir).root;

	while (currentDir && currentDir !== root) {
		if (existsSync(join(currentDir, ".git"))) {
			return currentDir;
		}
		const parent = dirname(currentDir);
		if (parent === currentDir) break;
		currentDir = parent;
	}
	return startDir;
}

/**
 * Check if overstory CLI is available.
 */
async function isOverstoryAvailable(): Promise<boolean> {
	try {
		const { exec } = await import("child_process");
		const { promisify } = await import("util");
		const execAsync = promisify(exec);

		const ovPath = getOvPath();

		await execAsync(`"${ovPath}" --version`, {
			timeout: 5000,
		});
		return true;
	} catch {
		return false;
	}
}

/**
 * Execute Overstory command asynchronously.
 */
async function runOvCommand(cmd: string, ctx?: ExtensionContext): Promise<string> {
	try {
		const { exec } = await import("child_process");
		const { promisify } = await import("util");
		const execAsync = promisify(exec);

		const ovPath = getOvPath();
		const fullCmd = cmd.replace(/^ov\b/, ovPath);

		const projectRoot = findProjectRoot();
		const result = await execAsync(fullCmd, {
			timeout: 30000,
			cwd: projectRoot,
			env: {
				...process.env,
				PI_PROJECT_DIR: projectRoot,
			},
		});

		return result.stdout?.trim() || "";
	} catch (error: any) {
		if (error.code === "ENOENT" || error.stderr?.includes("not recognized")) {
			logger.debug("Overstory CLI not found - command not available");
			throw new Error("Overstory CLI not found - run `bun install -g @os-eco/overstory-cli`");
		}
		logger.debug("Overstory command failed", error);
		throw error;
	}
}

/**
 * Attempt to extract JSON from potentially corrupted output.
 */
function extractJson(output: string): any {
	if (!output || output.trim() === "") {
		return { success: true, sessions: [] };
	}

	// Try direct parse first
	try {
		return JSON.parse(output);
	} catch {
		// Look for first { and last }
		const start = output.indexOf("{");
		const end = output.lastIndexOf("}");
		if (start !== -1 && end !== -1 && end > start) {
			const cleaned = output.substring(start, end + 1);
			try {
				return JSON.parse(cleaned);
			} catch {
				return { success: false, error: "Invalid JSON" };
			}
		}
		return { success: false, error: "Invalid JSON" };
	}
}

/**
 * Initialize Overstory integration.
 */
async function initializeOverstory(ctx: ExtensionContext): Promise<void> {
	try {
		const overstoryAvailable = await isOverstoryAvailable();
		if (!overstoryAvailable) {
			logger.debug("Overstory CLI not found - skipping initialization");
			return;
		}

		// Check if .overstory/ directory exists
		const projectDir = findProjectRoot();
		const gitDirExists = existsSync(join(projectDir, ".git"));
		const ovDir = join(projectDir, ".overstory");
		const ovDirExists = existsSync(ovDir);

		logger.debug(
			`Initializing Overstory. Project Dir: ${projectDir}, Git Exists: ${gitDirExists}, Overstory Dir: ${ovDir}, Overstory Exists: ${ovDirExists}`,
		);

		if (!ovDirExists) {
			if (!gitDirExists) {
				logger.debug("No .git/ directory found - Overstory prefers a git repository");
				return;
			}

			// Auto-create directory
			try {
				logger.debug(`Auto-creating missing directory: ${ovDir}`);
				mkdirSync(ovDir, { recursive: true });
				ctx.ui?.notify?.(
					`Overstory: Created missing .overstory/ directory at ${ovDir}. Run \`ov init\` to complete setup.`,
					"info",
				);
			} catch (error) {
				logger.debug(`Failed to auto-create directory: ${ovDir}`, error);
				ctx.ui?.notify?.(
					`Overstory: No .overstory/ directory found at ${ovDir}. Run \`ov init\` to initialize.`,
					"info",
				);
			}
			return;
		}

		ctx.ui?.notify?.("Overstory initialized", "success");
		logger.log("Overstory integration initialized");
	} catch (error: any) {
		logger.debug("Failed to initialize Overstory", error);
	}
}

/**
 * Main extension factory function.
 */
export default function (pi: ExtensionAPI) {
	piAPI = pi;

	/**
	 * Session Start - Initialize Overstory integration
	 */
	pi.on("session_start", async (_event: any, ctx: ExtensionContext) => {
		logger.log("Session started - initializing Overstory Integration");
		await initializeOverstory(ctx);
	});

	/**
	 * Activity Tracking for Watchdog Tier 2
	 * Prevents watchdog from marking active agents as zombies
	 */
	pi.on("tool_execution_end", async (event: any, ctx: ExtensionContext) => {
		// Log activity to prevent watchdog from marking as zombie
		try {
			await runOvCommand("ov log activity --event tool_execution", ctx);
			logger.debug("Activity logged: tool_execution");
		} catch (error: any) {
			// Silently ignore - activity logging is optional
			logger.debug("Failed to log tool_execution activity", error);
		}
	});

	pi.on("session_shutdown", async (_event: any, ctx: ExtensionContext) => {
		// Final activity log before shutdown
		try {
			await runOvCommand("ov log activity --event session_shutdown", ctx);
			logger.debug("Activity logged: session_shutdown");
		} catch (error: any) {
			// Silently ignore
			logger.debug("Failed to log session_shutdown activity", error);
		}
	});

	// Custom tools for Overstory orchestration
	pi.registerTool({
		name: "overstory_status",
		label: "Get Overstory Status",
		description: "Get the status of the Overstory ecosystem and active sessions",
		parameters: {
			type: "object",
			properties: {},
		} as any,
		async execute(
			_toolCallId: string,
			_params: any,
			_signal: any,
			_onUpdate: any,
			ctx: ExtensionContext,
		) {
			try {
				const output = await runOvCommand("ov status --json", ctx);
				const status = extractJson(output);

				return {
					content: [
						{
							type: "text",
							text: `Overstory Status: ${status.success ? "Online" : "Offline"}\nSessions: ${status.sessions?.length || 0}`,
						},
					],
					details: status,
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text",
							text: `Failed to get status: ${error}`,
						},
					],
					isError: true,
				};
			}
		},
	});

	/**
	 * Custom tool: Send Overstory Mail
	 * Allows agents to communicate via the Overstory mail system
	 */
	pi.registerTool({
		name: "overstory_mail",
		label: "Send Overstory Mail",
		description: "Send a message to another agent via Overstory mail system",
		parameters: {
			type: "object",
			properties: {
				to: { type: "string", description: "Recipient agent name" },
				subject: { type: "string", description: "Message subject" },
				body: { type: "string", description: "Message body" },
			},
			required: ["to", "body"],
		} as any,
		async execute(
			_toolCallId: string,
			params: any,
			_signal: any,
			_onUpdate: any,
			ctx: ExtensionContext,
		) {
			try {
				const { to, subject = "Message", body } = params;
				// Escape double quotes for shell command
				const escapedBody = body.replace(/"/g, '\\"');
				const escapedSubject = subject.replace(/"/g, '\\"');

				await runOvCommand(
					`ov mail send --to "${to}" --subject "${escapedSubject}" --body "${escapedBody}"`,
					ctx,
				);

				return {
					content: [
						{
							type: "text",
							text: `✓ Mail sent to ${to}`,
						},
					],
				};
			} catch (error: any) {
				return {
					content: [
						{
							type: "text",
							text: `Failed to send mail: ${error}`,
						},
					],
					isError: true,
				};
			}
		},
	});

	logger.log("Overstory extension loaded");
}
