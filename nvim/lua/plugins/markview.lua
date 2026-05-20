return {
	"OXY2DEV/markview.nvim",
	lazy = false,
	opts = function()
		local presets = require("markview.presets")

		return {
			preview = {
				enable_hybrid_mode = true,
				hybrid_modes = { "n" },
				linewise_hybrid_mode = true,
				debounce = 150,
				draw_range = { 30, 30 },
				edit_range = { 0, 0 },
			},
			markdown = {
				headings = presets.headings.glow,
			},
			markdown_inline = {
				checkboxes = presets.checkboxes.nerd,
			},
		}
	end,
}
