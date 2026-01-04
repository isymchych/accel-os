#!/usr/bin/env bash

sleep 3

/usr/lib/polkit-gnome/polkit-gnome-authentication-agent-1 &
echo "started polkit-gnome"
