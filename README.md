# Coffy Shop

A small coffee ordering application developed through DIJJI's Request and task workflows.

## Project status

This repository is the starting point for development. The application has not been implemented or deployed yet. Application code, tests, and deployment automation will be produced by DIJJI tasks.

## MVP scope

- A responsive Turkish menu with categories, TRY prices, and product availability.
- A shopping cart with quantities and server-validated totals.
- Pickup orders with a reference and a customer-facing status page.
- A protected staff area for menu availability and order preparation status.
- SQLite storage that survives application releases and restarts.
- CI checks and a separate deployment to an existing AWS Lightsail host.
- Health and version endpoints plus a verifiable deployment-completion event for E2E testing.

Real payments, delivery logistics, and the external E2E partner's orchestration are outside the initial scope.

## Delivery conventions

- `main` is the trunk and deployment branch; development changes arrive through pull requests.
- Deployment success must identify the exact deployed commit and follow a live readiness check.
- Runtime data lives outside release directories.
- Credentials, environment files, databases, and customer data must never be committed.
