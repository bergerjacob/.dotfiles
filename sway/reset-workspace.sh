#!/bin/bash
#
# Sends all "guest" windows on the current sway workspace back to their designated
# home workspaces, leaving only the "native" application.

# --- CONFIGURATION ---
# Defines the home workspace for each application.
# Windows are identified by app_id (Wayland) with fallback to class/instance (XWayland).
declare -A APP_HOMES=(
    ["app_id:Alacritty"]="1:"
    ["app_id:Chrome-main"]="2:"
    ["app_id:Chrome-orst"]="3:󰑴"
    ["app_id:Chrome-personal"]="10:"
    ["app_id:chrome-cimiifkhcfbmjjijkgcgcdaokkgdlime-Default"]="7:󰇮"
    # Chrome PWAs (app_id = "chrome-<EXTENSION_ID>-Default")
    ["app_id:chrome-cifhbcnohmdccbgoicgdjpfamggdegmo-Default"]="6:󰊻"
    ["app_id:chrome-kjbdgfilnfhdoflbpgamdcdgpehopbep-Default"]="8:"
    ["app_id:chrome-kajebgjangihfbkjfejcanhanjmmbcfd-Default"]="9:󰟵"
    ["app_id:chrome-cinhimbnkkaeohfgghhklpknlkffjgod-Default"]="11:"
    ["mark:discord_personal"]="4:"
    ["mark:discord_professional"]="5:󰙯"
    ["app_id:discord"]="4:" # Fallback for any unmarked Discord window
)

# --- SCRIPT LOGIC ---
FOCUSED_WS_NAME=$(swaymsg -t get_workspaces | jq -r '.[] | select(.focused==true).name')

# Get all window nodes on the current workspace as separate JSON objects.
mapfile -t window_nodes < <(swaymsg -t get_tree | jq -c \
    --arg ws "$FOCUSED_WS_NAME" \
    '.. | select(.type?=="workspace" and .name==$ws) |
    (.nodes[]?, .floating_nodes[]?) | .. | objects | select(.window_properties? or .app_id?)')

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
    id=$(echo "$node" | jq '.id')
    w_app_id=$(echo "$node" | jq -r '.app_id // ""')
    w_class=$(echo "$node" | jq -r '.window_properties.class // ""')
    w_instance=$(echo "$node" | jq -r '.window_properties.instance // ""')
    w_marks=$(echo "$node" | jq -r '(.marks//[]) | join(",")')

    # Build hash keys for lookup
    w_id_keys=()
    [[ -n "$w_app_id" ]] && w_id_keys+=("app_id:$w_app_id")
    [[ -n "$w_class" ]] && w_id_keys+=("class:$w_class")
    [[ -n "$w_instance" ]] && w_id_keys+=("instance:$w_instance")

    # Check if the window is native to this workspace.
    is_native=false
    for id_key in "${w_id_keys[@]}"; do
        if [[ "$id_key" == "$NATIVE_ID_KEY" ]]; then
            is_native=true
            break
        fi
    done
    # mark-based native check
    if [[ "$NATIVE_ID_TYPE" == "mark" ]]; then
        if [[ ",$w_marks," == *",${NATIVE_ID_PATTERN},"* ]]; then
            is_native=true
        fi
    fi

    if [[ "$is_native" == true ]]; then
        continue
    fi

    # If it's a guest, find its home.
    guest_home=""
    # Discord marks take priority
    if [[ ",$w_marks," == *",discord_professional,"* ]]; then
        guest_home=${APP_HOMES["mark:discord_professional"]}
    elif [[ ",$w_marks," == *",discord_personal,"* ]]; then
        guest_home=${APP_HOMES["mark:discord_personal"]}
    else
        # Check all id keys against APP_HOMES
        for id_key in "${w_id_keys[@]}"; do
            if [[ -v APP_HOMES["$id_key"] ]]; then
                guest_home=${APP_HOMES["$id_key"]}
                break
            fi
        done
    fi

    # If a home was found, send the guest window there.
    if [[ -n "$guest_home" ]]; then
        swaymsg "[con_id=$id]" floating disable, move to workspace "$guest_home" > /dev/null
    fi
done

swaymsg '[workspace="__focused__"]' floating disable
swaymsg "layout default"
