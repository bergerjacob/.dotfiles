#!/bin/bash
#
# Sends all "guest" windows on the current i3 workspace back to their designated
# home workspaces, leaving only the "native" application.

# --- CONFIGURATION ---
# Defines the home workspace for each application.
declare -A APP_HOMES=(
    ["class:Alacritty"]=""
    ["class:Chrome-main"]="󰖟"
    ["class:Chrome-orst"]="󰖟󰑴"
    ["class:Chrome-personal"]="󰖟"
    ["class:Spotify"]=""
    ["class:thunderbird-default"]="󰇮"
    ["instance:crx_cifhbcnohmdccbgoicgdjpfamggdegmo"]="󰊻"
    ["instance:crx_kjbdgfilnfhdoflbpgamdcdgpehopbep"]=""
    ["instance:crx_kajebgjangihfbkjfejcanhanjmmbcfd"]="󰟵"
    ["mark:discord_personal"]=""
    ["mark:discord_professional"]="󰑴"
    ["class:discord"]="" # Fallback for any unmarked Discord window
)

# --- SCRIPT LOGIC ---
FOCUSED_WS_NAME=$(i3-msg -t get_workspaces | jq -r '.[] | select(.focused==true).name')

# Get all window nodes on the current workspace as separate JSON objects.
mapfile -t window_nodes < <(i3-msg -t get_tree | jq -c \
    --arg ws "$FOCUSED_WS_NAME" \
    '.. | select(.type?=="workspace" and .name==$ws) |
    (.nodes[]?, .floating_nodes[]?) | .. | objects | select(.window_properties?)')

# Find the "native" application key for the current workspace.
NATIVE_ID_KEY=""
for key in "${!APP_HOMES[@]}"; do
    if [[ "${APP_HOMES[$key]}" == "$FOCUSED_WS_NAME" ]]; then
        NATIVE_ID_KEY=$key
        break
    fi
done

if [[ -z "$NATIVE_ID_KEY" ]]; then exit 0; fi
NATIVE_ID_TYPE="${NATIVE_ID_KEY%%:*}"
NATIVE_ID_PATTERN="${NATIVE_ID_KEY#*:}"

# Loop through each window on the workspace.
for node in "${window_nodes[@]}"; do
    # For each object, parse its properties individually for robustness.
    id=$(echo "$node" | jq '.id')
    w_instance=$(echo "$node" | jq -r '.window_properties.instance // ""')
    w_class=$(echo "$node" | jq -r '.window_properties.class // ""')
    w_marks=$(echo "$node" | jq -r '(.marks//[]) | join(",")')

    # Check if the window is native to this workspace.
    is_native=false
    if [[ "$NATIVE_ID_TYPE" == "class" && "$w_class" == "$NATIVE_ID_PATTERN" && ! "$w_instance" == crx_* ]]; then is_native=true
    elif [[ "$NATIVE_ID_TYPE" == "instance" && "$w_instance" == "$NATIVE_ID_PATTERN" ]]; then is_native=true
    elif [[ "$NATIVE_ID_TYPE" == "mark" && ",$w_marks," == *",$NATIVE_ID_PATTERN,"* ]]; then is_native=true
    fi

    if [[ "$is_native" == true ]]; then
        continue
    fi

    # If it's a guest, find its home using explicit, manual logic.
    guest_home=""
    if [[ ",$w_marks," == *",discord_professional,"* ]]; then
        guest_home=${APP_HOMES["mark:discord_professional"]}
    elif [[ ",$w_marks," == *",discord_personal,"* ]]; then
        guest_home=${APP_HOMES["mark:discord_personal"]}
    elif [[ -v APP_HOMES["instance:$w_instance"] ]]; then
        guest_home=${APP_HOMES["instance:$w_instance"]}
    elif [[ ! "$w_instance" == crx_* && -v APP_HOMES["class:$w_class"] ]]; then
        guest_home=${APP_HOMES["class:$w_class"]}
    elif [[ -v APP_HOMES["class:$w_class"] ]]; then # Fallback
        guest_home=${APP_HOMES["class:$w_class"]}
    fi

    # If a home was found, send the guest window there.
    if [[ -n "$guest_home" ]]; then
        # Set the guest to be tiled *before* moving it home.
        i3-msg "[con_id=$id]" floating disable, move to workspace "$guest_home" > /dev/null
    fi
done

i3-msg '[workspace="__focused__"]' floating disable >> "/home/bergerj/debug.log"
i3-msg "layout default" >> "/home/bergerj/debug.log"
