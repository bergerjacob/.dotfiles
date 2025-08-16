#!/bin/bash
#
# Dismisses all summoned windows on the current workspace, sending them
# back to their original slots.

FOCUSED_WS=$(i3-msg -t get_workspaces | jq -r '.[] | select(.focused==true).name')

# Get all windows on the current workspace that have a "summoned_from_" mark.
mapfile -t WINDOW_NODES < <(i3-msg -t get_tree | \
    jq -c --arg ws "$FOCUSED_WS" '.. | objects | select(.type=="workspace" and .name==$ws) | .. | objects | select(.marks[]? | test("^summoned_from_"))')

if [ ${#WINDOW_NODES[@]} -eq 0 ]; then
    exit 0
fi

COMMAND=""
for node in "${WINDOW_NODES[@]}"; do
    id=$(echo "$node" | jq '.id')
    # Find the first mark that matches the pattern.
    mark=$(echo "$node" | jq -r '.marks[] | select(test("^summoned_from_"))')
    # Extract the destination workspace number from the mark.
    dest_ws=${mark#summoned_from_}

    if [[ -n "$dest_ws" ]]; then
        # Unmark, ensure it's tiled, and move it home.
        COMMAND+="[con_id=$id] unmark $mark, floating disable, move to workspace number $dest_ws; "
    fi
done

# Execute the command batch.
i3-msg "$COMMAND"
