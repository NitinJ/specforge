#!/usr/bin/env bash
# SpecForge installer. Sets up everything: the plugin, a tunnel, and a permanent
# address for your specs.
#
#   ./install.sh                     # everything, asking you nothing
#   ./install.sh docs.example.com    # ...but pick the address yourself
#   ./install.sh -n                  # show what would happen, change nothing
#   ./install.sh --plugin-only       # skip the sharing setup
#   ./install.sh --harness codex --plugin-only
#   ./install.sh --harness codex --remove
#
# The address defaults to <your-username>.<the domain you authorise>, so a
# teammate needs to know nothing beyond which domain to click in the browser.
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
PLUGIN_ONLY=0
HARNESS="claude"
INSTALL_ROOT=""
REMOVE=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    -n|--dry-run) DRY_RUN=1; shift ;;
    --plugin-only) PLUGIN_ONLY=1; shift ;;
    --remove) REMOVE=1; shift ;;
    --harness)
      [ "$#" -ge 2 ] || { echo "--harness requires claude or codex" >&2; exit 2; }
      HARNESS="$2"
      shift 2
      ;;
    --install-root)
      [ "$#" -ge 2 ] || { echo "--install-root requires a path" >&2; exit 2; }
      INSTALL_ROOT="$2"
      shift 2
      ;;
    -h|--help) sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "unknown option: $1" >&2; exit 2 ;;
    *)
      # Taking the last of several would configure Cloudflare for a hostname the
      # person did not mean, and they would find out from a link that 404s.
      if [ -n "$HOSTNAME_ARG" ]; then
        echo "only one hostname, got '$HOSTNAME_ARG' and '$1'" >&2
        exit 2
      fi
      HOSTNAME_ARG="$1"
      shift
      ;;
  esac
done

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -z "$INSTALL_ROOT" ]; then
  INSTALL_ROOT="$HOME/.specforge/codex-marketplace"
fi
case "$HARNESS" in
  claude|codex) ;;
  *) echo "unsupported harness: $HARNESS (expected claude or codex)" >&2; exit 2 ;;
esac
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

if command -v "$HARNESS" >/dev/null 2>&1; then
  ok "$HARNESS"
else
  if [ "$HARNESS" = "codex" ]; then
    MISSING="$MISSING\n  codex is not installed: https://developers.openai.com/codex"
  else
    MISSING="$MISSING\n  claude code is not installed: https://claude.com/claude-code"
  fi
fi

# cloudflared is only needed to share. Installing it takes root, so this reports
# the command rather than running it.
if command -v cloudflared >/dev/null 2>&1; then
  ok "cloudflared"
elif [ "$PLUGIN_ONLY" = 1 ] || [ "$REMOVE" = 1 ]; then
  info "cloudflared not found; you will need it to share a spec"
else
  case "$(uname -s)" in
    Darwin) CF_HINT="brew install cloudflared" ;;
    *)      CF_HINT="see https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/" ;;
  esac
  MISSING="$MISSING\n  cloudflared is needed to share a spec: $CF_HINT"
  MISSING="$MISSING\n    (or run with --plugin-only to skip sharing setup)"
fi

if [ -n "$MISSING" ]; then
  printf '\n  \033[31mmissing:\033[0m%b\n\nInstall those, then run this again.\n\n' "$MISSING" >&2
  exit 1
fi

# --- the plugin --------------------------------------------------------------

step "Installing the plugin"
if [ "$HARNESS" = "codex" ]; then
  if [ "$REMOVE" = 1 ]; then
    step "Removing the Codex plugin"
    run codex plugin remove specforge@specforge || true
    run codex plugin marketplace remove specforge || true
    run node "$HERE/scripts/remove-codex-marketplace.mjs" "$INSTALL_ROOT"
    info "Your specs remain in ~/.specforge. Claude and Pi installations are unchanged."
    exit 0
  fi

  run node "$HERE/scripts/build-codex-marketplace.mjs" "$HERE" "$INSTALL_ROOT"
  run codex plugin marketplace add "$INSTALL_ROOT" || true
  if ! run codex plugin add specforge@specforge; then
    node "$HERE/scripts/restore-codex-marketplace.mjs" "$INSTALL_ROOT"
    die "Codex rejected the update; restored the previous validated marketplace."
  fi
  ok "installed for Codex"
  info "Review and trust the SpecForge hooks when Codex prompts you."
  info "Start a new Codex thread after install or update."
elif [ "$REMOVE" = 1 ]; then
  run claude plugin uninstall specforge@specforge || true
  ok "removed from Claude Code; your specs remain in ~/.specforge"
  exit 0
# `grep -q` exits at the first match and closes the pipe, which under `pipefail`
# can surface as a SIGPIPE failure from the command feeding it and send an
# installed plugin down the fresh-install path. Reading the whole stream costs
# nothing here and has no such race.
elif claude plugin list 2>/dev/null | grep 'specforge' >/dev/null; then
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
if [ "$HARNESS" = "claude" ]; then
  info "run /reload-plugins in Claude Code, or restart it"
fi

# --- sharing (optional) ------------------------------------------------------

if [ "$PLUGIN_ONLY" = 1 ]; then
  step "Done"
  info "Sharing will use a temporary address that changes on every reboot."
  info "For a permanent one, re-run without --plugin-only."
  printf '\n'
  exit 0
fi

if [ -n "$HOSTNAME_ARG" ]; then
  step "Setting up $HOSTNAME_ARG"
else
  step "Setting up your address"
  info "it will be <your-username>.<the domain you pick>, so there is nothing to choose"
fi
info "a browser will open once, to authorise a domain with Cloudflare"
run node "$HERE/lib/specforge-cli.mjs" setup-tunnel $HOSTNAME_ARG

CONFIG="$HOME/.cloudflared/config.yml"
step "One step left, and it needs root"
printf '  sudo cloudflared --config %s service install\n' "$CONFIG"
info "that is what keeps the tunnel running across a reboot"
if [ "$HARNESS" = "codex" ]; then
  printf '\nThen start a new Codex thread and share a spec. The address is printed above.\n\n'
else
  printf '\nThen restart Claude Code and share a spec. The address is printed above.\n\n'
fi
