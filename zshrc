# ~/.zshrc: configuration for zsh(1)

# ─── NVM (Node Version Manager) ───
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# ─── Interactive shell guard ───
# If not running interactively, don't do anything
[[ -o interactive ]] || return

# ─── History ───
HISTSIZE=1000
SAVEHIST=2000
HISTFILE=~/.zsh_history
setopt APPEND_HISTORY          # append to history file (zsh default)
setopt INC_APPEND_HISTORY      # write immediately, not just on exit
setopt SHARE_HISTORY           # share history across concurrent sessions
setopt HIST_IGNORE_DUPS        # skip duplicate lines
setopt HIST_IGNORE_SPACE       # skip commands prefixed with a space

# ─── lesspipe ───
[ -x /usr/bin/lesspipe ] && eval "$(SHELL=/bin/sh lesspipe)"

# ─── debian_chroot ───
if [ -z "${debian_chroot:-}" ] && [ -r /etc/debian_chroot ]; then
    debian_chroot=$(cat /etc/debian_chroot)
fi

# ─── Prompt ───
# Check for color terminal
case "$TERM" in
    xterm-color|*-256color) color_prompt=yes;;
esac

if [ -n "$force_color_prompt" ]; then
    if [ -x /usr/bin/tput ] && tput setaf 1 >&/dev/null; then
        color_prompt=yes
    else
        color_prompt=
    fi
fi

setopt PROMPT_SUBST    # allow ${var} expansion in prompt

if [ "$color_prompt" = yes ]; then
    PS1='${debian_chroot:+($debian_chroot)}%B%F{green}%n@%m%f%b:%B%F{blue}%~%f%b%# '
else
    PS1='${debian_chroot:+($debian_chroot)}%n@%m:%~%# '
fi
unset color_prompt force_color_prompt

# xterm title: user@host:dir
case "$TERM" in
xterm*|rxvt*)
    precmd() { print -Pn "\e]0;${debian_chroot:+($debian_chroot)}%n@%m: %~\a" }
    ;;
esac

# ─── LS_COLORS & matching aliases ───
if [ -x /usr/bin/dircolors ]; then
    test -r ~/.dircolors && eval "$(dircolors -b ~/.dircolors)" || eval "$(dircolors -b)"
    alias ls='ls --color=auto'
    alias grep='grep --color=auto'
    alias fgrep='fgrep --color=auto'
    alias egrep='egrep --color=auto'
fi

alias ll='ls -alF'
alias la='ls -A'
alias l='ls -CF'

# alert alias (zsh-compatible: uses fc instead of history|tail)
alias alert='notify-send --urgency=low -i "$([ $? = 0 ] && echo terminal || echo error)" "$(fc -ln -1 | sed -e "s/^\s*//;s/[;&|]\s*alert$//")"'

# ─── Source bash aliases file if present ───
if [ -f ~/.bash_aliases ]; then
    . ~/.bash_aliases
fi

# ─── PATH ───
export PATH="$HOME/Apps:$PATH"
export PATH="$PATH:$HOME/.local/bin"
export PATH="$PATH:$HOME/scripts"
export PATH="$PATH:/usr/local/MATLAB/R2024b/bin"
export PATH="/home/bergerj/Scripts:$PATH"
export PATH="/home/bergerj/.local/share/gem/ruby/3.1.0/bin:$PATH"

# ─── Editor ───
export VISUAL=vim
export EDITOR="$VISUAL"

# ─── Key bindings ───
bindkey -r '^P'
bindkey -r '^N'
set -o emacs

# ─── Convenience aliases ───
alias python="python3"
alias pip="pip3"
alias fd='fdfind'
alias drag='ripdrag'

# ─── Sway/Wayland ───
export WLR_NO_HARDWARE_CURSORS=1
. "$HOME/.cargo/env"
export WLR_DRM_NO_ATOMIC=0
export WLR_DRM_DEVICES=/dev/dri/card0
export GBM_BACKEND=nvidia-drm
export __GLX_VENDOR_LIBRARY_NAME=nvidia
export __NV_PRIME_RENDER_OFFLOAD=1
export __VK_LAYER_NV_optimus=NVIDIA_only

# ─── Completions ───
autoload -Uz compinit && compinit

# ─── Google Cloud SDK ───
if [ -f '/home/bergerj/google-cloud-sdk/path.zsh.inc' ]; then
    . '/home/bergerj/google-cloud-sdk/path.zsh.inc'
fi
if [ -f '/home/bergerj/google-cloud-sdk/completion.zsh.inc' ]; then
    . '/home/bergerj/google-cloud-sdk/completion.zsh.inc'
fi

# ─── pyenv ───
export PYENV_ROOT="$HOME/.pyenv"
[[ -d $PYENV_ROOT/bin ]] && export PATH="$PYENV_ROOT/bin:$PATH"
eval "$(pyenv init - zsh)"
eval "$(pyenv virtualenv-init -)"

# ─── rbenv ───
export PATH="$HOME/.rbenv/bin:$PATH"
eval "$(rbenv init - zsh)"

# ─── nvm bash completion (via bashcompinit for zsh compatibility) ───
if [ -s "$NVM_DIR/bash_completion" ]; then
    autoload -U +X bashcompinit && bashcompinit
    . "$NVM_DIR/bash_completion"
fi

# ─── copy() – copy to terminal clipboard via OSC 52 ───
copy() {
    local input
    if [ -t 0 ]; then
        input="$*"
    else
        input=$(cat)
    fi
    local encoded=$(echo -n "$input" | base64 | tr -d '\n')
    printf "\033]52;c;%s\007" "$encoded"
}

# ─── opencode ───
export PATH=/home/bergerj/.opencode/bin:$PATH

# ─── bun ───
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

# ─── Antigravity CLI ───
export PATH="/home/bergerj/.local/bin:$PATH"


source /home/bergerj/main/personal/local-ai/terminal-ai-thing-name-tbd/zsh-widget.zsh

# ─── Word movement ───
# Match Ctrl+Left / Ctrl+Right from modern terminals and tmux.
bindkey -M emacs '^[[1;5D' backward-word
bindkey -M emacs '^[[1;5C' forward-word
bindkey -M viins '^[[1;5D' backward-word
bindkey -M viins '^[[1;5C' forward-word
