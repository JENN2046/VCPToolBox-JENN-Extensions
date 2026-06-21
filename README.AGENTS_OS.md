# VCPToolBox-JENN-Extensions

- This is the Jenn managed external package root.
- This directory is outside the VCPToolBox core repo.
- This directory is intended to be allowlisted by VCP_PLUGIN_ALLOWED_ROOTS.
- This root itself is not the legacy plugin discovery root.
- The legacy plugin discovery root is ./Plugin.
- The AdminPanel extension package root is ./AdminExtensions.
- No secrets, logs, cache, generated outputs, or private operator state should live here.
- No plugin migration has been performed by Gate 12.

Recommended env mapping:

```text
VCP_PLUGIN_ALLOWED_ROOTS=<path>\VCPToolBox-JENN-Extensions
VCP_PLUGIN_DIRS=<path>\VCPToolBox-JENN-Extensions\Plugin
VCP_PLUGIN_INSTALL_DIR=<path>\VCPToolBox-JENN-Extensions\Plugin
VCP_ADMIN_EXTENSION_DIRS=<path>\VCPToolBox-JENN-Extensions\AdminExtensions
```

Incompatible with the recommended nested Plugin layout unless runtime discovery behavior changes later:

```text
VCP_PLUGIN_DIRS=<path>\VCPToolBox-JENN-Extensions
```

`VCP_ADMIN_EXTENSION_DIRS` is documented for future reviewed local gates only. It must remain unset during package creation and checksum validation.
