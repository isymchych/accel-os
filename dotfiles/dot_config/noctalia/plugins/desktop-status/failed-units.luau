local poll = require("./poll.luau")

barWidget.clearTooltip()

local function countUnits(output)
  local count = 0
  for line in string.gmatch(output, "[^\n]+") do
    if string.find(line, "%S") then
      count = count + 1
    end
  end
  return count
end

local system = poll.command({ "systemctl", "--failed", "--no-legend", "--plain", "--no-pager" }, countUnits)
local user = poll.command({ "systemctl", "--user", "--failed", "--no-legend", "--plain", "--no-pager" }, countUnits)

local function query(done)
  system(function(systemCount, err)
    if systemCount == nil then
      done(nil, err)
      return
    end
    user(function(userCount, userErr)
      if userCount == nil then
        done(nil, userErr)
        return
      end
      done(systemCount + userCount)
    end)
  end)
end

local refresh = poll.create(query, 10000, function(count)
  barWidget.setText(tostring(count))
  barWidget.setVisible(count > 0)
  return true
end)

function update()
  refresh()
end

update()
