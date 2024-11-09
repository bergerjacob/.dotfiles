return {
	"nosduco/remote-sshfs.nvim",
	dependencies = { "nvim-telescope/telescope.nvim" },
	opts = {
		connections = {
			ssh_configs = {
				vim.fn.expand("$HOME") .. "/.ssh/config",
			},
			sshfs_args = {
				"-o reconnect",
				"-o ConnectTimeout=5",
			},
		},
		mounts = {
			base_dir = vim.fn.expand("$HOME") .. "/.sshfs/",
			unmount_on_exit = true,
		},
		handlers = {
			on_connect = {
				change_dir = true,
			},
			on_disconnect = {
				clean_mount_folders = false,
			},
			on_edit = {},
		},
		ui = {
			select_prompts = false,
			confirm = {
				connect = true,
				change_dir = false,
			},
		},
		log = {
			enable = false,
			truncate = false,
			types = {
				all = false,
				util = false,
				handler = false,
				sshfs = false,
			},
		},
	},
	config = function(_, opts)
		-- Set up the plugin with your options
		require('remote-sshfs').setup(opts)
		require('telescope').load_extension('remote-sshfs')

		-- Add your additional settings and key mappings here
		local api = require('remote-sshfs.api')
		vim.keymap.set('n', '<leader>rc', api.connect, { desc = "Remote SSHFS Connect" })
		vim.keymap.set('n', '<leader>rd', api.disconnect, { desc = "Remote SSHFS Disconnect" })
		vim.keymap.set('n', '<leader>re', api.edit, { desc = "Remote SSHFS Edit" })

		-- Optional: Override Telescope's find_files and live_grep
		local builtin = require("telescope.builtin")
		local connections = require("remote-sshfs.connections")
		vim.keymap.set("n", "<leader>ff", function()
			if connections.is_connected then
				api.find_files()
			else
				builtin.find_files()
			end
		end, { desc = "Find Files (Remote Aware)" })
		vim.keymap.set("n", "<leader>fg", function()
			if connections.is_connected then
				api.live_grep()
			else
				builtin.live_grep()
			end
		end, { desc = "Live Grep (Remote Aware)" })
	end,
}
