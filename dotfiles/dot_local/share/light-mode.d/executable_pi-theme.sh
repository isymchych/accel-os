#!/usr/bin/env bash

: "${ACCEL_OS:?ACCEL_OS must point at repo root}"
sed -i --follow-symlinks 's/"dark"/"light"/' "$ACCEL_OS/ai/pi/settings.json"