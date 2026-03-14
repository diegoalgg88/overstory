# Overstory Hooks - Multi-Platform Integration Guide

## Architecture Summary

Overstory now supports native hook installation for multiple AI agent platforms. Each platform has a different hook/extension system:

| Platform | Hook System | Implementation |
|----------|-------------|----------------|
| **Claude Code** | JSON + Bash scripts | `.claude/settings.local.json` |
| **Qwen Code** | Shell commands | `.qwen/settings.json` + Python wrapper |
| **Pi (Google ADK)** | TypeScript extensions | `~/.pi/agent/extensions/*.ts` |

---

## Qwen Code Integration

### Architecture

**Analysis Reference:** `C:\Users\DiegoGzz\Documents\Programas\Qwen\qwen-code\packages`

- **Hook Format:** Shell commands (NOT Python directly)
- **Config Location:** `.qwen/settings.json`
- **Execution:** `child_process.spawn` for commands
- **Events:** 13 lifecycle events
- **Tool Interception:** ✅ Via `PreToolUse` with modification
- **Context Injection:** ✅ Via `UserPromptSubmit` with `additionalContext`

### Installation

```bash
# Install Overstory hooks for Qwen Code
ov hooks-qwen install

# Force reinstall
ov hooks-qwen install --force

# Check status
ov hooks-qwen status

# Uninstall
ov hooks-qwen uninstall
```

> **Note:** After running `bun install` in the Overstory project, a postinstall script will automatically check if Pi is installed and prompt you to run `ov hooks-pi install` if needed.

### What Gets Installed

1. **Python Wrapper Script:** `~/.qwen/overstory-hooks-wrapper.py`
   - Accepts CLI commands: `get-mail-context`, `intercept-tool`, etc.
   - Returns JSON compatible with Qwen Code
   - Exit codes: 0=success, 1=warning, 2=block

2. **Settings.json Updates:** `.qwen/settings.json`
   ```json
   {
     "hooks": {
       "SessionStart": [
         {
           "matcher": "*",
           "sequential": true,
           "hooks": [
             {
               "type": "command",
               "name": "overstory-session-init",
               "command": "python ~/.qwen/overstory-hooks-wrapper.py session-init",
               "timeout": 30000
             }
           ]
         }
       ],
       "UserPromptSubmit": [
         {
           "matcher": "*",
           "sequential": true,
           "hooks": [
             {
               "type": "command",
               "name": "overstory-mail-context",
               "command": "python ~/.qwen/overstory-hooks-wrapper.py get-mail-context"
             }
           ]
         }
       ],
       "PreToolUse": [
         {
           "matcher": "bash",
           "sequential": false,
           "hooks": [
             {
               "type": "command",
               "name": "overstory-tool-intercept",
               "command": "python ~/.qwen/overstory-hooks-wrapper.py intercept-tool"
             }
           ]
         }
       ]
     }
   }
   ```

### Hook Events Mapped

| Overstory Event | Qwen Code Event | Action |
|-----------------|-----------------|--------|
| `SessionStart` | `SessionStart` | `ov prime` |
| `UserPromptSubmit` | `UserPromptSubmit` | `ov mail check --inject` |
| `PreToolUse` | `PreToolUse` | `ov log tool-start` + validation |
| `PostToolUse` | `PostToolUse` | `ov log tool-end` |
| `Stop` | `Stop` | `ov log session-end` + `mulch learn` |
| `PreCompact` | `PreCompact` | `ov prime --compact` |

### Limitations

- ⚠️ **No tool blocking** - Qwen Code hooks can't block tools, only log
- ⚠️ **Wrapper required** - Python script needed as shell command wrapper
- ⚠️ **JSON output required** - Wrapper must return valid JSON

---

## Pi (Google ADK) Integration

### Architecture

**Analysis Reference:** `C:\Users\DiegoGzz\Documents\Programas\pi-mono\pi-mono\packages`

- **Hook Format:** TypeScript extensions with factory functions
- **Config Location:** `~/.pi/agent/settings.json`
- **Extension Location:** `~/.pi/agent/extensions/*.ts`
- **Execution:** Native TypeScript via jiti (no compilation)
- **Events:** 25+ lifecycle events
- **Tool Interception:** ✅ Via `tool_call` with `{ block: true, reason: "..." }`
- **Event Bus:** ✅ Native `pi.events` for inter-extension communication

### Installation

```bash
# Install Overstory extension for Pi
ov hooks-pi install

# Force reinstall (also cleans up stale absolute paths)
ov hooks-pi install --force

# Check status
ov hooks-pi status

# Uninstall
ov hooks-pi uninstall
```

### What Gets Installed

1. **TypeScript Extension:** `~/.pi/agent/extensions/overstory-integration.ts`
   - Factory function with `ExtensionAPI`
   - Event listeners for all Pi lifecycle events
   - Custom tools: `overstory_status`, `overstory_mail`
   - Event bus integration

2. **Settings.json Updates:** `~/.pi/agent/settings.json`
   ```json
   {
     "extensions": [
       "~/.pi/agent/extensions/overstory-integration.ts"
     ]
   }
   ```
   
   > **Note:** Paths use `~` (tilde) for portability across different user accounts and systems. Absolute paths like `C:\Users\...\overstory-integration.ts` are automatically cleaned up during installation.

### Extension Features

```typescript
// Session lifecycle
pi.on("session_start", async (_event, ctx) => {
  await initializeOverstory(ctx);
});

pi.on("session_shutdown", async (_event, ctx) => {
  await cleanupOverstory(ctx);
});

// Tool interception
pi.on("tool_call", async (event, ctx) => {
  // Log and validate
  if (shouldBlockTool(event.toolName, event.input)) {
    return { block: true, reason: "Blocked by Overstory" };
  }
});

// Context injection
pi.on("before_agent_start", async (event, ctx) => {
  const mailContext = await getMailContext();
  return {
    message: {
      customType: "overstory-mail",
      content: mailContext,
    }
  };
});

// Custom tools
pi.registerTool({
  name: "overstory_status",
  execute: async () => {
    const status = await execAsync("ov status --json");
    return { content: [{ type: "text", text: status.stdout }] };
  }
});
```

### Hook Events Mapped

| Overstory Event | Pi Event | Action |
|-----------------|----------|--------|
| `SessionStart` | `session_start` | Initialize + `ov prime` |
| `UserPromptSubmit` | `input` + `before_agent_start` | Periodic mail check + inject |
| `PreToolUse` | `tool_call` | Log + validate + block if needed |
| `PostToolUse` | `tool_result` | Log completion |
| `Stop` | `session_shutdown` | `ov log session-end` + `mulch learn` |
| `PreCompact` | `session_before_compact` | `ov prime --compact` |

### Capabilities

- ✅ **Tool blocking** - Can block dangerous tools with reason
- ✅ **Event bus** - Native `pi.events` for communication
- ✅ **Custom tools** - Register `overstory_status`, `overstory_mail`
- ✅ **Context injection** - Via `before_agent_start`
- ✅ **Session persistence** - Via `pi.appendEntry()`
- ✅ **UI notifications** - Via `ctx.ui.notify()`

---

## Claude Code Integration (Reference)

### Architecture

- **Hook Format:** JSON config with bash scripts
- **Config Location:** `.claude/settings.local.json`
- **Events:** 8 lifecycle events
- **Tool Interception:** ✅ Via `PreToolUse` with JSON response
- **Blocking:** ✅ Full tool blocking support

### Installation

```bash
ov hooks install
```

---

## Platform Comparison

| Feature | Claude Code | Qwen Code | Pi (ADK) |
|---------|-------------|-----------|----------|
| **Hook Format** | JSON + bash | Shell commands | TypeScript |
| **Events** | 8 | 13 | 25+ |
| **Tool Blocking** | ✅ Yes | ⚠️ Log only | ✅ Yes |
| **Context Injection** | ✅ Yes | ✅ Yes | ✅ Yes |
| **Event Bus** | ❌ No | ❌ No | ✅ Yes |
| **Custom Tools** | ❌ No | ❌ No | ✅ Yes |
| **UI Integration** | ❌ No | ❌ No | ✅ Yes |
| **Session Persistence** | ✅ Files | ❌ No | ✅ API |

---

## Troubleshooting

### Qwen Code

**Hooks not executing:**
```bash
# Check settings.json
cat ~/.qwen/settings.json

# Verify wrapper script exists
ls -la ~/.qwen/overstory-hooks-wrapper.py

# Test wrapper manually
python ~/.qwen/overstory-hooks-wrapper.py session-init
```

**JSON parse errors:**
```bash
# Validate settings.json
node -e "JSON.parse(require('fs').readFileSync('~/.qwen/settings.json'))"
```

### Pi (Google ADK)

**Extension not loading:**
```bash
# Check settings.json has extension path (should use ~ not absolute path)
cat ~/.pi/agent/settings.json

# Verify extension file exists
ls -la ~/.pi/agent/extensions/overstory-integration.ts

# Check for TypeScript errors
bun run ~/.pi/agent/extensions/overstory-integration.ts

# If you see absolute paths (C:\Users\...), reinstall to clean up:
ov hooks-pi install --force
```

**Tool not registered:**
```bash
# Restart Pi to reload extensions
# Extensions are loaded on startup
```

**Duplicate entries in settings.json:**
```bash
# Reinstall to clean up duplicate absolute paths
ov hooks-pi install --force
```

---

## Implementation Details

### Qwen Code Wrapper Script

The Python wrapper (`overstory-hooks-wrapper.py`) handles:
- CLI argument parsing
- Overstory command execution
- JSON response formatting
- Exit code management

```python
def get_mail_context():
    result = run_ov_command("ov mail check --inject")
    return {
        "hookSpecificOutput": {
            "additionalContext": result["stdout"]
        }
    }
```

### Pi Extension

The TypeScript extension provides:
- State management (`OverstoryState`)
- Async command execution (`runOvCommand`)
- Tool validation (`shouldBlockTool`)
- Event bus integration
- Custom tool registration

---

## Automatic Installation (Postinstall Script)

When you run `bun install` in the Overstory project, a postinstall script automatically:

1. Checks if Pi is installed (`~/.pi/agent` exists)
2. Checks if Overstory hooks exist (`.overstory/hooks.json`)
3. If both exist but the extension is not installed, displays installation instructions

```bash
$ bun install
...
$ bun scripts/postinstall.ts
[overstory] Postinstall: Checking Pi integration...
[overstory] Postinstall: Pi detected with hooks source, but extension not installed.
[overstory] Postinstall: Run the following command to complete installation:

    bun x ov hooks-pi install

```

> **Note:** The postinstall script does NOT automatically install the extension - it only prompts you to run the installation command manually. This ensures you're aware of the changes being made to your Pi configuration.

---

## Next Steps

### For Qwen Code
1. ✅ Install hooks: `ov hooks-qwen install`
2. ✅ Restart Qwen Code
3. ✅ Test with `/hooks list`
4. ⚠️ Verify mail injection on user prompt

### For Pi
1. ✅ Install extension: `ov hooks-pi install`
2. ✅ Restart Pi
3. ✅ Use `/overstory_status` tool
4. ✅ Test tool interception

### For Both
- Monitor logs for errors
- Check `ov status` for agent activity
- Review `mulch learn` output after sessions

---

## References

- **Qwen Code Analysis:** `C:\Users\DiegoGzz\Documents\Programas\Qwen\qwen-code\packages`
- **Pi Analysis:** `C:\Users\DiegoGzz\Documents\Programas\pi-mono\pi-mono\packages`
- **Source Code:** `overstory/src/commands/hooks-qwen.ts`, `hooks-pi.ts`
