#!/usr/bin/env bash

# take n most recently synchronize mirrors
# from these countries
# sort by download speed
sudo reflector \
     --protocol https \
     --latest 30 \
     --country Germany,Poland,Ukraine \
     --sort rate \
     --save /etc/pacman.d/mirrorlist
