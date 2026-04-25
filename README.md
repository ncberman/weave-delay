# Introduction
Tool to show delays between weaves and abilities.
This project is a fork of [aerthax/weave-delay](https://github.com/aerthax/weave-delay).
Link to the tool: https://aerthax.github.io/weave-delay/.

## CI/CD Environments

This repository deploys with GitHub Actions + Railway using two environments:

- Production: pushes to `main` run tests, then deploy to Railway Production.
- Development: pushes to any non-`main` branch run tests, then deploy to Railway Development (latest successful push wins).

Workflows:

- `.github/workflows/production.yml`
- `.github/workflows/development.yml`

## Local Test Command

Both workflows run the same smoke test command:

```bash
make test
```

The smoke test:

- validates required app files exist,
- checks `index.html` local script references are valid,
- runs `node --check` against repo JavaScript files.

## Required GitHub Configuration

Set the following repository secret:

- `RAILWAY_TOKEN`: Railway project token used by CI deploys.

Set the following repository variables:

- `RAILWAY_PROJECT_ID`: Railway project id.
- `RAILWAY_PRODUCTION_SERVICE_ID`: Railway service id for production deploys.
- `RAILWAY_DEVELOPMENT_SERVICE_ID`: Railway service id for development deploys.
- `RAILWAY_PRODUCTION_ENVIRONMENT`: Railway production environment name/id (commonly `production`).
- `RAILWAY_DEVELOPMENT_ENVIRONMENT`: Railway development environment name/id (commonly `development`).

## Branch Protection Recommendation

In GitHub branch protection for `main`, require status checks before merge:

- `test-and-deploy-production`

Optional, if you also want PR-time validation for non-main updates:

- add a separate PR test-only workflow and require that check on `main` PRs.

## Railway Mapping

Recommended mapping:

- `main` -> Railway Production environment.
- any non-`main` branch -> shared Railway Development environment.

If multiple people push non-main branches, the most recent successful Development deployment is the one that remains live.

## Troubleshooting

- `missing RAILWAY_TOKEN`: set repo secret `RAILWAY_TOKEN`.
- `project/service/environment not found`: verify the `RAILWAY_*` repository variables.
- deployment runs unexpectedly on `main`: ensure development workflow keeps `branches-ignore: [main]`.
