-- Key mappings

-- Toggle Undotree with <leader>u
vim.keymap.set("n", "<leader>u", vim.cmd.UndotreeToggle)

-- Clear search highlights with <Esc>
vim.keymap.set("n", "<Esc>", "<cmd>nohlsearch<CR>")

-- Open diagnostic quickfix list
vim.keymap.set("n", "<leader>q", vim.diagnostic.setloclist, { desc = "Open diagnostic [Q]uickfix list" })

-- Autocorrect the first suggestion
vim.api.nvim_set_keymap("n", "<C-g>", "z=", { noremap = true, silent = true })

-- -- Insert a single character (custom mapping)
-- vim.keymap.set("n", "<C-k>", function()
-- 	vim.api.nvim_feedkeys('i_\x1b', 'n', false)
-- 	vim.schedule(function()
-- 		vim.api.nvim_feedkeys('r', 'n', false)
-- 	end)
-- end)

-- Disable arrow keys in normal mode
vim.keymap.set("n", "<left>", '<cmd>echo "Use h to move!"<CR>')
vim.keymap.set("n", "<right>", '<cmd>echo "Use l to move!"<CR>')
vim.keymap.set("n", "<up>", '<cmd>echo "Use k to move!"<CR>')
vim.keymap.set("n", "<down>", '<cmd>echo "Use j to move!"<CR>')

-- Move lines in visual mode easier
vim.keymap.set("v", "J", ":m '>+1<CR>gv=gv")
vim.keymap.set("v", "K", ":m '<-2<CR>gv=gv")

-- Paste over selected text while keeping your yank buffer
vim.keymap.set("x", "<leader>p", "\"_dP")

-- Show diagnostic hover (float) for the current cursor position
vim.keymap.set("n", "<leader>k", vim.diagnostic.open_float, { desc = "Show Line diagnostics" })
