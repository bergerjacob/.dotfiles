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
		-- Daily notes go into a folder (standard Obsidian convention)
		daily_notes = {
			folder = "daily",
			date_format = "%Y-%m-%d",
		},
		-- Checkbox toggling order (markview handles visual rendering)
		checkbox = {
			order = { " ", "x" },
		},
		-- Remove nvim-only `id` field from frontmatter (Obsidian doesn't use it)
		frontmatter = {
			func = function(note)
				return { aliases = note.aliases, tags = note.tags }
			end,
		},
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

			-- Rename note + update all backlinks
			vim.keymap.set("n", "<leader>or", "<cmd>Obsidian rename<cr>", {
				buffer = true,
				desc = "[obsidian] Rename note",
			})

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
		{ "<leader>ob", "<cmd>Obsidian backlinks<cr>", desc = "[obsidian] Backlinks" },
		{ "<leader>oc", "<cmd>Obsidian search - [ ]<cr>", desc = "[obsidian] Search open tasks" },
		{ "<leader>od", "<cmd>Obsidian today<cr>", desc = "[obsidian] Today's daily note" },
		{ "<leader>oj", "<cmd>Obsidian dailies<cr>", desc = "[obsidian] Daily notes list" },
		{ "<leader>oN", "<cmd>Obsidian new_from_template<cr>", desc = "[obsidian] New from template" },
		{
			"<leader>on",
			function()
				local actions = require("obsidian.actions")
				vim.ui.input({ prompt = "Note title: " }, function(title)
					if not title or #vim.trim(title) == 0 then return end
					local subdirs = { "orst", "personal", "work" }
					vim.ui.select(subdirs, {
						prompt = "Where in main/ ?",
						format_item = function(item)
							return "main/" .. item
						end,
					}, function(choice)
						if not choice then return end
						actions.new("main/" .. choice .. "/" .. title)
					end)
				end)
			end,
			desc = "[obsidian] New note",
		},
		{ "<leader>oo", "<cmd>Obsidian open<cr>", desc = "[obsidian] Open in Obsidian app" },
		{ "<leader>ot", "<cmd>Obsidian tags<cr>", desc = "[obsidian] Search by tag" },
	},

	-- Post-setup: git backup keymap + auto-pull on first vault open + fix rename frontmatter bug
	config = function(_, opts)
		require("obsidian").setup(opts)

		-- Fix: obsidian.nvim rename doesn't detect existing frontmatter on the new buffer,
		-- so save_to_buffer inserts a duplicate. Patch: detect and set has_frontmatter.
		local Note = require("obsidian.note")
		local orig_save = Note.save_to_buffer
		Note.save_to_buffer = function(self, opts)
			if not self.has_frontmatter then
				local bufnr = opts and opts.bufnr or self.bufnr or 0
				local lines = vim.api.nvim_buf_get_lines(bufnr, 0, 10, false)
				if lines[1] == "---" then
					for i = 2, #lines do
						if lines[i] == "---" then
							self.has_frontmatter = true
							self.frontmatter_end_line = i
							break
						end
					end
				end
			end
			return orig_save(self, opts)
		end

		local pulled = false
		local vault = "~/main/personal/vault"

		-- Pull once per session when vault first activates
		vim.schedule(function()
			vim.fn.jobstart({
				"bash", "-c",
				"cd " .. vault .. " && git pull --ff-only 2>&1",
			}, {
				detach = true,
				on_exit = function(_, code)
					pulled = true
					vim.schedule(function()
						if code == 0 then
							vim.notify("Vault pulled (up to date)", vim.log.levels.INFO)
						end
					end)
				end,
			})
		end)

		-- Manual backup + push button
		vim.keymap.set("n", "<leader>og", function()
			local ts = os.date("%Y-%m-%d %H:%M:%S")
			local script = string.format(
				"cd %s && "
				.. "git pull --ff-only && "
				.. "git add -A && "
				.. "git diff --cached --quiet && { exit 0; } || git commit -m 'vault backup: %s' && "
				.. "git push",
				vault, ts
			)
			vim.fn.jobstart({ "bash", "-c", script }, {
				detach = true,
				on_exit = function(_, code)
					vim.schedule(function()
						if code == 0 then
							vim.notify("Vault synced — " .. ts, vim.log.levels.INFO)
						else
							vim.notify(
								"Vault sync FAILED (need merge? try 'cd vault && git pull')",
								vim.log.levels.ERROR
							)
						end
					end)
				end,
			})
		end, { desc = "[obsidian] Git backup + push" })
	end,
}
