# Installing sway, wayland, and basics
sudo apt install sway swaybg swayidle swaylock waybar wofi alacritty libglib2.0-bin fuse npm tmux

# Setting up bluetooth
sudo apt install bluez libspa-0.2-bluetooth blueman
sudo systemctl enable bluetooth.service
sudo systemctl start bluetooth.service

# NVidia drivers
sudo apt install nvidia-driver firmware-misc-nonfree nvidia-xconfig
echo 'options nvidia_drm modeset=1' | sudo tee /etc/modprobe.d/nvidia-drm.conf

# TODO symlinks
# ln -s "/home/bergerj/.dotfiles/bashrc" "/home/bergerj/.bashrc"

# Dark theme
sudo apt install arc-theme

# Tmux setup
mkdir -p ~/.tmux/plugins
git clone https://github.com/tmux-plugins/tpm ~/.tmux/plugins/tpm




# Installing apps TODO
# wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | sudo apt-key add -
# sudo sh -c 'echo "deb https://dl.google.com/linux/chrome/deb stable main" >> /etc/apt/sources.list.d/google.list'
# sudo apt-get install google-chrome-stable
# wget -O /home/bergerj/Apps/nvim.appimage https://github.com/neovim/neovim/releases/download/nightly/nvim-linux-x86_64.appimage
# chmod u+x /home/bergerj/Apps/nvim.appimage
