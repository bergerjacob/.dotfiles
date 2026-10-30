-- Tmux/SSH may retain an obsolete DISPLAY or lose WAYLAND_DISPLAY. Repair
-- only this Neovim process before clipboard provider selection, and never
-- guess when more than one current-user Wayland desktop is available.
local uv = vim.uv or vim.loop
local runtime = vim.env.XDG_RUNTIME_DIR
if not runtime or vim.fn.executable('wl-copy') ~= 1 or vim.fn.executable('wl-paste') ~= 1 then
  return
end

local function valid(display)
  if not display or display == '' then return false end
  local path = display:sub(1, 1) == '/' and display or runtime .. '/' .. display
  local info = uv.fs_lstat(path)
  return info and info.type == 'socket' and info.uid == uv.getuid()
end

if valid(vim.env.WAYLAND_DISPLAY) then return end
local scan = uv.fs_scandir(runtime)
if not scan then return end
local candidates = {}
while true do
  local name = uv.fs_scandir_next(scan)
  if not name then break end
  if name:match('^wayland%-%d+$') and valid(name) then
    candidates[#candidates + 1] = name
  end
end
if #candidates == 1 then vim.env.WAYLAND_DISPLAY = candidates[1] end
