-- Shared fake APIs for service-backed widgets; each fixture gets fresh state.
local shared, watchers = {}, {}
local state = {
  get = function(key) return shared[key] end,
  set = function(key, value)
    shared[key] = value
    for _, callback in ipairs(watchers[key] or {}) do callback(value) end
  end,
  watch = function(key, callback)
    watchers[key] = watchers[key] or {}
    table.insert(watchers[key], callback)
  end,
}

local function makeWidget(vertical)
  local current = {}
  return current, {
    isVertical = function() return vertical == true end,
    setGlyph = function(value) current.glyph = value end,
    setText = function(value) current.text = value end,
    setColor = function(value) current.color = value end,
    setGlyphColor = function(value) current.glyphColor = value end,
    setTooltip = function(value) current.tooltip = value end,
    setVisible = function(value) current.visible = value end,
  }
end
