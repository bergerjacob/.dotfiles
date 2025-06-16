# Installing sway, wayland, and basics
sudo apt install sway swaybg swayidle swaylock waybar wofi alacritty libglib2.0-bin

# Setting up bluetooth
sudo apt install bluez libspa-0.2-bluetooth blueman
sudo systemctl enable bluetooth.service
sudo systemctl start bluetooth.service

# NVidia drivers
sudo apt install nvidia-driver firmware-misc-nonfree
# Run this but not in script sinc should only run once:
# echo 'options nvidia_drm modeset=1' | sudo tee /etc/modprobe.d/nvidia-drm.conf
