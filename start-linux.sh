#!/bin/bash
# Vysper - Stealthy Linux-native AI Assistant
# Startup script with PipeWire exclusion flags for screen sharing stealth
#
# This script launches Vysper with Wayland/Ozone platform flags that
# enable proper PipeWire integration, ensuring the overlay window
# is excluded from screen sharing captures in Chrome, Zoom, etc.
#
# IMPORTANT: For screen capture to work on Wayland, you MUST use this script
# or launch with the --enable-features=UseOzonePlatform --ozone-platform=wayland flags.
# Without these flags, desktopCapturer will not be able to capture screenshots.
#
# Also ensure you have one of these screenshot tools installed:
#   - grim (recommended for Wayland/Sway)
#   - gnome-screenshot (GNOME)
#   - spectacle (KDE)
#   - scrot (X11)
#   - ImageMagick/import (fallback)

# Set NVIDIA API key (replace with your actual key or set in .env)
# export NVIDIA_API_KEY="nvapi-your-key-here"

# Load .env if it exists
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/.env" ]; then
    export $(grep -v '^#' "$SCRIPT_DIR/.env" | xargs)
fi

# Detect display server
if [ -n "$WAYLAND_DISPLAY" ]; then
    echo "[Vysper] Wayland detected - using Ozone platform for screen capture"
    PLATFORM_FLAGS="--enable-features=UseOzonePlatform --ozone-platform=wayland"
else
    echo "[Vysper] X11 detected - using default platform"
    PLATFORM_FLAGS=""
fi

# Launch Vysper with appropriate platform flags
# --no-sandbox: Required for Electron on some Linux setups
# PipeWire exclusion is handled by the window manager (type: 'dock')
exec npx electron . \
    $PLATFORM_FLAGS \
    --no-sandbox \
    "$@"
