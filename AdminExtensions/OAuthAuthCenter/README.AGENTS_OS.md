# OAuthAuthCenter

Reviewed copy-first AdminPanel extension package for the M93 gate.

Scope:

- planned page/API extension package identity
- copied Vue and TypeScript source from reviewed core candidates
- default disabled manifest
- no dynamic frontend runtime
- no AdminPanel production build
- auth/OAuth display guard passed for no token or secret value display
- runtime action guard still required before any mount or provider/upstream smoke behavior

This package is not active runtime. Future runtime, OAuth account mutation, provider enablement, or upstream smoke behavior requires a separate gate.
