#!/usr/bin/env bash
# SpecForge installer.
#
#   ./install.sh                       # install the plugin only
#   ./install.sh spec.example.com      # ...and set up a permanent share URL
#   ./install.sh spec.example.com -n   # show what would happen, change nothing
#
# Safe to re-run: every step checks before it acts, so a second run on a working
# machine changes nothing.
#
# Deliberately does not install anything with sudo. Missing prerequisites are
# reported with the command to install them, because a script that silently
# takes root on someone's machine is not a good first impression of a tool.

set -euo pipefail

HOSTNAME_ARG=""
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    -n|--dry-run) DRY_RUN=1 ;;
    -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "unknown option: $arg" >&2; exit 2 ;;
    *) HOSTNAME_ARG="$arg" ;;
  esac
done

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
step()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()    { printf '  ok    %s\n' "$*"; }
info()  { printf '        %s\n' "$*"; }
die()   { printf '\n  \033[31mstopped\033[0m %s\n\n' "$*" >&2; exit 1; }
run()   { if [ "$DRY_RUN" = 1 ]; then printf '  would  %s\n' "$*"; else "$@"; fi; }

# --- prerequisites -----------------------------------------------------------
# Checked all at once rather than one at a time, so someone on a bare machine
# learns everything they need in a single run instead of three.

step "Checking prerequisites"
MISSING=""

if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
  if [ "$NODE_MAJOR" -ge 18 ]; then
    ok "node $(node -v)"
  else
    MISSING="$MISSING\n  node is $(node -v); SpecForge needs 18 or newer: https://nodejs.org"
  fi
else
  MISSING="$MISSING\n  node is not installed: https://nodejs.org"
fi

if command -v claude >/dev/null 2>&1; then
  ok "claude code"
else
  MISSING="$MISSING\n  claude code is not installed: https://claude.com/claude-code"
fi

# cloudflared is only needed to share. Installing it takes root, so this reports
# the command rather than running it.
if command -v cloudflared >/dev/null 2>&1; then
  ok "cloudflared"
elif [ -n "$HOSTNAME_ARG" ]; then
  case "$(uname -s)" in
    Darwin) CF_HINT="brew install cloudflared" ;;
    *)      CF_HINT="see https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/" ;;
  esac
  MISSING="$MISSING\n  cloudflared is needed to share a spec: $CF_HINT"
else
  info "cloudflared not found; you will need it to share a spec"
fi

if [ -n "$MISSING" ]; then
  printf '\n  \033[31mmissing:\033[0m%b\n\nInstall those, then run this again.\n\n' "$MISSING" >&2
  exit 1
fi

# --- the plugin --------------------------------------------------------------

step "Installing the plugin"
if claude plugin list 2>/dev/null | grep -q 'specforge'; then
  ok "already installed; updating"
  run claude plugin marketplace update specforge
  run claude plugin uninstall specforge@specforge
  run claude plugin install specforge@specforge
else
  # `marketplace add` fails if it is already there, which is not an error here.
  run claude plugin marketplace add "$HERE" || true
  run claude plugin install specforge@specforge
  ok "installed"
fi
info "run /reload-plugins in Claude Code, or restart it"

# --- sharing (optional) ------------------------------------------------------

if [ -z "$HOSTNAME_ARG" ]; then
  step "Done"
  info "Sharing will use a temporary address that changes on every reboot."
  info "For a permanent one, re-run with a hostname you control:"
  info "  ./install.sh spec.example.com"
  printf '\n'
  exit 0
fi

step "Setting up $HOSTNAME_ARG"
info "a browser will open once, to authorise the domain with Cloudflare"
run node "$HERE/lib/specforge-cli.mjs" setup-tunnel "$HOSTNAME_ARG"

CONFIG="$HOME/.cloudflared/config.yml"
step "One step left, and it needs root"
printf '  sudo cloudflared --config %s service install\n' "$CONFIG"
info "that is what keeps the tunnel running across a reboot"
printf '\nThen your specs publish at https://%s/s/<code>\n\n' "$HOSTNAME_ARG"
