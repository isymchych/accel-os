local views, launches, notices = {}, {}, {}
local tree, closed, failLaunch = nil, 0, false
ui = setmetatable({}, {
  __index = function(_, kind)
    return function(props, children)
      return { kind = kind, props = props or {}, children = children or {} }
    end
  end,
})
panel = {
  render = function(value) tree = value end,
  close = function() closed = closed + 1; onClose() end,
}
noctalia = {
  notify = function(_, message) table.insert(notices, message) end,
  readFile = function(file) return string.match(file, "^(.*)/snapshot.json$") end,
  json = { decode = function(raw) return views[raw] end },
  runAsync = function(argv)
    if failLaunch then return false end
    table.insert(launches, argv)
    return true
  end,
}
local function find(node, predicate)
  if predicate(node) then return node end
  for _, child in ipairs(node.children) do
    local match = find(child, predicate)
    if match then return match end
  end
end
local function button(text)
  local node = find(tree, function(node)
    return node.kind == "button" and node.props.text == text
  end)
  assert(node, "Missing button: " .. text)
  return node.props.onClick
end
local function textView(text, truncated)
  return {
    description = "text/plain · 12 bytes", text = text, truncated = truncated,
    actions = { { id = "edit", label = "Open in editor" }, { id = "save", label = "Save as…" } },
  }
end
