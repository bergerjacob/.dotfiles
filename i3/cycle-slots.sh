#!/bin/bash
#
# Rotates the contents of workspaces 13-17 forward or backward.
#
# Usage: cycle-slots.sh <forward|backward>

DIRECTION=$1
# NOTE: These must match the workspace numbers in your i3/config
SLOTS=(13 14 15 16 17)
TEMP_WS="99" # A temporary workspace for the swap.

# Function to move all windows from one workspace to another.
move_windows() {
    local from_ws=$1
    local to_ws=$2
    # Get all window IDs on the 'from' workspace in a comma-separated list
    local ids=$(i3-msg -t get_tree | jq -r --arg ws "$from_ws" '.. | objects | select(.type=="workspace" and .name==$ws) | .. | objects | select(.window and .type=="con") | .id' | tr '\n' ',' | sed 's/,$//')

    if [[ -n "$ids" ]]; then
        # Use a single command to move all windows at once for efficiency
        i3-msg "[con_id=$ids]" move to workspace number "$to_ws"
    fi
}

if [ "$DIRECTION" = "forward" ]; then
    # Move slot 5 (17) to temp
    move_windows ${SLOTS[4]} $TEMP_WS
    # Move slots 1-4 up
    for (( i=3; i>=0; i-- )); do
        move_windows ${SLOTS[$i]} ${SLOTS[$i+1]}
    done
    # Move temp to slot 1 (13)
    move_windows $TEMP_WS ${SLOTS[0]}

elif [ "$DIRECTION" = "backward" ]; then
    # Move slot 1 (13) to temp
    move_windows ${SLOTS[0]} $TEMP_WS
    # Move slots 2-5 down
    for (( i=1; i<=4; i++ )); do
        move_windows ${SLOTS[$i]} ${SLOTS[$i-1]}
    done
    # Move temp to slot 5 (17)
    move_windows $TEMP_WS ${SLOTS[4]}
fi

# Go back to the first slot for context.
i3-msg workspace number ${SLOTS[0]}
