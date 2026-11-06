views["/image"] = {
  description = "image/png · 100 bytes", imagePath = "/image/clipboard.png",
  truncated = false, actions = { { id = "annotate", label = "Annotate" } },
}
onOpen("/image")
local image = find(tree, function(node) return node.kind == "image" end)
assert(image and image.props.path == "/image/clipboard.png" and image.props.fit == "contain")
button("Annotate")()
assert(launches[1][2] == "run" and launches[1][3] == "/image" and launches[1][4] == "annotate")
