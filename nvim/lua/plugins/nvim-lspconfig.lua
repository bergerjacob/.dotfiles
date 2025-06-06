return {
	"neovim/nvim-lspconfig",
	dependencies = {
		{ "williamboman/mason.nvim", config = true },
		"williamboman/mason-lspconfig.nvim",
		"WhoIsSethDaniel/mason-tool-installer.nvim",
		{ "j-hui/fidget.nvim",       opts = {} },
		"hrsh7th/cmp-nvim-lsp",
	},
	config = function()
		-- LSP key mappings and settings
		vim.api.nvim_create_autocmd("LspAttach", {
			group = vim.api.nvim_create_augroup("lsp_attach", { clear = true }),
			callback = function(event)
				local map = function(keys, func, desc, mode)
					mode = mode or "n"
					vim.keymap.set(mode, keys, func, { buffer = event.buf, desc = "LSP: " .. desc })
				end

				-- LSP key mappings
				map("gd", require("telescope.builtin").lsp_definitions, "[G]oto [D]efinition")
				map("gr", require("telescope.builtin").lsp_references, "[G]oto [R]eferences")
				map("gI", require("telescope.builtin").lsp_implementations, "[G]oto [I]mplementation")
				map("<leader>D", require("telescope.builtin").lsp_type_definitions, "Type [D]efinition")
				map("<leader>ds", require("telescope.builtin").lsp_document_symbols, "[D]ocument [S]ymbols")
				map("<leader>ws", require("telescope.builtin").lsp_dynamic_workspace_symbols, "[W]orkspace [S]ymbols")
				map("<leader>rn", vim.lsp.buf.rename, "[R]e[n]ame")
				map("<leader>ca", vim.lsp.buf.code_action, "[C]ode [A]ction", { "n", "x" })
				map("gD", vim.lsp.buf.declaration, "[G]oto [D]eclaration")

				local client = vim.lsp.get_client_by_id(event.data.client_id)
				if client and client.supports_method("textDocument/documentHighlight") then
					local highlight_augroup = vim.api.nvim_create_augroup("lsp_document_highlight", { clear = false })
					vim.api.nvim_create_autocmd({ "CursorHold", "CursorHoldI" }, {
						buffer = event.buf,
						group = highlight_augroup,
						callback = vim.lsp.buf.document_highlight,
					})

					vim.api.nvim_create_autocmd({ "CursorMoved", "CursorMovedI" }, {
						buffer = event.buf,
						group = highlight_augroup,
						callback = vim.lsp.buf.clear_references,
					})
				end

				if client and client.supports_method("textDocument/inlayHint") then
					map("<leader>th", function()
						vim.lsp.inlay_hint(0, nil)
					end, "[T]oggle Inlay [H]ints")
				end
			end,
		})

		local capabilities = vim.lsp.protocol.make_client_capabilities()
		capabilities = vim.tbl_deep_extend("force", capabilities, require("cmp_nvim_lsp").default_capabilities())

		local servers = {
			lua_ls = {
				settings = {
					Lua = {
						runtime = {
							version = "LuaJIT",
							path = vim.split(package.path, ";"),
						},
						diagnostics = {
							globals = { "vim" },
						},
						workspace = {
							library = vim.api.nvim_get_runtime_file("", true),
							checkThirdParty = false,
						},
						completion = {
							callSnippet = "Replace",
						},
						telemetry = {
							enable = false,
						},
					},
				},
				root_dir = function(fname)
					return require("lspconfig").util.find_git_ancestor(fname)
						or require("lspconfig").util.path.dirname(fname)
				end,
			},
			-- grammarly = {},
			pyright = {
				settings = {
					python = {
						analysis = {
							autoSearchPaths = true,
							diagnosticMode = "workspace",
							useLibraryCodeForTypes = true,
						},
					},
				},
			},
			jsonls = {
				filetypes = { "json", "jsonc", "jsonl" }
			}
		}

		require("mason").setup()
		local ensure_installed = vim.tbl_keys(servers)
		require("mason-tool-installer").setup({ ensure_installed = ensure_installed })
		require("mason-lspconfig").setup({
			handlers = {
				function(server_name)
					local opts = {
						capabilities = capabilities,
					}
					if servers[server_name] then
						opts = vim.tbl_deep_extend("force", opts, servers[server_name])
					end
					require("lspconfig")[server_name].setup(opts)
				end,
			},
		})
	end,
}

