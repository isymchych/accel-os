-- Presentation only. Acknowledgment is shared across bars; a new generation
-- re-arms every widget, including when one failed unit replaces another.
local status = noctalia.state.get("failed-units")
local bright = true
barWidget.setGlyph("alert-triangle")

local function present()
  if status == nil then
    barWidget.setVisible(false)
    return
  end
  local color = "error"
  if status.error == nil and #status.units > 0
    and noctalia.state.get("failed-units-ack") ~= status.generation and not bright then
    color = "error_container"
  end
  barWidget.setGlyphColor(color, "script")
  barWidget.setTooltip(status.error or table.concat(status.units, "\n"))
  barWidget.setVisible(status.error ~= nil or #status.units > 0)
end

function update()
  bright = not bright
  present()
end

function onClick()
  if status ~= nil then
    noctalia.state.set("failed-units-ack", status.generation)
  end
  if not noctalia.runAsync({
    "xterm", "run", "--class=systemd-manager", "--",
    "systemctl-tui", "--scope", "all", "--no-log", "--limit-units", "*",
  }) then
    noctalia.notifyError("Could not open systemd manager")
  end
end

noctalia.state.watch("failed-units", function(value)
  if status == nil or value.generation ~= status.generation then
    bright = true
  end
  status = value
  present()
end)
noctalia.state.watch("failed-units-ack", present)
noctalia.setUpdateInterval(750)
present()
