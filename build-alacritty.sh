curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
sudo apt update
sudo apt install cmake pkg-config libfontconfig1-dev libxcb-xfixes0-dev libxkbcommon-dev python3 git g++ cargo
git clone https://github.com/alacritty/alacritty.git
cd alacritty
cargo build --release
sudo cp target/release/alacritty /usr/local/bin
sudo cp extra/logo/alacritty-term.svg /usr/share/pixmaps/Alacritty.svg
