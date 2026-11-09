-- Presentation only: collection and idle inhibition belong to the service.
barWidget.setGlyph("robot")

local function present(state)
  if state == nil then
    barWidget.setVisible(false)
    return
  end
  if state.error ~= nil then
    barWidget.setText("?")
    barWidget.setColor("error")
    barWidget.setTooltip(state.error)
    barWidget.setVisible(true)
    return
  end
  barWidget.setText(string.format("%d/%d", state.working, state.waiting))
  barWidget.setColor(state.working > 0 and "primary" or "on_surface_variant")
  barWidget.setTooltip(string.format("%d working, %d waiting", state.working, state.waiting))
  barWidget.setVisible(state.working + state.waiting > 0)
end

noctalia.state.watch("pi-agents", present)
present(noctalia.state.get("pi-agents"))
