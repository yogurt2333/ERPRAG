# ADR 0009: Use passkeys for operator web access

Accepted. The public Web/PWA has no self-service registration and uses WebAuthn
passkeys for its one or two equal-privilege operators, with offline recovery codes and at least one
backup credential. Successful authentication creates a server-side session carried
only by a Secure, HttpOnly, SameSite=Strict cookie. Sensitive administration such as
archive deletion, restore and operator enrollment requires recent re-authentication.
Hermes authentication is separate and cannot authorize the public Web/PWA.
