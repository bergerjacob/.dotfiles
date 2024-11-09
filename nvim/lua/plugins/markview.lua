return {
	"OXY2DEV/markview.nvim",
	lazy = false,
	dependencies = {
		"nvim-treesitter/nvim-treesitter",
		"nvim-tree/nvim-web-devicons",
	},
	config = function()
		require('markview').setup({
			custom_css = {
				h1 = 'font-size: 5em; font-weight: bold; color: red;',
				h2 = 'font-size: 1.4em; font-weight: bold; color: red;',
				h3 = 'font-size: 1.3em; font-weight: bold;',
				h4 = 'font-size: 1.2em; font-weight: bold;',
				h5 = 'font-size: 1.1em; font-weight: bold;',
				h6 = 'font-size: 1.0em; font-weight: bold;',
			},
		})
	end,
}
