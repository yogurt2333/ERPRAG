# 01 — Deploy ERPNext locally

**Status:** done (2026-09-25)
**What to build:** A local ERPNext login backed by persistent isolated containers.

- [x] WSL2 and Docker Desktop ready
- [x] Official pinned Compose configuration validated
- [x] ERPNext app installed in local site
- [x] HTTP ping and login verified
- [x] Deployment status and career/project boundaries documented

Validation evidence:

- Docker Desktop 4.91.0, Linux engine 29.8.0
- `frappe 16.35.0` and `erpnext 16.35.0` installed on `erprag.localhost`
- MariaDB container healthy; two workers reported online by `bench doctor`
- `GET http://127.0.0.1:8080/api/method/ping` returned `200 {"message":"pong"}`
- `GET http://127.0.0.1:8080/login` returned HTTP 200
- Site scheduler enabled
