-- Shared helper: Telescope directory picker → name prompt → create note
---@param action string "new" | "link_new" | "extract_note" | "new_from_template"
local function note_picker(action)
	local vault_root = vim.fn.expand("~/main/personal/vault")
	local actions = require("obsidian.actions")
	local Note = require("obsidian.note")
	local uv = vim.uv or vim.loop

	-- For visual-mode actions, capture selection BEFORE opening Telescope
	local viz_info
	if action == "link_new" or action == "extract_note" then
		local mode = vim.fn.visualmode()
		if mode == "" then
			vim.notify("[obsidian] Must be in visual mode", vim.log.levels.ERROR)
			return
		end
		local bufnr = vim.api.nvim_get_current_buf()
		local s_line = vim.fn.line("'<")
		local s_col = vim.fn.col("'<")
		local e_line = vim.fn.line("'>")
		local e_col = vim.fn.col("'>")

		local text_sr, text_sc, text_er, text_ec
		local lines
		if mode == "V" then
			-- Line-wise: replace entire lines
			text_sr = s_line - 1
			text_sc = 0
			text_er = e_line -- exclusive (next line start)
			text_ec = 0
			lines = vim.api.nvim_buf_get_lines(bufnr, s_line - 1, e_line, false)
		else
			-- Char-wise: col("'>") is 1-indexed exclusive
			text_sr = s_line - 1
			text_sc = s_col - 1
			text_er = e_line - 1
			text_ec = e_col - 1
			lines = vim.api.nvim_buf_get_lines(bufnr, s_line - 1, e_line, false)
			lines[1] = lines[1]:sub(s_col)
			if e_line > s_line then
				lines[#lines] = lines[#lines]:sub(1, e_col - 1)
			else
				lines[1] = lines[1]:sub(1, e_col - s_col)
			end
		end

		viz_info = {
			bufnr = bufnr,
			mode = mode,
			s_line = s_line,
			e_line = e_line,
			sr = text_sr,
			sc = text_sc,
			er = text_er,
			ec = text_ec,
			lines = lines,
			selection = table.concat(lines, "\n"),
		}
	end

	-- Find command: prefer fd for speed, fall back to find
	local find_cmd
	if vim.fn.executable("fd") == 1 then
		find_cmd = { "fd", "--type", "d", "--hidden", "--no-ignore-vcs" }
	else
		find_cmd = { "find", ".", "-type", "d", "-not", "-path", "*/.git/*", "-not", "-path", "*/.obsidian/*" }
	end

	---Callback after directory is chosen via Telescope
	local function after_dir(dir)
		dir = dir:gsub("^%.%/", "") -- strip leading ./
		local default = (dir == "." or dir == "") and "" or dir .. "/"

		if action == "new_from_template" then
			-- Pick template, then prompt for name
			local tpl_dir = vim.fn.expand(vault_root .. "/templates")
			local templates = {}
			if vim.fn.isdirectory(tpl_dir) == 1 then
				local handle = uv.fs_scandir(tpl_dir)
				if handle then
					while true do
						local name, ftype = uv.fs_scandir_next(handle)
						if not name then break end
						if ftype == "file" and name:match("%.md$") then
							templates[#templates + 1] = name:gsub("%.md$", "")
						end
					end
				end
			end
			if #templates == 0 then
				vim.notify("[obsidian] No templates found in templates/", vim.log.levels.WARN)
				return
			end
			vim.ui.select(templates, {
				prompt = "Template:",
			}, function(tpl_name)
				if not tpl_name then return end
				vim.ui.input({
					prompt = "Note name: ",
					default = default,
				}, function(name)
					if not name or #vim.trim(name) == 0 then return end
					name = vim.trim(name):gsub("%.md$", "")
					local tpl_path = tpl_dir .. "/" .. tpl_name .. ".md"
					local note = Note.create { id = name, template = tpl_path, should_write = true }
					note:open { sync = true }
				end)
			end)
			return
		end

		-- Standard actions: prompt for name, then create note
		vim.ui.input({
			prompt = "Note name: ",
			default = default,
		}, function(name)
			if not name or #vim.trim(name) == 0 then return end
			name = vim.trim(name):gsub("%.md$", "")

			if action == "new" then
				actions.new(name)
			elseif action == "link_new" then
				local note = Note.create { id = name }
				local link = note:format_link { label = viz_info.selection }
				local link_lines = vim.split(link, "\n", { plain = true })
				vim.api.nvim_buf_set_text(
					viz_info.bufnr,
					viz_info.sr, viz_info.sc,
					viz_info.er, viz_info.ec,
					link_lines
				)
				vim.api.nvim_set_current_buf(viz_info.bufnr)
				vim.cmd("silent! write")
			elseif action == "extract_note" then
				local note = Note.create {
					id = name,
					should_write = true,
				}
				-- Delete selection (no backlink)
				if viz_info.mode == "V" then
					vim.api.nvim_buf_set_lines(viz_info.bufnr,
						viz_info.s_line - 1, viz_info.e_line, false, {})
				else
					vim.api.nvim_buf_set_text(
						viz_info.bufnr,
						viz_info.sr, viz_info.sc,
						viz_info.er, viz_info.ec,
						{ "" }
					)
				end
				vim.api.nvim_set_current_buf(viz_info.bufnr)
				vim.cmd("silent! write")
				note:open { sync = true }
				vim.api.nvim_buf_set_lines(0, -1, -1, false, viz_info.lines)
			end
		end)
	end

	-- Open Telescope directory picker
	local ok = pcall(function()
		require("telescope.builtin").find_files {
			find_command = find_cmd,
			cwd = vault_root,
			prompt_title = "Pick directory",
			attach_mappings = function(prompt_bufnr)
				local tel_actions = require("telescope.actions")
				local action_state = require("telescope.actions.state")

				tel_actions.select_default:replace(function()
					local selection = action_state.get_selected_entry()
					tel_actions.close(prompt_bufnr)
					if selection then
						after_dir(selection[1])
					end
				end)
				return true
			end,
		}
	end)
	if not ok then
		vim.notify("[obsidian] Telescope not available — cannot open directory picker", vim.log.levels.ERROR)
	end
end

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
		-- Obsidian doesn't use `id`, and uses the first alias as the display title.
		-- Always mirrors the first alias to note.title (set during creation + rename).
		frontmatter = {
			func = function(note)
				local aliases = note.aliases or {}
				if note.title and #note.title > 0 then
					local new_aliases = { note.title }
					for i = 2, #aliases do
						new_aliases[#new_aliases + 1] = aliases[i]
					end
					aliases = new_aliases
				end
				return { aliases = aliases, tags = note.tags }
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

				-- Rename note + update backlinks. Shows alias as prompt default,
				-- preserves kebab-case filename, and updates alias on completion.
				vim.keymap.set("n", "<leader>or", function()
					local note = api.current_note(0)
					if not note then
						vim.notify("Not in a note", vim.log.levels.WARN)
						return
					end
					local display = (note.aliases and #note.aliases > 0 and note.aliases[1])
						or note.id or "untitled"
					vim.ui.input({ prompt = "Rename note: ", default = display }, function(input)
						if not input or #input == 0 then return end
						local kebab = require("obsidian.builtin").title_id(input)
						-- Set the pretty title on the note object so frontmatter.func
						-- can use it to update the first alias during save_to_buffer.
						note.title = input
						vim.cmd("Obsidian rename " .. kebab)
					end)
				end, { buffer = true, desc = "[obsidian] Rename note" })

				-- Link visual selection to existing note
				vim.keymap.set("v", "<leader>ol", function()
					actions.link()
				end, { buffer = true, desc = "[obsidian] Link selection" })

				-- Create new note and link selection to it (via directory picker)
				vim.keymap.set("v", "<leader>on", function()
					note_picker("link_new")
				end, { buffer = true, desc = "[obsidian] Link to new note" })

				-- Extract selection to new note (via directory picker)
				vim.keymap.set("v", "<leader>oe", function()
					note_picker("extract_note")
				end, { buffer = true, desc = "[obsidian] Extract selection" })
			end,
		},
	},

	-- Global keymaps (work anywhere, not just in note buffers)
	keys = {
		{ "<leader>ob", "<cmd>Obsidian backlinks<cr>",         desc = "[obsidian] Backlinks" },
		{ "<leader>oc", "<cmd>Obsidian search - [ ]<cr>",      desc = "[obsidian] Search open tasks" },
		{ "<leader>oN", function() note_picker("new_from_template") end, desc = "[obsidian] New from template" },
		{
			"<leader>on",
			function()
				note_picker("new")
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
