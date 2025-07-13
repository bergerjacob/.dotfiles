#!/bin/bash

MATCH_BY=$1
PATTERN=$2
SUMMON_MODE=$3

WINDOW_ID=""

if [ "$MATCH_BY" = "class" ]; then
    # Finds windows by class, but ONLY if their instance does NOT start with "crx_",
    # which excludes PWAs from this match.
    WINDOW_ID=$(i3-msg -t get_tree | jq -r \
        --arg pat "$PATTERN" \
        '.. | select(.window_properties?.class? and .window_properties?.instance? and
                      (.window_properties.class | test($pat; "i")) and
                      (.window_properties.instance | startswith("crx_") | not))
        | .id' | head -n 1)

elif [ "$MATCH_BY" = "instance" ]; then
    WINDOW_ID=$(i3-msg -t get_tree | jq -r --arg pat "$PATTERN" '.. | select(.window_properties?.instance? and (.window_properties.instance | test($pat; "i"))) | .id' | head -n 1)

elif [ "$MATCH_BY" = "title" ]; then
    WINDOW_ID=$(i3-msg -t get_tree | jq -r --arg pat "$PATTERN" '.. | select(.name? and (.name | test($pat; "i"))) | .id' | head -n 1)

elif [ "$MATCH_BY" = "mark" ]; then
    WINDOW_ID=$(i3-msg -t get_tree | jq -r --arg pat "$PATTERN" '.. | select(.marks? and (.marks | index($pat))) | .id' | head -n 1)
fi

# If a window was found, execute the appropriate i3 command sequence.
if [ -n "$WINDOW_ID" ]; then
    if [ "$SUMMON_MODE" = "tiled_right" ]; then
        i3-msg "[con_id=$WINDOW_ID]" floating disable, move to workspace current; \
               split h; \
               "[con_id=$WINDOW_ID]" focus
    elif [ "$SUMMON_MODE" = "floating" ]; then
        i3-msg "[con_id=$WINDOW_ID] move to workspace current; \
                [con_id=$WINDOW_ID] floating enable; \
                [con_id=$WINDOW_ID] resize set 1000 700; \
                [con_id=$WINDOW_ID] move position center; \
                [con_id=$WINDOW_ID] focus"
    fi
fi
