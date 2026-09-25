#!/usr/bin/env bash
# Register this machine as a GitHub Actions runner for Sankhyas, so the daily data job
# runs from an Indian IP address (NSE and BSE block GitHub's own servers).
#
# Works on Ubuntu 22.04 / 24.04 (a cloud VM in Mumbai/Hyderabad, or WSL on a Windows PC).
# Run as a normal user with sudo rights, not as root:
#
#   bash setup-india-runner.sh <REGISTRATION_TOKEN>
#
# Get the token from: GitHub repo -> Settings -> Actions -> Runners -> New self-hosted runner
# (it is shown in the "Configure" step and is valid for one hour).
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/purshottammenariya10-debug/Sankhyas}"
TOKEN="${1:-}"
RUNNER_DIR="${RUNNER_DIR:-$HOME/actions-runner}"
NAME="${RUNNER_NAME:-sankhyas-india-$(hostname)}"

if [ -z "$TOKEN" ]; then
  echo "Usage: bash $0 <REGISTRATION_TOKEN>" >&2
  echo "Get the token from $REPO_URL/settings/actions/runners/new" >&2
  exit 1
fi
if [ "$(id -u)" -eq 0 ]; then
  echo "Please run as a normal user with sudo rights, not as root." >&2
  exit 1
fi

echo "==> Installing system packages"
sudo apt-get update -qq
sudo apt-get install -y -qq curl tar git jq python3 python3-venv python3-pip zstd >/dev/null

echo "==> Checking that NSE and BSE answer from this machine"
for u in https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv "https://api.bseindia.com/BseIndiaAPI/api/ListofScripData/w?Group=&Scripcode=&industry=&segment=Equity&status=Active"; do
  code=$(curl -s -o /dev/null -w "%{http_code}" -m 20 -A "Mozilla/5.0" -H "Referer: https://www.bseindia.com/" "$u" || true)
  echo "    $code  $u"
done
echo "    (200 means reachable; 403 means this network is blocked too)"

echo "==> Downloading the GitHub Actions runner"
ARCH=$(uname -m); case "$ARCH" in x86_64) ARCH=x64;; aarch64|arm64) ARCH=arm64;; *) echo "Unsupported CPU: $ARCH" >&2; exit 1;; esac
VERSION=$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest | jq -r .tag_name | sed 's/^v//')
mkdir -p "$RUNNER_DIR" && cd "$RUNNER_DIR"
curl -fsSL -o runner.tar.gz "https://github.com/actions/runner/releases/download/v${VERSION}/actions-runner-linux-${ARCH}-${VERSION}.tar.gz"
tar xzf runner.tar.gz && rm runner.tar.gz
sudo ./bin/installdependencies.sh >/dev/null

echo "==> Registering runner '$NAME'"
./config.sh --unattended --replace --url "$REPO_URL" --token "$TOKEN" --name "$NAME" --labels india --work _work

echo "==> Installing as a service (starts automatically after reboot)"
sudo ./svc.sh install "$USER"
sudo ./svc.sh start

cat <<MSG

Done. The runner '$NAME' is online.

Last step: in GitHub open $REPO_URL/settings/variables/actions
and add a repository variable:  DATA_RUNNER = self-hosted
Then run Actions -> "Update data and deploy" -> Run workflow.
MSG
