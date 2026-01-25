#!/usr/bin/env bash

pkill swayidle || true

# turn off screen in 120s
# lock screen in 2min 20s
# lock screen before sleep and on lock hint
swayidle -d -w \
    timeout 140 'mb-lock-screen' \
    timeout 120 'swaymsg "output * dpms off"' \
    resume 'swaymsg "output * dpms on"' \
    before-sleep 'mb-lock-screen' \
    lock 'mb-lock-screen'

echo "Started swayidle"
