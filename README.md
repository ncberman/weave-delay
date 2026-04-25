# Introduction
Tool to show delays between weaves and abilities.
This project is a fork of [aerthax/weave-delay](https://github.com/aerthax/weave-delay).
Link to the tool: https://aerthax.github.io/weave-delay/.

## Railway auto-deploy setup

This repository includes `railway.json` so Railway's GitHub watcher can deploy automatically from your tracked branch (for your case, `main`).

Steps:

1. In Railway, connect this GitHub repository to your service/project.
2. Set the service's watched branch to `main`.
3. Ensure Python 3 and `make` are available in the build/runtime environment (this repo's `nixpacks.toml` config ensures both).
4. Push/merge to `main` and Railway will deploy using the config file in this repo.

The config currently deploys with:

- `startCommand`: `make run HOST=0.0.0.0 PORT=$PORT PYTHON=python3`
- `healthcheckPath`: `/`

Railway config-as-code reference: [https://docs.railway.com/config-as-code](https://docs.railway.com/config-as-code)
