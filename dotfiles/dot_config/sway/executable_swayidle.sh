#!/usr/bin/env bash

pkill swayidle || true

# turn off screen in 100s
# lock screen in 2min
# lock screen before sleep and on lock hint
swayidle -d -w \
    timeout 120 'mb-lock-screen' \
    timeout 100 'swaymsg "output * dpms off"' \
    resume 'swaymsg "output * dpms on"' \
    before-sleep 'mb-lock-screen' \
    lock 'mb-lock-screen'

echo "Started swayidle"
