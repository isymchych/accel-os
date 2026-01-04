#!/usr/bin/env bash

gsettings set org.gnome.desktop.interface color-scheme prefer-light
gsettings set org.gnome.desktop.interface gtk-theme Adwaita

sed -i --follow-symlinks 's/gtk-application-prefer-dark-theme=.*/gtk-application-prefer-dark-theme=0/' ~/.config/gtk-3.0/settings.ini
