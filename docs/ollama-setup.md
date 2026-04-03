# Ollama Setup for FileScopeMCP

[Back to README](../README.md)

FileScopeMCP uses a custom Ollama model called `FileScopeMCP-brain`, defined by the `Modelfile` in the repo root. This model has a tuned system prompt for code analysis tasks (file summaries, key concepts, change impact assessments) and parameters set for near-deterministic output (`temperature: 0.1`, `num_ctx: 32768`).

Without Ollama, FileScopeMCP still works for file tracking and dependency analysis — you just won't get auto-generated summaries, concepts, or change impact assessments.

Pick the guide that matches your setup:

- [Same machine (Linux/macOS)](#same-machine-linuxmacos) — Ollama and FileScopeMCP on the same OS
- [WSL2 + Windows GPU](#wsl2--windows-gpu) — FileScopeMCP in WSL2, Ollama on Windows to access the GPU
- [Remote / LAN server](#remote--lan-server) — Ollama runs on a different machine on your network

---

## Same Machine (Linux/macOS)

```bash
./setup-llm.sh
```

This script will:

- Install Ollama if not present (supports Linux and macOS)
- Detect GPU hardware (NVIDIA, AMD, Metal) and configure acceleration
- Pull the base model (`gemma4:e4b`)
- Create the custom `FileScopeMCP-brain` model from the Modelfile
- Verify the installation

To check status afterward:

```bash
./setup-llm.sh --status
```

No broker config changes are needed — the default `broker.default.json` template points at `localhost:11434`, and the broker auto-copies it to `~/.filescope/broker.json` on first start if the file is missing.

---

## WSL2 + Windows GPU

This is the most common setup for Windows users with a dedicated GPU. WSL2 doesn't have direct GPU access for Ollama, so Ollama runs natively on Windows and FileScopeMCP connects to it across the WSL network boundary.

### Step 1: Install Ollama on Windows

Download and install Ollama from [ollama.com/download/windows](https://ollama.com/download/windows). Run the installer and follow the prompts.

Verify the installation by opening PowerShell or Command Prompt:

```powershell
ollama --version
```

### Step 2: Configure Ollama to accept network connections

By default, Ollama only listens on `127.0.0.1` (localhost), which means WSL2 cannot reach it. Open PowerShell and set the environment variable permanently:

```powershell
[System.Environment]::SetEnvironmentVariable("OLLAMA_HOST", "0.0.0.0:11434", "User")
```

**Important:** Close and reopen any terminal windows after setting this. If Ollama is running in the system tray, quit it completely and restart it so it picks up the new setting.

### Step 3: Start Ollama

You have three options:

- **System tray (default):** Launch the Ollama app from the Start Menu. It runs in the background with a tray icon. This is the easiest option for day-to-day use.
- **Foreground in a terminal** (useful for debugging):
  ```powershell
  ollama serve
  ```
- **Headless background process** (no window, no tray icon):
  ```powershell
  Start-Process ollama -ArgumentList "serve" -WindowStyle Hidden
  ```

### Step 4: Pull the base model and create the custom model

In PowerShell or Command Prompt on Windows:

```powershell
ollama pull gemma4:e4b
```

This downloads approximately 5 GB. Wait for it to complete.

Next, copy the Modelfile from WSL to Windows and create the custom model. In your WSL terminal:

```bash
cp ~/FileScopeMCP/Modelfile /mnt/c/Users/$USER/Modelfile
```

> **Note:** If your Windows username differs from your WSL username, replace `$USER` with your actual Windows username: `/mnt/c/Users/YourWindowsName/Modelfile`

Then in PowerShell on Windows:

```powershell
cd $env:USERPROFILE
ollama create FileScopeMCP-brain -f Modelfile
```

Verify both models are available:

```powershell
ollama list
```

You should see both `gemma4:e4b` and `FileScopeMCP-brain` in the output.

### Step 5: Configure the broker in WSL

Copy the Windows host broker template to your global FileScopeMCP config:

```bash
mkdir -p ~/.filescope
cp ~/FileScopeMCP/broker.windows-host.json ~/.filescope/broker.json
```

> **How it works:** This template uses `wsl-host` as a placeholder in the URL (`http://wsl-host:11434/v1`). When the broker starts, it automatically resolves `wsl-host` to your Windows host IP by running `ip route show default`. You never need to hardcode the IP.

### Step 6: Configure the Windows Firewall

Windows Firewall may block incoming connections to Ollama from WSL. If `curl` from WSL times out or is refused:

1. Open **Windows Defender Firewall with Advanced Security** (search for "firewall" in the Start Menu)
2. Click **Inbound Rules** > **New Rule...**
3. Select **Port** > **TCP** > Specific port: **11434**
4. Select **Allow the connection**
5. Check all profiles (Domain, Private, Public)
6. Name it `Ollama LLM Server` and save

Or, in an elevated PowerShell (Run as Administrator):

```powershell
New-NetFirewallRule -DisplayName "Ollama LLM Server" -Direction Inbound -Protocol TCP -LocalPort 11434 -Action Allow
```

### Step 7: Verify the connection from WSL

```bash
# Get the Windows host IP
ip route show default | awk '{print $3}'

# Test the connection (replace IP if different)
curl http://$(ip route show default | awk '{print $3}'):11434/v1/models
```

You should see a JSON response listing your installed models. If you get "Connection refused", work through the [WSL + Windows Troubleshooting](#wsl--windows-troubleshooting) section below.

### Step 8: Restart Claude Code

Start (or restart) a Claude Code session in your project directory. FileScopeMCP auto-spawns the broker, connects to Ollama on Windows, and begins processing files. Check status with:

```
status()
```

You should see `brokerConnected: true` and files moving through the LLM queue.

---

## Remote / LAN Server

If Ollama runs on a different machine on your network:

**1. On the remote machine:** set `OLLAMA_HOST=0.0.0.0:11434` and start Ollama.

**2. Copy the LAN broker template:**

```bash
mkdir -p ~/.filescope
cp ~/FileScopeMCP/broker.remote-lan.json ~/.filescope/broker.json
```

**3. Edit the config** and replace `192.168.1.100` with the actual IP of your Ollama machine:

```bash
nano ~/.filescope/broker.json
```

The relevant field is `llm.baseURL` — update it to point at your server:

```json
{
  "llm": {
    "provider": "openai-compatible",
    "model": "FileScopeMCP-brain",
    "baseURL": "http://YOUR_SERVER_IP:11434/v1",
    "maxTokensPerCall": 1024
  },
  "jobTimeoutMs": 120000,
  "maxQueueSize": 1000
}
```

**4. Verify connectivity:**

```bash
curl http://<ollama-ip>:11434/v1/models
```

**5. Create the custom model on the remote machine:**

```bash
# On the remote machine
ollama pull gemma4:e4b
# Copy Modelfile to remote machine (e.g., via scp), then:
ollama create FileScopeMCP-brain -f Modelfile
```

**6. Restart Claude Code** to connect the broker to the remote Ollama instance.

---

## WSL + Windows Troubleshooting

If FileScopeMCP runs in WSL2 and Ollama runs on Windows, work through these checks in order:

### 1. Is Ollama running on Windows?

In a Windows terminal:

```powershell
ollama list
```

If this fails, Ollama isn't running. Start it (see Step 3 above).

### 2. Is Ollama listening on all interfaces?

In a Windows terminal:

```powershell
netstat -an | findstr 11434
```

You should see `0.0.0.0:11434` in the output. If you see `127.0.0.1:11434`, Ollama is only accepting local connections. Set `OLLAMA_HOST`:

```powershell
[System.Environment]::SetEnvironmentVariable("OLLAMA_HOST", "0.0.0.0:11434", "User")
```

Then fully quit and restart Ollama.

### 3. Can WSL reach the Windows host?

From your WSL terminal:

```bash
# Get the Windows host IP
ip route show default | awk '{print $3}'

# Test basic connectivity
curl http://$(ip route show default | awk '{print $3}'):11434/v1/models
```

If `curl` hangs or returns "Connection refused":

- **Firewall:** Windows Firewall may be blocking port 11434. See Step 6 above.
- **VPN/proxy:** Some VPN software changes WSL2 networking. Try disconnecting the VPN temporarily.

### 4. Is the broker config correct?

```bash
cat ~/.filescope/broker.json
```

The `baseURL` should contain either `wsl-host` (auto-resolved to the Windows host IP) or the actual Windows host IP. If the file doesn't exist or uses `localhost`, copy the correct template:

```bash
cp ~/FileScopeMCP/broker.windows-host.json ~/.filescope/broker.json
```

### 5. Is the broker process running?

```bash
ps aux | grep 'broker' | grep -v grep
```

If no broker process is running, it may have crashed. Check the log:

```bash
cat ~/.filescope/broker.log
```

Common errors:

- `ECONNREFUSED` — Ollama isn't reachable (go back to checks 2–3)
- `model not found` — the `FileScopeMCP-brain` custom model wasn't created on Windows (see Step 4)
- Stale socket file — remove it and let the broker respawn:
  ```bash
  rm ~/.filescope/broker.sock
  ```
  Then restart your Claude Code session.

### 6. Does the custom model exist on Windows?

In a Windows terminal:

```powershell
ollama list
```

You should see `FileScopeMCP-brain` in the list. If not, create it:

```powershell
cd $env:USERPROFILE
ollama create FileScopeMCP-brain -f Modelfile
```

If the Modelfile isn't on Windows, copy it from WSL first:

```bash
cp ~/FileScopeMCP/Modelfile /mnt/c/Users/$USER/Modelfile
```
