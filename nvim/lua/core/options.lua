-- General Neovim settings

-- Make line numbers default
vim.opt.number = true

-- Add relative line numbers
vim.opt.relativenumber = true

-- Default netrw settings
vim.g.netrw_bufsettings = 'noma nomod nu rnu nobl nowrap ro'

-- Enable mouse mode
vim.opt.mouse = "a"

-- Disable the right-click context menu
vim.keymap.set({ "n", "v", "i" }, "<RightMouse>", "<nop>")

-- Disable middle-mouse click paste/actions
vim.keymap.set({ "n", "v", "i" }, "<MiddleMouse>", "<nop>")

-- Don't show the mode, since it's already in the status line
vim.opt.showmode = false

-- -- Sync clipboard between OS and Neovim
-- vim.schedule(function()
-- 	vim.opt.clipboard = "unnamedplus"
-- end)

-- Enable break indent
vim.opt.breakindent = true

-- Save undo history
vim.opt.undofile = true

-- Case-insensitive searching unless capital letters are used
vim.opt.ignorecase = true
vim.opt.smartcase = true

-- Keep signcolumn on by default
vim.opt.signcolumn = "yes"

-- Decrease update time
vim.opt.updatetime = 250

-- Decrease mapped sequence wait time
vim.opt.timeoutlen = 300

-- Configure how new splits should be opened
vim.opt.splitright = true
vim.opt.splitbelow = true

-- Display certain whitespace characters
vim.opt.listchars = { tab = "» ", trail = "·", nbsp = "␣" }

-- Preview substitutions live
vim.opt.inccommand = "split"

-- Highlight the current line
vim.opt.cursorline = true

-- Minimal number of screen lines to keep above and below the cursor
vim.opt.scrolloff = 10

-- Tab and indentation settings
vim.opt.tabstop = 4
vim.opt.softtabstop = 4
vim.opt.shiftwidth = 4
vim.opt.expandtab = true

-- When doing :Vex make it split right
vim.api.nvim_create_user_command('Vex', function()
	vim.cmd('Vexplore')
	vim.cmd('wincmd L')
end, {})
