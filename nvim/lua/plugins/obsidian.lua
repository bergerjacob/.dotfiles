	return {
	"obsidian-nvim/obsidian.nvim",
	version = "*",
	event = "VeryLazy",
	---@module 'obsidian'
	---@type obsidian.config
	opts = {
		legacy_commands = false,
		open_notes_in = "current",
		workspaces = {
			{
				name = "personal",
				path = "~/main/personal/vault",
			},
		},
		-- Checkbox toggling order (markview handles visual rendering)
		checkbox = {
			order = { " ", "x" },
		},
		-- Markview handles all rendering; obsidian's UI auto-disables
		-- Use title as filename instead of timestamp-ID
		note_id_func = function(title)
			return require("obsidian.builtin").title_id(title)
		end,

		-- Buffer-local keymaps (active inside any vault note)
		callbacks = {
			enter_note = function(client)
				local actions = require("obsidian.actions")
				local api = require("obsidian.api")

				-- Smart <CR>: follow link / pick tag / toggle checkbox / fold heading
				vim.keymap.set("n", "<CR>", function()
					return api.smart_action()
				end, { buffer = true, expr = true, desc = "[obsidian] Smart action" })

			-- Follow [[link]] under cursor
			vim.keymap.set("n", "gd", function()
				local link, _ = api.cursor_link()
				if link then
					actions.follow_link(link)
				end
			end, { buffer = true, desc = "[obsidian] Follow link" })

				-- Jump between wiki links in buffer
				vim.keymap.set("n", "]o", function()
					actions.nav_link("next")
				end, { buffer = true, desc = "[obsidian] Next link" })
				vim.keymap.set("n", "[o", function()
					actions.nav_link("prev")
				end, { buffer = true, desc = "[obsidian] Previous link" })

				-- New note (prompts for title)
				vim.keymap.set("n", "<leader>on", function()
					actions.new()
				end, { buffer = true, desc = "[obsidian] New note" })

				-- New note from template
				vim.keymap.set("n", "<leader>ot", function()
					actions.new_from_template()
				end, { buffer = true, desc = "[obsidian] New from template" })

				-- Link visual selection to existing note
				vim.keymap.set("v", "<leader>ol", function()
					actions.link()
				end, { buffer = true, desc = "[obsidian] Link selection" })

				-- Create new note and link selection to it
				vim.keymap.set("v", "<leader>on", function()
					actions.link_new()
				end, { buffer = true, desc = "[obsidian] Link to new note" })

			-- Extract selection to new note (moves text, replaces with link)
			vim.keymap.set("v", "<leader>oe", function()
				-- Use floating prompt (vim.ui.input) instead of command-line
				-- so the title prompt doesn't get lost
				vim.ui.input({ prompt = "Extract note title: " }, function(label)
					if label and #vim.trim(label) > 0 then
						actions.extract_note(vim.trim(label))
					else
						vim.notify("Extract aborted (no title)", vim.log.levels.WARN)
					end
				end)
			end, { buffer = true, desc = "[obsidian] Extract selection" })
			end,
		},
	},

	-- Global keymaps (work anywhere, not just in note buffers)
	keys = {
		{ "<leader>of", "<cmd>Obsidian quick_switch<cr>", desc = "[obsidian] Quick switch note" },
		{ "<leader>os", "<cmd>Obsidian search<cr>", desc = "[obsidian] Search notes" },
		{ "<leader>ob", "<cmd>Obsidian backlinks<cr>", desc = "[obsidian] Backlinks" },
		{ "<leader>od", "<cmd>Obsidian today<cr>", desc = "[obsidian] Today's daily note" },
		{ "<leader>oj", "<cmd>Obsidian dailies<cr>", desc = "[obsidian] Daily notes list" },
		{ "<leader>oo", "<cmd>Obsidian open<cr>", desc = "[obsidian] Open in Obsidian app" },
		{ "<leader>ot", "<cmd>Obsidian tags<cr>", desc = "[obsidian] Search by tag" },
	},
}
