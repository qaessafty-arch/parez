# Parez — one-command deployment to an Oracle Cloud Always Free VM.
#
# Run from your Windows machine once you have the server's public IP:
#
#   .\deploy-to-oracle.ps1
#
# It asks for the IP, then does everything: prepares the server, copies
# Parez across, deploys it as a service, and starts a public HTTPS tunnel.
# You get a URL at the end that works on any phone.

$ErrorActionPreference = 'Stop'

$RepoUrl  = 'https://github.com/qaessafty-arch/parez.git'
$Remote   = 'ubuntu'
$Port     = '4177'

Write-Host ''
Write-Host '  PAREZ -> Oracle Cloud Always Free' -ForegroundColor Cyan
Write-Host '  ---------------------------------' -ForegroundColor DarkGray
Write-Host ''

$ip = Read-Host '  Public IP of your Oracle VM'
if (-not $ip) { Write-Host '  No IP given. Nothing was changed.' -ForegroundColor Red; exit 1 }

$sshKey = Join-Path $HOME '.ssh'
if (-not (Test-Path $sshKey)) { New-Item -ItemType Directory -Path $sshKey | Out-Null }

Write-Host ''
Write-Host '  [1/4] Preparing the server (Node, firewall, swap)...' -ForegroundColor Yellow
Write-Host '        First run downloads packages and takes a few minutes.' -ForegroundColor DarkGray
ssh -o StrictHostKeyChecking=accept-new "$Remote@$ip" \
  'curl -fsSL https://raw.githubusercontent.com/qaessafty-arch/parez/master/deploy/host-setup.sh | bash'
if ($LASTEXITCODE -ne 0) { Write-Host '  Server preparation failed.' -ForegroundColor Red; exit 1 }

Write-Host ''
Write-Host '  [2/4] Copying Parez across...' -ForegroundColor Yellow

# Locate the Parez folder: this script lives inside its deploy/ directory,
# so the source is always one level up from here. No hardcoded path that
# breaks when the project moves.
$source = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $source 'package.json'))) {
  Write-Host "  Could not find the Parez folder at: $source" -ForegroundColor Red
  Write-Host '  Run this script from inside the parez project.' -ForegroundColor Red
  exit 1
}

scp -r $source "$Remote@$ip`:~/parez-deploy"
if ($LASTEXITCODE -ne 0) {
  Write-Host '  Copy failed. Check your SSH key and network.' -ForegroundColor Red
  exit 1
}

Write-Host ''
Write-Host '  [3/4] Deploying Parez as a service...' -ForegroundColor Yellow
ssh "$Remote@$ip" 'bash ~/parez-deploy/deploy/deploy.sh'
if ($LASTEXITCODE -ne 0) { Write-Host '  Deployment failed.' -ForegroundColor Red; exit 1 }

Write-Host ''
Write-Host '  [4/4] Starting the public HTTPS tunnel...' -ForegroundColor Yellow
ssh -f -n "$Remote@$ip" \
  'pkill -f "cloudflared tunnel" 2>/dev/null; sleep 1; nohup cloudflared tunnel --url http://127.0.0.1:' + $Port + ' --no-autoupdate > /tmp/tunnel.log 2>&1 & sleep 15; grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" /tmp/tunnel.log | head -1'

$url = (ssh "$Remote@$ip" 'grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" /tmp/tunnel.log | head -1')

if ($url) {
  Write-Host ''
  Write-Host '  ============================================================' -ForegroundColor Green
  Write-Host '   Parez is live.' -ForegroundColor Green
  Write-Host ''
  Write-Host "   $url" -ForegroundColor White
  Write-Host ''
  Write-Host '   Open that on a phone. First screen creates your admin account.' -ForegroundColor Gray
  Write-Host '  ============================================================' -ForegroundColor Green
  Write-Host ''
  Write-Host '  Keep this tunnel running, or make it survive a reboot:' -ForegroundColor DarkGray
  Write-Host "    ssh $Remote@$ip" -ForegroundColor DarkGray
  Write-Host '    sudo tee /etc/systemd/system/parez-tunnel.service' -ForegroundColor DarkGray
  Write-Host '    (see DEPLOY.md, section "Making the URL permanent")' -ForegroundColor DarkGray
} else {
  Write-Host '  The tunnel did not print a URL. Run this to see why:' -ForegroundColor Red
  Write-Host "    ssh $Remote@$ip 'cat /tmp/tunnel.log'" -ForegroundColor Red
  Write-Host ''
  Write-Host '  Parez itself is running on http://$ip:$Port though.' -ForegroundColor Yellow
}