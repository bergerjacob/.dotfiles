#!/bin/bash
# ~/.config/alacritty/start_tmux.sh

echo "Running startup.sh"

# Check if a tmux session exists.
# We redirect stderr to /dev/null to suppress "no server running on ..." messages if no session exists.
if tmux has-session 2>/dev/null; then
  # If a session exists, attach to it.
  # 'tmux attach' will connect to the last used session or the first available one.
  exec tmux attach
else
  # No session exists. Start a new tmux session.
  # If you have tmux-resurrect and/or tmux-continuum configured in your ~/.tmux.conf
  # to automatically restore sessions on server start, that behavior will kick in here.
  exec tmux
fi
