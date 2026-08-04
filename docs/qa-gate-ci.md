# QA Gate CI

仓库已启用 `.github/workflows/qa-gate.yml`。普通单元测试和真实数据库测试分为两个 Job：`pnpm qa:gate` 不依赖生产密钥或真实数据库；只有配置 `CI_DATABASE_URL` 后才运行 `pnpm test:real-db`。

当前 workflow 内容如下。

```yaml
name: QA Gate

on:
  push:
  pull_request:

jobs:
  unit-gate:
    name: Typecheck and unit gate
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Enable pnpm
        run: corepack enable

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run QA gate
        run: pnpm qa:gate

  real-db-gate:
    name: Real DB regression gate
    runs-on: ubuntu-latest
    needs: unit-gate
    env:
      DATABASE_URL: ${{ secrets.CI_DATABASE_URL }}
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Enable pnpm
        run: corepack enable

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run real DB tests
        if: ${{ env.DATABASE_URL != '' }}
        run: pnpm test:real-db

      - name: Skip real DB tests
        if: ${{ env.DATABASE_URL == '' }}
        run: echo "CI_DATABASE_URL is not configured; real DB regression tests are isolated and skipped."
```
