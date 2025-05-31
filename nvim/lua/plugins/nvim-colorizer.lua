return {
	"catgoose/nvim-colorizer.lua",
	event = "BufReadPre", -- Or "VeryLazy" with lazy_load = true as discussed before
	opts = {
		user_default_options = {
			-- Make sure other desired options like RGB, RRGGBB are true (they are by default)
			names = true,    -- You can keep this, LSP results should be more specific for Tailwind
			tailwind = "both", -- Use 'lsp' or 'both'. 'both' uses LSP and predefined Tailwind colors.
			tailwind_opts = {
				update_names = true, -- Crucial for 'lsp' or 'both' to get custom colors from your tailwind.config.js
			},
			-- other options like mode, virtualtext, etc.
			-- mode = "background", -- This is the default
		},
		-- To further optimize loading if you switch to a later event:
		-- lazy_load = true,
	},
}
