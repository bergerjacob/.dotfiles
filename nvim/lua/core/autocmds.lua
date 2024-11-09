-- Autocommands

vim.g.initial_cwd = vim.fn.getcwd()

-- Enable spell checking for markdown and text files
vim.api.nvim_create_autocmd("FileType", {
	pattern = { "markdown", "text" },
	callback = function()
		vim.wo.spell = true
		vim.bo.spelllang = "en_us"
	end,
})

-- Disable spell checking for other file types
vim.api.nvim_create_autocmd("FileType", {
	pattern = "*",
	callback = function()
		if not vim.tbl_contains({ "markdown", "text" }, vim.bo.filetype) then
			vim.wo.spell = false
		end
	end,
})

-- Open netrw in home directory when starting Neovim without arguments
-- vim.api.nvim_create_autocmd("VimEnter", {
-- 	callback = function()
-- 		if vim.fn.argc() == 0 and vim.fn.isdirectory(vim.fn.getcwd()) == 1 then
-- 			vim.cmd('Explore ' .. vim.fn.expandcmd('~/'))
-- 		end
-- 	end,
-- })

-- Auto-remove carriage return characters on file save
vim.api.nvim_create_augroup("CleanCarriageReturn", { clear = true })
vim.api.nvim_create_autocmd("BufWritePre", {
	group = "CleanCarriageReturn",
	pattern = "*",
	command = ":%s/\\r//ge",
})

-- Highlight text on yank
vim.api.nvim_create_autocmd("TextYankPost", {
	desc = "Highlight when yanking text",
	group = vim.api.nvim_create_augroup("highlight_yank", { clear = true }),
	callback = function()
		vim.highlight.on_yank()
	end,
})

vim.api.nvim_create_autocmd("FileType", {
	pattern = "netrw",
	command = "silent! lcd %:p",
})

vim.api.nvim_create_autocmd("FileType", {
	pattern = "*",
	callback = function()
		if vim.bo.filetype ~= "netrw" then
			vim.cmd("silent! lcd " .. vim.fn.fnameescape(vim.g.initial_cwd))
		end
	end,
})

-- Remove 'r' and 'o' flags from formatoptions
vim.cmd [[autocmd FileType * setlocal formatoptions-=r formatoptions-=o]]



-- Create a variable to track the toggle state
local gj_gk_enabled = false

-- Define the toggle function
function ToggleGjGkMappings()
	if gj_gk_enabled then
		-- If enabled, remove the mappings
		vim.api.nvim_buf_del_keymap(0, 'n', 'j')
		vim.api.nvim_buf_del_keymap(0, 'n', 'k')
		vim.api.nvim_buf_del_keymap(0, 'v', 'j')
		vim.api.nvim_buf_del_keymap(0, 'v', 'k')
		vim.api.nvim_buf_del_keymap(0, 'o', 'j')
		vim.api.nvim_buf_del_keymap(0, 'o', 'k')
		vim.api.nvim_buf_del_keymap(0, 'n', '$')
		vim.api.nvim_buf_del_keymap(0, 'v', '$')
		vim.api.nvim_buf_del_keymap(0, 'n', '_')
		vim.api.nvim_buf_del_keymap(0, 'v', '_')
		gj_gk_enabled = false
		print("Disabled extended visual line mappings for j/k and other keys")
	else
		-- If disabled, set the mappings
		vim.api.nvim_buf_set_keymap(0, 'n', 'j', 'gj', { noremap = true, silent = true })
		vim.api.nvim_buf_set_keymap(0, 'n', 'k', 'gk', { noremap = true, silent = true })
		vim.api.nvim_buf_set_keymap(0, 'v', 'j', 'gj', { noremap = true, silent = true })
		vim.api.nvim_buf_set_keymap(0, 'v', 'k', 'gk', { noremap = true, silent = true })
		vim.api.nvim_buf_set_keymap(0, 'o', 'j', 'gj', { noremap = true, silent = true })
		vim.api.nvim_buf_set_keymap(0, 'o', 'k', 'gk', { noremap = true, silent = true })
		vim.api.nvim_buf_set_keymap(0, 'n', '$', 'g$', { noremap = true, silent = true })
		vim.api.nvim_buf_set_keymap(0, 'v', '$', 'g$', { noremap = true, silent = true })
		vim.api.nvim_buf_set_keymap(0, 'n', '_', 'g^', { noremap = true, silent = true })
		vim.api.nvim_buf_set_keymap(0, 'v', '_', 'g^', { noremap = true, silent = true })
		gj_gk_enabled = true
		print("Enabled extended visual line mappings for j/k and other keys")
	end
end

-- Set a keybinding to toggle the mappings
vim.api.nvim_set_keymap('n', '<leader>g', ':lua ToggleGjGkMappings()<CR>', { noremap = true, silent = true })
