local poll = require("./poll.luau")

local refresh = poll.create(poll.command({ "swaymsg", "-r", "-t", "get_binding_state" }), 1000, function(state)
  if type(state) ~= "table" or type(state.name) ~= "string" then
    return false
  end
  barWidget.setText(state.name)
  barWidget.setVisible(state.name ~= "default")
  return true
end)

function update()
  refresh()
end

update()
