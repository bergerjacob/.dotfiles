# Preserve the NVIDIA environment previously exported by the desktop zshrc.
export WLR_NO_HARDWARE_CURSORS=1
export WLR_DRM_NO_ATOMIC=0
export WLR_DRM_DEVICES=/dev/dri/card0
export GBM_BACKEND=nvidia-drm
export __GLX_VENDOR_LIBRARY_NAME=nvidia
export __NV_PRIME_RENDER_OFFLOAD=1
export __VK_LAYER_NV_optimus=NVIDIA_only
