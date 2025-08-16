#!/bin/bash
#
# Summons all windows from a target workspace (slot) to the current workspace.
#
# Usage: summon_slot.sh <workspace_number> <tiled|floating>

TARGET_WS=$1
SUMMON_MODE=$2

if [[ -z "$TARGET_WS" || -z "$SUMMON_MODE" ]]; then
    echo "Usage: $0 <workspace_number> <tiled|floating>"
    exit 1
fi

# Get all leaf window container IDs from the target workspace.
mapfile -t WINDOW_IDS < <(i3-msg -t get_tree | \
    jq -r --arg ws "$TARGET_WS" '.. | objects | select(.type=="workspace" and .name==$ws) | .. | objects | select(.window and .type=="con") | .id')

if [ ${#WINDOW_IDS[@]} -eq 0 ]; then
    exit 0
fi

# Prepare the i3-msg command string.
COMMAND=""
for id in "${WINDOW_IDS[@]}"; do
    # Mark the window with its origin, then move it.
    COMMAND+="[con_id=$id] mark --add summoned_from_${TARGET_WS}, move to workspace current; "
done

# If floating mode, add floating commands after all windows have been moved.
if [ "$SUMMON_MODE" = "floating" ]; then
    for id in "${WINDOW_IDS[@]}"; do
        COMMAND+="[con_id=$id] floating enable, resize set 80 ppt 80 ppt, move position center; "
    done
fi

# Execute the command batch.
i3-msg "$COMMAND"
