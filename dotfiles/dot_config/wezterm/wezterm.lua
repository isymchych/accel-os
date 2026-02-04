local wezterm = require 'wezterm'
local act = wezterm.action
local mux = wezterm.mux

local LIGHT_SCHEME = "Solarized (light) (terminal.sexy)"
local DARK_SCHEME = "Solarized Dark - Patched"

local function scheme_for(appearance)
  return appearance:find("Dark") and DARK_SCHEME or LIGHT_SCHEME
end

local open_with_chromium = false

local function chromium_action(action)
  return wezterm.action_callback(function(window, pane)
    open_with_chromium = true
    window:perform_action(action, pane)
    wezterm.time.call_after(0, function()
      open_with_chromium = false
    end)
  end)
end

wezterm.on('open-uri', function(_, _, uri)
  if not open_with_chromium then
    return
  end
  local ok, err = pcall(function()
    wezterm.open_with(uri, 'chromium')
  end)
  if not ok then
    wezterm.log_error(('failed to open %s via chromium: %s'):format(uri, err))
    return
  end
  return false
end)

local function spawn_window_in_cwd(window, pane)
  local cwd_uri = pane:get_current_working_dir()
  mux.spawn_window {
    workspace = window:active_workspace(),
    cwd = cwd_uri and cwd_uri.file_path or nil,
  }
end

wezterm.on('spawn-window-in-current-cwd', spawn_window_in_cwd)

local config = wezterm.config_builder and wezterm.config_builder() or {}

config.enable_wayland = true
config.font = wezterm.font("Iosevka Term Medium")
config.font_size = 16.0
config.color_scheme = wezterm.gui and scheme_for(wezterm.gui.get_appearance()) or LIGHT_SCHEME
config.hide_tab_bar_if_only_one_tab = true
config.scrollback_lines = 20000
config.skip_close_confirmation_for_processes_named = { "bash", "sh", "zsh", "fish" }
config.mouse_bindings = {
  {
    event = { Up = { streak = 1, button = "Right" } },
    mods = "NONE",
    action = chromium_action(act.OpenLinkAtMouseCursor),
  },
}
config.keys = {
  {
    key = "-",
    mods = "SUPER",
    action = act.DisableDefaultAssignment,
  },
  {
    key = "=",
    mods = "SUPER",
    action = act.DisableDefaultAssignment,
  },
  {
    key = "Enter",
    mods = "ALT",
    action = act.EmitEvent("spawn-window-in-current-cwd"),
  },
}
-- config.bold_brightens_ansi_colors = false -- solarized ls colors stay correct

return config
