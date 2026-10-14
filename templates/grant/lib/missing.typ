// The page `make full` puts where a required component is still missing.
#set page("us-letter")
#align(center + horizon, text(16pt, fill: red)[*Missing: #sys.inputs.name* \ #text(11pt, sys.inputs.at("from", default: ""))])
