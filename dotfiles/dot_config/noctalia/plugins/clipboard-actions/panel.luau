--!nolint FunctionUnused
-- Lifecycle functions are invoked by Noctalia, not by this chunk.
-- Presentation only: the helper owns matching and execution. Closing releases
-- the snapshot; a successfully launched action takes ownership until it finishes.
local snapshot = nil

local function notify(message)
  noctalia.notify("Clipboard actions", message)
end

local function release()
  local previous = snapshot
  snapshot = nil
  if previous ~= nil then
    if not noctalia.runAsync({ "mb-clipboard-actions", "discard", previous.directory }) then
      notify("Could not discard the clipboard snapshot.")
    end
  end
end

local function activate(expected, id)
  if snapshot ~= expected then
    return
  end
  if not noctalia.runAsync({ "mb-clipboard-actions", "run", expected.directory, id }) then
    notify("Could not start the clipboard action.")
    return
  end
  -- onClose must not delete files the action process is about to read.
  snapshot = nil
  panel.close()
end

local function render(current)
  local data = current.data
  local preview
  if data.imagePath ~= nil then
    preview = ui.image({ path = data.imagePath, width = 460, height = 240, fit = "contain" })
  else
    -- Plain labels deliberately do not interpret clipboard text as Markdown.
    preview = ui.label({ text = data.text, maxWidth = 460, maxLines = 4096, fontSize = 13 })
  end

  local buttons = {}
  for _, action in ipairs(data.actions) do
    table.insert(buttons, ui.button({
      key = action.id,
      text = action.label,
      contentAlign = "start",
      onClick = function() activate(current, action.id) end,
    }))
  end

  local children = {
    ui.row({ gap = 8, align = "center" }, {
      ui.glyph({ name = "clipboard-text", size = 22, color = "primary" }),
      ui.label({ text = "Clipboard actions", fontSize = 18, fontWeight = "bold" }),
    }),
    ui.label({ text = data.description, fontSize = 12, maxLines = 2 }),
    ui.scroll({
      flexGrow = 1,
      minHeight = 80,
      padding = 12,
      radius = 8,
      border = "primary",
      borderWidth = 1,
    }, { preview }),
  }
  if data.truncated then
    table.insert(children, ui.label({
      text = "Preview shortened; actions use the full item.",
      fontSize = 12,
      maxLines = 2,
    }))
  end
  table.insert(children, ui.column({ gap = 6 }, buttons))
  table.insert(children, ui.button({
    text = "Cancel",
    variant = "ghost",
    onClick = function() panel.close() end,
  }))
  panel.render(ui.column({ gap = 12, flexGrow = 1 }, children))
end

function onOpen(context)
  -- panel-open can refresh this panel without an intervening onClose.
  release()
  local raw, err = noctalia.readFile(context .. "/snapshot.json")
  local data = raw and noctalia.json.decode(raw)
  if type(data) ~= "table" or type(data.actions) ~= "table"
      or type(data.description) ~= "string"
      or (type(data.text) ~= "string" and type(data.imagePath) ~= "string") then
    noctalia.runAsync({ "mb-clipboard-actions", "discard", context })
    notify(err or "Could not read the clipboard snapshot.")
    panel.close()
    return
  end
  snapshot = { directory = context, data = data }
  render(snapshot)
end

function onClose()
  release()
end

function onExit()
  -- Detached cleanup also survives the runtime being reloaded or disabled.
  release()
end
