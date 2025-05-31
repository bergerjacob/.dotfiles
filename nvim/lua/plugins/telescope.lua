return {
	"nvim-telescope/telescope.nvim",
	event = "VimEnter",
	dependencies = {
		"nvim-lua/plenary.nvim",
		{
			"nvim-telescope/telescope-fzf-native.nvim",
			build = "make",
			cond = function()
				return vim.fn.executable("make") == 1
			end,
		},
		"nvim-telescope/telescope-ui-select.nvim",
		{ "nvim-tree/nvim-web-devicons", enabled = vim.g.have_nerd_font },
	},
	config = function()
		-- Determine the anchor search path once when the config loads (on VimEnter).
		-- This path will be used for primary file finding and grepping.
		-- It defaults to where Vim started, but will be the Git root if Vim
		-- was started within a Git repository.
		local initial_startup_cwd = vim.fn.getcwd()
		local anchor_search_path = initial_startup_cwd

		local vcs_ok, vcs = pcall(require, "telescope.vcs")
		if vcs_ok and vcs.git_root then
			local git_root_at_startup = vcs.git_root({ normalize = true, silent = true })
			if git_root_at_startup then
				anchor_search_path = git_root_at_startup
			end
		end

		require("telescope").setup({
			extensions = {
				["ui-select"] = {
					require("telescope.themes").get_dropdown(),
				},
			},
		})

		pcall(require("telescope").load_extension, "fzf")
		pcall(require("telescope").load_extension, "ui-select")

		local builtin = require("telescope.builtin")

		-- General Telescope key mappings
		vim.keymap.set("n", "<leader>sh", builtin.help_tags, { desc = "[S]earch [H]elp" })
		vim.keymap.set("n", "<leader>sk", builtin.keymaps, { desc = "[S]earch [K]eymaps" })
		vim.keymap.set("n", "<leader>ss", builtin.builtin, { desc = "[S]earch [S]elect Telescope Picker" })
		vim.keymap.set("n", "<leader>sw", builtin.grep_string, { desc = "[S]earch current [W]ord" })
		vim.keymap.set("n", "<leader>sd", builtin.diagnostics, { desc = "[S]earch [D]iagnostics" })
		vim.keymap.set("n", "<leader>sr", builtin.resume, { desc = "[S]earch [R]esume last search" })
		vim.keymap.set("n", "<leader>s.", builtin.oldfiles, { desc = '[S]earch Recent Files (Oldfiles)' })
		vim.keymap.set("n", "<leader><leader>", builtin.buffers, { desc = "Find existing buffers" })

		-- File/Grep searchers with specific CWD strategies:

		-- Search files from the determined anchor path (Initial Git Project or Vim Startup Directory)
		vim.keymap.set("n", "<leader>sf", function()
			builtin.find_files({ cwd = anchor_search_path })
		end, { desc = "[S]earch [F]iles (Initial Project/Dir)" })

		-- Live Grep from the determined anchor path
		vim.keymap.set("n", "<leader>sg", function()
			builtin.live_grep({ cwd = anchor_search_path })
		end, { desc = "[S]earch by [G]rep (Initial Project/Dir)" })

		-- Search all files starting from the home directory
		vim.keymap.set("n", "<leader>sa", function()
			builtin.find_files({
				cwd = '~',
				find_command = { 'rg', '--files', '--hidden', '--follow', '--glob', '!.git/*' }
			})
		end, { desc = "[S]earch [A]ll files (Home Dir)" })

		-- Search Neovim configuration files
		vim.keymap.set("n", "<leader>sn", function()
			builtin.find_files({ cwd = vim.fn.stdpath("config") })
		end, { desc = "[S]earch [N]eovim files" })

		-- Other Telescope utilities
		vim.keymap.set("n", "<leader>/", function()
			builtin.current_buffer_fuzzy_find(require("telescope.themes").get_dropdown({
				winblend = 10,
				previewer = false,
			}))
		end, { desc = "Fuzzily search in current buffer" })

		vim.keymap.set("n", "<leader>s/", function() -- Note: <leader>s/ might conflict if / is part of your leader
			builtin.live_grep({
				grep_open_files = true,
				prompt_title = "Live Grep in Open Files",
			})
		end, { desc = "[S]earch in Open Files" })
	end,
}
