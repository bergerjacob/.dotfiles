return {
	'stevearc/oil.nvim',
	---@module 'oil'
	---@type oil.SetupOpts
	opts = {},
	-- Optional dependencies
	dependencies = { { "nvim-mini/mini.icons", opts = {} } },
	-- dependencies = { "nvim-tree/nvim-web-devicons" }, -- use if you prefer nvim-web-devicons
	-- Lazy loading is not recommended because it is very tricky to make it work correctly in all situations.
	lazy = false,
	config = function(_, opts)
		require("oil").setup(opts)

		-- Overwrite netrw's Ex, Vex, and Sex commands to use Oil instead
		-- <args> allows you to do things like `:Ex src/`
		vim.api.nvim_create_user_command("Ex", "Oil <args>", { nargs = "*", complete = "dir" })
		vim.api.nvim_create_user_command("Vex", "vert Oil <args>", { nargs = "*", complete = "dir" })
		vim.api.nvim_create_user_command("Sex", "split | Oil <args>", { nargs = "*", complete = "dir" })
	end,
}
