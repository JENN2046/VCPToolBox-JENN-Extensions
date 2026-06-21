# VCPToolBox-JENN-Extensions

- This is the Jenn managed external package root.
- This directory is outside the VCPToolBox core repo.
- This directory is intended to be allowlisted by VCP_PLUGIN_ALLOWED_ROOTS.
- This root itself is not the legacy plugin discovery root.
- The legacy plugin discovery root is ./Plugin.
- The AdminPanel extension package root is ./AdminExtensions.
- The AI Image adapter package root is ./AIImageAdapters.
- The Codex/Memory bridge package root is ./MemoryBridges.
- No secrets, logs, cache, generated outputs, or private operator state should live here.
- No plugin migration has been performed by Gate 12.

Recommended env mapping:

```text
VCP_PLUGIN_ALLOWED_ROOTS=<path>\VCPToolBox-JENN-Extensions
VCP_PLUGIN_DIRS=<path>\VCPToolBox-JENN-Extensions\Plugin
VCP_PLUGIN_INSTALL_DIR=<path>\VCPToolBox-JENN-Extensions\Plugin
VCP_ADMIN_EXTENSION_DIRS=<path>\VCPToolBox-JENN-Extensions\AdminExtensions
VCP_AI_IMAGE_ADAPTER_ALLOWED_ROOTS=<path>\VCPToolBox-JENN-Extensions
VCP_AI_IMAGE_ADAPTER_DIRS=<path>\VCPToolBox-JENN-Extensions\AIImageAdapters
VCP_CODEX_MEMORY_BRIDGE_ALLOWED_ROOTS=<path>\VCPToolBox-JENN-Extensions
VCP_CODEX_MEMORY_BRIDGE_DIRS=<path>\VCPToolBox-JENN-Extensions\MemoryBridges
```

Incompatible with the recommended nested Plugin layout unless runtime discovery behavior changes later:

```text
VCP_PLUGIN_DIRS=<path>\VCPToolBox-JENN-Extensions
```

`VCP_ADMIN_EXTENSION_DIRS`, `VCP_AI_IMAGE_ADAPTER_DIRS`, and `VCP_CODEX_MEMORY_BRIDGE_DIRS` are documented for future reviewed local gates only. They must remain unset during package creation and checksum validation.
