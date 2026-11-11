#!/usr/bin/env bash
# Installs what the release built on Linux or macOS and checks that it works.
# release.yml runs it after the build:
#
#   scripts/smoke/unix.sh <bundle folder> <version> <target triple>
set -euo pipefail

bundles=$(cd "$1" && pwd)
version=$2
target=$3
temp=${RUNNER_TEMP:-$(mktemp -d)}

# The MCP server answers with this version.
check_mcp() {
  local said
  said=$("$1" --version)
  if [ "$said" != "ultimatemd-mcp $version" ]; then
    echo "$1 says '$said', not $version" >&2
    exit 1
  fi
  echo "ok: $1 $version"
}

case "$(uname)" in
Linux)
  deb=$(ls "$bundles"/deb/*.deb | head -1)
  sudo apt-get install -y "$deb"
  test -x /usr/bin/ultimatemd
  check_mcp /usr/bin/ultimatemd-mcp

  image=$(ls "$bundles"/appimage/*.AppImage | head -1)
  chmod +x "$image"
  (cd "$temp" && "$image" --appimage-extract >/dev/null)
  check_mcp "$temp/squashfs-root/usr/bin/ultimatemd-mcp"

  # The installed app opens a window, on a virtual screen, and logs its start.
  export ULTIMATEMD_CONFIG_DIR="$temp/umd-config"
  xvfb-run -a timeout 20 /usr/bin/ultimatemd || [ $? -eq 124 ]
  log="$ULTIMATEMD_CONFIG_DIR/ultimatemd.log"
  cat "$log"
  grep -q "UltimateMD $version" "$log"
  if grep -q panic "$log"; then exit 1; fi
  echo "ok: the app starts"
  ;;
Darwin)
  dmg=$(ls "$bundles"/dmg/*.dmg | head -1)
  mount="$temp/umd-dmg"
  hdiutil attach -nobrowse -readonly -mountpoint "$mount" "$dmg" >/dev/null
  trap 'hdiutil detach "$mount" >/dev/null || true' EXIT
  bin="$mount/UltimateMD.app/Contents/MacOS"
  ls "$bin"
  arch=${target%%-*}
  [ "$arch" = aarch64 ] && arch=arm64
  lipo -archs "$bin/ultimatemd-mcp" | grep -qw "$arch"
  # Only the runner's own architecture can run here.
  if [ "$arch" = "$(uname -m)" ]; then check_mcp "$bin/ultimatemd-mcp"; else echo "ok: $arch binaries"; fi
  ;;
esac
