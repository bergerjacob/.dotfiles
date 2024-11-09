-- Set <space> as the leader key
-- MUST DO THIS FIRST
vim.g.mapleader = " "
vim.g.maplocalleader = " "

-- Set to true if you have a Nerd Font installed and selected in the terminal
vim.g.have_nerd_font = true

-- Load core settings
require('core.options')
require('core.keymaps')
require('core.autocmds')

-- Install lazy.nvim if not already installed
local lazypath = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"
if not (vim.loop or vim.uv).fs_stat(lazypath) then
	local lazyrepo = "https://github.com/folke/lazy.nvim.git"
	local out = vim.fn.system({ "git", "clone", "--filter=blob:none", "--branch=stable", lazyrepo, lazypath })
	if vim.v.shell_error ~= 0 then
		error("Error cloning lazy.nvim:\n" .. out)
	end
end
vim.opt.rtp:prepend(lazypath)

-- Configure and install plugins
require("lazy").setup("plugins", {
	ui = {
		icons = {}
	},
})

-- Load theme
require('themes.rose-pine')

-- Any additional configurations can be added here
