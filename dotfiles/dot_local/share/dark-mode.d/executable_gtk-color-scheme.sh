#!/usr/bin/env bash

gsettings set org.gnome.desktop.interface color-scheme prefer-dark
gsettings set org.gnome.desktop.interface gtk-theme Adwaita-dark

sed -i --follow-symlinks 's/gtk-application-prefer-dark-theme=.*/gtk-application-prefer-dark-theme=1/' ~/.config/gtk-3.0/settings.ini
