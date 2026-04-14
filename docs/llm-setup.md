# LLM Setup for FileScopeMCP

[Back to README](../README.md)

FileScopeMCP uses [llama.cpp](https://github.com/ggml-org/llama.cpp)'s `llama-server` as a local OpenAI-compatible LLM backend. The default model is Gemma 4 26B A4B MoE (Unsloth `unsloth/gemma-4-26B-A4B-it-GGUF:UD-Q5_K_S`, ~18GB on disk, ~3.8B active params per token via 8 routed + 1 shared expert out of 128). The model alias `FileScopeMCP-brain` is what the broker expects — pass `--alias FileScopeMCP-brain` on the llama-server command line.

Without a running llama-server, FileScopeMCP still works for file tracking and dependency analysis — you just won't get auto-generated summaries, concepts, or change-impact assessments.

Pick the guide that matches your setup:

- [Same machine (Linux/macOS)](#same-machine-linuxmacos) — llama-server and FileScopeMCP on the same OS
- [WSL2 + Windows GPU](#wsl2--windows-gpu) — FileScopeMCP in WSL2, llama-server on Windows for GPU access
- [Remote / LAN server](#remote--lan-server) — llama-server on a different machine on your network

---

## Same Machine (Linux/macOS)

```bash
./setup-llm.sh
```

This prints a platform-specific setup guide. It does NOT install anything for you — you build or install llama.cpp yourself.

### Linux

Build from source with the backend that matches your GPU:

```bash
git clone https://github.com/ggml-org/llama.cpp
cd llama.cpp
# NVIDIA:
cmake -B build -DGGML_CUDA=ON
# AMD (Vulkan is the recommended backend — see WSL2 section for why):
cmake -B build -DGGML_VULKAN=ON
cmake --build build --config Release -j
```

Or run the CUDA Docker image:

```bash
docker run --gpus all -p 8080:8080 \
  -v $HOME/.cache/llama.cpp:/root/.cache/llama.cpp \
  ghcr.io/ggml-org/llama.cpp:server-cuda \
  -hf unsloth/gemma-4-26B-A4B-it-GGUF:UD-Q5_K_S \
  --alias FileScopeMCP-brain -c 32768 -ngl 99 --n-cpu-moe 99 \
  -fa on --jinja --host 0.0.0.0 --port 8080
```

Run `./setup-llm.sh --launch` to print the exact launch command for the native binary.

### macOS

```bash
brew install llama.cpp
```

Metal is the default backend — no configuration needed. Launch with the same command `./setup-llm.sh --launch` prints.

### First run

On first launch, `llama-server -hf unsloth/gemma-4-26B-A4B-it-GGUF:UD-Q5_K_S` auto-downloads the ~18GB GGUF into `$LLAMA_CACHE` (or `~/.cache/llama.cpp` if unset). llama-server does not accept HTTP traffic until the model is fully loaded — this can take 5-10 minutes on a fast connection.

Verify with:

```bash
./setup-llm.sh --status
```

No broker config changes are needed — the default `broker.default.json` template points at `localhost:8080`, and the broker auto-copies it to `~/.filescope/broker.json` on first start if the file is missing.

---

## WSL2 + Windows GPU

This is the recommended setup for Windows users with a dedicated GPU. WSL2 doesn't give native GPU access to llama.cpp, so llama-server runs on Windows and FileScopeMCP connects to it across the WSL2 boundary.

### Step 1: Pick the Windows binary

Download the latest llama.cpp Windows release from [github.com/ggml-org/llama.cpp/releases](https://github.com/ggml-org/llama.cpp/releases). Pick the zip that matches your GPU (where `<NNNN>` is the latest build number):

| GPU | File | Backend |
|-----|------|---------|
| **AMD RDNA2/RDNA3** (RX 6800 XT, RX 7900 XT, etc.) | `llama-b<NNNN>-bin-win-vulkan-x64.zip` | Vulkan |
| **NVIDIA** | `llama-b<NNNN>-bin-win-cuda-12.X-x64.zip` | CUDA (no toolkit required for prebuilt) |
| **Intel Arc** | `llama-b<NNNN>-bin-win-vulkan-x64.zip` | Vulkan |

**For AMD: use Vulkan, NOT ROCm.** Two reasons:

1. The ROCm backend is broken on Windows 11 since llama.cpp build b8152 (Issue #19943) — models load CPU-only.
2. Vulkan is 0-50% faster than ROCm on RDNA2 in practice, and the gap widens for MoE models (which includes the default Gemma 4 26B A4B).

No HIP SDK, no Visual Studio, no ROCm SDK needed.

### Step 2: Extract the zip

Right-click → Extract All → enter `C:\llama.cpp`. The zip may or may not create a nested subfolder like `C:\llama.cpp\llama-bNNNN-bin-win-vulkan-x64\`. Find the folder that actually contains `llama-server.exe`:

```powershell
Get-ChildItem -Recurse -Filter llama-server.exe C:\llama.cpp
```

Note the exact folder — you will `cd` into it in Step 4.

### Step 3: Open port 8080 in Windows Firewall

In an elevated PowerShell (Run as Administrator):

```powershell
New-NetFirewallRule -DisplayName "llama-server 8080" `
  -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8080
```

If your WSL2 network interface is on the Public profile (unusual — usually Private), ensure the rule covers both.

### Step 4: Launch llama-server

In PowerShell, from the folder that contains `llama-server.exe`:

```powershell
cd C:\llama.cpp  # or the nested subfolder from Step 2
.\llama-server.exe `
  -hf unsloth/gemma-4-26B-A4B-it-GGUF:UD-Q5_K_S `
  --alias FileScopeMCP-brain `
  -c 32768 `
  -ngl 99 `
  --n-cpu-moe 99 `
  -fa on `
  -b 4096 -ub 4096 `
  --cache-type-k q8_0 --cache-type-v q8_0 `
  --jinja `
  --mmap --no-mmap-warmup `
  --host 0.0.0.0 --port 8080 `
  --metrics
```

Flag breakdown:

- `-ngl 99` — offload all layers to GPU
- `--n-cpu-moe 99` — claw routed expert FFNs back to CPU RAM, keeping only attention + shared expert on GPU (~2-3GB VRAM)
- `-fa on` — flash attention
- `--jinja` — enable the Gemma 4 chat template for `<|think|>` thinking-mode control
- `--cache-type-k q8_0 --cache-type-v q8_0` — KV cache in int8. **Do NOT use `q4_0` on gfx1030** — known segfault (Issue #15107).

**RAM requirement:** `--n-cpu-moe 99` streams routed experts from system RAM, so keep ~20GB of system RAM free beyond what Windows itself uses.

**First run:** The `-hf` flag downloads the GGUF (~18GB) into `$env:LLAMA_CACHE` or the default llama.cpp cache dir. Expect 5-10 minutes on a fast connection. llama-server does NOT accept HTTP traffic until the model is fully loaded.

### Step 5: Configure the broker in WSL

```bash
mkdir -p ~/.filescope
cp ~/FileScopeMCP/broker.windows-host.json ~/.filescope/broker.json
```

The `wsl-host` placeholder in `broker.windows-host.json` is auto-resolved by the broker at startup — `src/broker/config.ts` runs `ip route show default | awk '{print $3}'` to find the Windows host IP and rewrites `baseURL` in memory. No manual editing required in 99% of cases.

### Step 6: Verify from WSL

```bash
curl http://$(ip route show default | awk '{print $3}'):8080/v1/models
```

Expected: JSON with `data[].id` containing `FileScopeMCP-brain`.

### Step 7: Restart Claude Code

Start (or restart) a Claude Code session in your project. FileScopeMCP auto-spawns the broker, which connects to llama-server on Windows. Verify end-to-end with:

```bash
./setup-llm.sh --status
```

Or call `status()` from an MCP tool in Claude Code.

---

## Remote / LAN Server

llama-server runs on a different machine on your network.

**1. On the remote machine:** Launch llama-server with the full flag set from Step 4 above, ensuring `--host 0.0.0.0 --port 8080 --alias FileScopeMCP-brain` are present.

**2. In WSL / on the FileScopeMCP machine:**

```bash
mkdir -p ~/.filescope
cp ~/FileScopeMCP/broker.remote-lan.json ~/.filescope/broker.json
```

**3. Edit `~/.filescope/broker.json`** and replace `192.168.1.100` with the actual IP of the remote machine:

```json
{
  "llm": {
    "provider": "openai-compatible",
    "model": "FileScopeMCP-brain",
    "baseURL": "http://YOUR_SERVER_IP:8080/v1",
    "maxTokensPerCall": 1024
  },
  "jobTimeoutMs": 120000,
  "maxQueueSize": 1000
}
```

**4. Verify connectivity:**

```bash
curl http://<remote-ip>:8080/v1/models
```

**5. Restart Claude Code.**

---

## WSL + Windows Troubleshooting

If FileScopeMCP runs in WSL2 and llama-server runs on Windows, work through these checks in order.

### 1. Is llama-server running on Windows?

Check the PowerShell window it was launched in. If you closed that window, llama-server is gone — relaunch it with the command from Step 4.

### 2. Is llama-server listening on all interfaces?

In a Windows terminal:

```powershell
netstat -an | findstr 8080
```

You should see `0.0.0.0:8080`. If you see `127.0.0.1:8080`, you forgot `--host 0.0.0.0` on the launch command.

### 3. Can WSL reach the Windows host?

From WSL:

```bash
ip route show default | awk '{print $3}'
curl http://$(ip route show default | awk '{print $3}'):8080/v1/models
```

If `curl` hangs or returns "Connection refused":

- **Firewall:** The inbound rule from Step 3 may not be active. Re-run `New-NetFirewallRule` in an elevated PowerShell.
- **VPN/proxy:** Some VPN software changes WSL2 networking. Try disconnecting the VPN temporarily.

### 4. Is the broker config correct?

```bash
cat ~/.filescope/broker.json
```

`baseURL` should contain `wsl-host:8080` (auto-resolved at startup) or the literal Windows host IP on port 8080. If it points at a different port or still has `localhost`, re-copy the template:

```bash
cp ~/FileScopeMCP/broker.windows-host.json ~/.filescope/broker.json
```

### 5. Is the broker process running?

```bash
ps aux | grep broker | grep -v grep
cat ~/.filescope/broker.log
```

Common errors:

- `ECONNREFUSED` — llama-server isn't reachable (go back to checks 2-3).
- Stale socket file — remove it and let the broker respawn:
  ```bash
  rm ~/.filescope/broker.sock
  ```
  Then restart your Claude Code session.

### 6. Is `wsl-host` resolving correctly?

```bash
ip route show default
```

This should print one line whose third field is the Windows host gateway IP. If this fails (unusual), edit `~/.filescope/broker.json` and replace `wsl-host` with the literal IP.
