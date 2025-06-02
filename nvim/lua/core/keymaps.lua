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



-- [C]opy full [F]ile path to system clipboard
vim.keymap.set('n', '<leader>cf', function()
  local path_to_copy
  if vim.bo.filetype == 'netrw' then
    -- In Netrw, get the path of the file/directory under the cursor
    path_to_copy = vim.fn.expand('%:p:h') .. '/' .. vim.fn.getline('.')
    -- Basic cleanup for netrw paths (might need more robust parsing for complex cases)
    path_to_copy = path_to_copy:match("^(.-)@-$") or path_to_copy -- remove trailing @- for symlinks
    path_to_copy = path_to_copy:match("^(.-)/$") or path_to_copy -- remove trailing / for directories
    if vim.fn.getline('.'):match("^\"") or vim.fn.getline('.'):match("^=") or vim.fn.getline('.'):match("^Netrw .") then
        path_to_copy = vim.fn.expand('%:p') -- fallback to current netrw directory
    else
        local current_netrw_dir = vim.fn.expand('%:p')
        if current_netrw_dir:sub(-1) ~= '/' then
            current_netrw_dir = current_netrw_dir .. '/'
        end
        local item_name = vim.fn.getline('.')
        item_name = item_name:gsub("%s*%.%-%.*$", "")
        item_name = item_name:gsub("^%s*", "")
        item_name = item_name:gsub("%s*$", "")
        item_name = item_name:gsub("[@*/]$", "")
        path_to_copy = current_netrw_dir .. item_name
    end
  else
    path_to_copy = vim.fn.expand('%:p')
  end
  if path_to_copy and #path_to_copy > 0 then
    vim.fn.setreg('+', path_to_copy)
    vim.notify('Copied full path to clipboard: ' .. path_to_copy, vim.log.levels.INFO)
  else
    vim.notify('No path to copy.', vim.log.levels.WARN)
  end
end, { noremap = true, silent = false, desc = "[C]opy full [F]ile path to system clipboard" })

-- [C]opy current [D]irectory to system clipboard
vim.keymap.set('n', '<leader>cd', function()
  local dir_to_copy
  if vim.bo.filetype == 'netrw' then
    dir_to_copy = vim.fn.expand('%:p')
    if vim.fn.isdirectory(dir_to_copy) ~= 1 then
        dir_to_copy = vim.fn.expand('%:p:h')
    end
  else
    dir_to_copy = vim.fn.expand('%:p:h')
  end
  if dir_to_copy and #dir_to_copy > 0 then
    vim.fn.setreg('+', dir_to_copy)
    vim.notify('Copied directory to clipboard: ' .. dir_to_copy, vim.log.levels.INFO)
  else
    vim.notify('No directory to copy.', vim.log.levels.WARN)
  end
end, { noremap = true, silent = false, desc = "[C]opy current [D]irectory to system clipboard" })

-- [C]opy current file/buffer [C]ontents to system clipboard
vim.keymap.set('n', '<leader>cc', function()
  local current_pos = vim.fn.getpos('.') -- Save cursor position
  local current_win = vim.fn.win_getid() -- Save current window
  local message

  vim.cmd('normal! ggVG"+y')        -- Select all and yank to system clipboard
  vim.fn.win_gotoid(current_win)    -- Restore window focus
  vim.fn.setpos('.', current_pos)   -- Restore cursor position

  if vim.bo.filetype == 'netrw' then
    message = 'Copied Netrw listing to clipboard'
  else
    local filename = vim.fn.expand('%:t')
    if filename and #filename > 0 then
      message = 'Copied contents of ' .. filename .. ' to clipboard'
    else
      message = 'Copied buffer contents to clipboard'
    end
  end
  vim.notify(message, vim.log.levels.INFO)
end, { noremap = true, silent = true, desc = "[C]opy current file/buffer [C]ontents to system clipboard" })
